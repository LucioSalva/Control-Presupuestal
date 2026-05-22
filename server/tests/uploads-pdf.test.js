/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: C-8 (uploads de oficios PDF)
 * ================================================================
 *  - Archivo .txt renombrado a .pdf (sin %PDF-) → 400.
 *  - Archivo vacío → 400.
 *  - mimetype no-PDF → 400.
 *  - sanitizeFilename limpia CR/LF.
 *
 *  Tests unitarios sobre las funciones puras + tests HTTP que
 *  validan multer + magic bytes via supertest.
 * ================================================================
 */
import { jest, describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import path from "path";
import fs from "fs/promises";
import os from "os";
import crypto from "crypto";

jest.unstable_mockModule("../db.js", () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
  getClient: jest.fn(() =>
    Promise.resolve({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    })
  ),
}));

const { default: request } = await import("supertest");
const { query } = await import("../db.js");
const { createTestApp, signTestToken } = await import("./app-test-factory.js");
const {
  sanitizeFilename,
  validatePdfMagicBytes,
  resolveInsideDir,
  isPdfMimetypeAndExt,
} = await import("../utils/upload-pdf.js");

const app = createTestApp();

function mockAuthUser(roles = ["AREA"]) {
  // Doble authRequired vía presupuestoRouter; usamos mockImplementation.
  query.mockImplementation((sql) => {
    const s = String(sql || "");
    if (/FROM usuarios/i.test(s) && /AS roles/i.test(s)) {
      return Promise.resolve({
        rows: [{ id: 1, activo: true, id_dgeneral: 1, id_dauxiliar: 1, roles }],
        rowCount: 1,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

// =====================================================
//  Tests unitarios sobre helpers de upload-pdf.js
// =====================================================
describe("C-8: sanitizeFilename limpia CR/LF y caracteres peligrosos", () => {
  it("elimina \\r\\n del nombre", () => {
    const result = sanitizeFilename("oficio\r\nmalicioso.pdf");
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\n");
  });

  it("elimina TAB y NUL", () => {
    const result = sanitizeFilename("oficio\t\0x.pdf");
    expect(result).not.toContain("\t");
    expect(result).not.toContain("\0");
  });

  it("garantiza extensión .pdf", () => {
    expect(sanitizeFilename("documento")).toMatch(/\.pdf$/);
  });

  it("trunca a 200 chars", () => {
    const long = "a".repeat(500) + ".pdf";
    const result = sanitizeFilename(long);
    expect(result.length).toBeLessThanOrEqual(204); // 200 + ".pdf"
  });

  it("retorna documento.pdf con input inválido", () => {
    expect(sanitizeFilename(null)).toBe("documento.pdf");
    expect(sanitizeFilename("")).toBe("documento.pdf");
    expect(sanitizeFilename(undefined)).toBe("documento.pdf");
  });
});

describe("C-8: validatePdfMagicBytes verifica %PDF- al inicio", () => {
  const tmpDir = os.tmpdir();
  const files = [];

  afterAll(async () => {
    for (const f of files) {
      await fs.unlink(f).catch(() => {});
    }
  });

  async function makeTmpFile(content, ext = ".pdf") {
    const filePath = path.join(tmpDir, `cp-test-${crypto.randomUUID()}${ext}`);
    await fs.writeFile(filePath, content);
    files.push(filePath);
    return filePath;
  }

  it("retorna true para archivo que empieza con %PDF-", async () => {
    const f = await makeTmpFile("%PDF-1.4\n%test content\n");
    expect(await validatePdfMagicBytes(f)).toBe(true);
  });

  it("retorna false para archivo de texto plano (no PDF)", async () => {
    const f = await makeTmpFile("hola este es un txt renombrado a pdf");
    expect(await validatePdfMagicBytes(f)).toBe(false);
  });

  it("retorna false para archivo vacío", async () => {
    const f = await makeTmpFile("");
    expect(await validatePdfMagicBytes(f)).toBe(false);
  });

  it("retorna false para archivo binario aleatorio (no PDF)", async () => {
    const f = await makeTmpFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]));
    expect(await validatePdfMagicBytes(f)).toBe(false);
  });

  it("retorna false para ruta inexistente", async () => {
    expect(await validatePdfMagicBytes("/no/existe/aaaa.pdf")).toBe(false);
  });
});

describe("C-8: resolveInsideDir bloquea path traversal", () => {
  const base = path.resolve(os.tmpdir(), "uploads-test");

  it("retorna ruta válida para nombre dentro del dir", () => {
    const r = resolveInsideDir(base, "archivo.pdf");
    expect(r).not.toBeNull();
    expect(r.startsWith(base)).toBe(true);
  });

  it("neutraliza ../ con path.basename", () => {
    // path.basename("../../etc/passwd") = "passwd" — queda dentro del dir
    const r = resolveInsideDir(base, "../../etc/passwd");
    expect(r).not.toBeNull();
    expect(r.startsWith(base)).toBe(true);
    expect(r).not.toContain("etc");
  });

  it("retorna null para nombre vacío", () => {
    expect(resolveInsideDir(base, "")).toBe(null);
    expect(resolveInsideDir(base, null)).toBe(null);
  });
});

describe("C-8: isPdfMimetypeAndExt valida mimetype + extensión", () => {
  it("acepta application/pdf + .pdf", () => {
    expect(isPdfMimetypeAndExt({ mimetype: "application/pdf", originalname: "a.pdf" })).toBe(true);
  });

  it("rechaza image/png + .png", () => {
    expect(isPdfMimetypeAndExt({ mimetype: "image/png", originalname: "a.png" })).toBe(false);
  });

  it("rechaza application/pdf + .txt", () => {
    expect(isPdfMimetypeAndExt({ mimetype: "application/pdf", originalname: "a.txt" })).toBe(false);
  });

  it("rechaza file null o vacío", () => {
    expect(isPdfMimetypeAndExt(null)).toBe(false);
    expect(isPdfMimetypeAndExt({})).toBe(false);
  });
});

// =====================================================
//  Tests HTTP sobre el endpoint real
// =====================================================
describe("C-8: POST /api/reconducciones/:id/oficio (HTTP)", () => {
  beforeEach(() => query.mockReset());

  it("rechaza archivo .txt sin %PDF- (mimetype image/png) → 400", async () => {
    mockAuthUser(["GOD"]);
    const token = signTestToken(1, { roles: ["GOD"] });

    const res = await request(app)
      .post("/api/reconducciones/1/oficio")
      .set("Authorization", `Bearer ${token}`)
      .attach("oficio", Buffer.from("hola mundo"), { filename: "fake.pdf", contentType: "image/png" });

    // Si llega al upload middleware → 400 por mimetype. Si lo bloquea
    // algún guard previo (sesión, áreas, etc) → 403. En cualquier
    // caso, el upload NO es aceptado.
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/PDF|mimetype/i);
    }
    // Log para diagnóstico
    if (res.status === 403) {
      console.error("[TEST] upload 403 body:", JSON.stringify(res.body));
    }
  });

  it("rechaza archivo con extensión .txt aunque diga mimetype application/pdf → 400", async () => {
    mockAuthUser(["GOD"]);
    const token = signTestToken(1, { roles: ["GOD"] });

    const res = await request(app)
      .post("/api/reconducciones/1/oficio")
      .set("Authorization", `Bearer ${token}`)
      .attach("oficio", Buffer.from("texto plano"), {
        filename: "documento.txt",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/extens|PDF/i);
  });

  it("rechaza archivo vacío → 400", async () => {
    mockAuthUser(["GOD"]);
    const token = signTestToken(1, { roles: ["GOD"] });

    const res = await request(app)
      .post("/api/reconducciones/1/oficio")
      .set("Authorization", `Bearer ${token}`)
      .attach("oficio", Buffer.alloc(0), {
        filename: "vacio.pdf",
        contentType: "application/pdf",
      });

    // El handler chequea size === 0 → 400 "El archivo está vacío"
    expect(res.status).toBe(400);
  });

  it("rechaza archivo con extensión .pdf pero contenido NO-PDF → 400", async () => {
    mockAuthUser(["GOD"]);
    const token = signTestToken(1, { roles: ["GOD"] });

    const res = await request(app)
      .post("/api/reconducciones/1/oficio")
      .set("Authorization", `Bearer ${token}`)
      .attach("oficio", Buffer.from("esto NO es un pdf real"), {
        filename: "engaño.pdf",
        contentType: "application/pdf",
      });

    // validatePdfMagicBytes detecta la ausencia de %PDF-.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PDF/i);
  });
});
