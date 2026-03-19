/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: Seguridad
 * ================================================================
 *  Casos cubiertos:
 *    BUG-002/BUG-005: Los errores 500 nunca exponen err.message de BD
 *    RIESGO-002: Requests sin token son rechazados (401/403)
 *    SEC-001: Las rutas protegidas requieren token válido
 *    SEC-002: Respuestas de error tienen estructura controlada
 *    SEC-003: Headers de seguridad presentes en las respuestas
 * ================================================================
 */
import request from "supertest";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Mock de BD antes de cualquier import
jest.mock("../db.js", () => ({
  query: jest.fn(),
  getClient: jest.fn(() =>
    Promise.resolve({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    })
  ),
}));

const { query } = await import("../db.js");
const { createTestApp } = await import("./app-test-factory.js");

const app = createTestApp();

// =====================================================
//  Helper: token válido no expirado
// =====================================================
const makeToken = (userId = 1) => `token-${userId}-${Date.now()}`;

// =====================================================
//  Helper: mockear respuesta de authRequired
//  (usuario activo con rol AREA)
// =====================================================
function mockAuthSuccess() {
  query.mockResolvedValueOnce({
    rows: [{
      id: 1,
      activo: true,
      id_dgeneral: 2,
      id_dauxiliar: 3,
      roles: ["AREA"],
    }],
    rowCount: 1,
  });
}

// =====================================================
//  SUITE: Errores no exponen internos de BD
// =====================================================
describe("BUG-002 / BUG-005: errores internos no exponen detalles de BD", () => {
  beforeEach(() => jest.clearAllMocks());

  it("error 500 en login retorna mensaje genérico sin stack ni query", async () => {
    // Simula un error de BD real con mensaje interno
    query.mockRejectedValueOnce(
      new Error("relation \"usuarios\" does not exist — SQLSTATE 42P01")
    );

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "test", password: "test" });

    // Debe retornar 500 con mensaje genérico
    expect(res.status).toBe(500);

    const body = JSON.stringify(res.body);
    // Ninguno de estos strings del error real debe aparecer en la respuesta
    expect(body).not.toContain("relation");
    expect(body).not.toContain("does not exist");
    expect(body).not.toContain("SQLSTATE");
    expect(body).not.toContain("42P01");
    expect(res.body).not.toHaveProperty("stack");
    expect(res.body).not.toHaveProperty("db");

    // Debe tener un error legible
    expect(res.body).toHaveProperty("error");
  });

  it("mensaje de error en login es legible para el usuario final", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Resto de mocks para audit
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "noexiste", password: "pass" });

    expect(res.status).toBe(401);
    // El mensaje debe ser genérico e inteligible
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it("error 500 en ruta protegida retorna mensaje genérico sin trace SQL", async () => {
    // authRequired consulta BD y falla
    query.mockRejectedValueOnce(
      new Error("deadlock detected — DETAIL: Process 1234 waits for lock")
    );

    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer ${makeToken()}`);

    // authRequired captura el error y retorna 500 genérico
    expect([401, 500]).toContain(res.status);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("deadlock");
    expect(body).not.toContain("Process 1234");
    expect(res.body).not.toHaveProperty("stack");
  });
});

// =====================================================
//  SUITE: Requests sin token son rechazados
// =====================================================
describe("RIESGO-002: rutas protegidas rechazadas sin token", () => {
  beforeEach(() => jest.clearAllMocks());

  const rutasProtegidas = [
    { method: "get",  path: "/api/catalogos/metas" },
    { method: "post", path: "/api/suficiencias" },
    { method: "get",  path: "/api/suficiencias/next-folio" },
    { method: "get",  path: "/api/catalogos/partidas" },
  ];

  for (const { method, path } of rutasProtegidas) {
    it(`${method.toUpperCase()} ${path} sin token retorna 401`, async () => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });
  }

  it("request con Bearer vacío retorna 401", async () => {
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", "Bearer ");

    expect(res.status).toBe(401);
  });

  it("request con header Authorization malformado retorna 401", async () => {
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", "Basic dXNlcjpwYXNz");

    expect(res.status).toBe(401);
  });
});

// =====================================================
//  SUITE: Estructura de respuestas de error
// =====================================================
describe("SEC-002: estructura controlada de respuestas de error", () => {
  beforeEach(() => jest.clearAllMocks());

  it("401 tiene campo 'error' como string", async () => {
    const res = await request(app).get("/api/suficiencias/next-folio");
    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
  });

  it("404 en ruta API desconocida retorna JSON con campo 'error'", async () => {
    const res = await request(app).get("/api/ruta-que-no-existe-xyzxyz");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("respuesta de login correcto no incluye password en la respuesta", async () => {
    const { default: bcrypt } = await import("bcryptjs");
    const hash = await bcrypt.hash("secret123", 10);

    query.mockResolvedValueOnce({
      rows: [{
        id: 1, nombre_completo: "Test", usuario: "testuser",
        correo: "t@t.com", password: hash, id_dgeneral: 1,
        id_dauxiliar: 1, activo: true, dgeneral_clave: "L01",
        dgeneral_nombre: "DG", dauxiliar_clave: "101",
        dauxiliar_nombre: "DA", roles: ["AREA"],
      }],
      rowCount: 1,
    });
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "testuser", password: "secret123" });

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    // El hash de password nunca debe aparecer en la respuesta
    expect(body).not.toContain("$2");
    expect(body).not.toContain("secret123");
    expect(res.body.usuario).not.toHaveProperty("password");
  });
});

// =====================================================
//  SUITE: Headers de seguridad (Helmet)
// =====================================================
describe("SEC-003: headers de seguridad en respuestas", () => {
  it("GET /api/health incluye header x-trace-id", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers).toHaveProperty("x-trace-id");
    // Debe ser un UUID (formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    expect(res.headers["x-trace-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("respuestas incluyen x-content-type-options de Helmet", async () => {
    const res = await request(app).get("/api/health");
    // Helmet agrega este header por defecto
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

// =====================================================
//  SUITE: Control de acceso por rol
// =====================================================
describe("SEC-004: control de acceso por rol", () => {
  beforeEach(() => jest.clearAllMocks());

  it("usuario AREA no puede hacer POST en /api/catalogos/partidas", async () => {
    mockAuthSuccess();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/catalogos/partidas")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ clave: "1001", descripcion: "Test" });

    // blockPartidasWrite bloquea a AREA en escrituras
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });
});
