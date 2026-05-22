/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: C-6 (JWT firmado HS256)
 * ================================================================
 *  - Login válido emite un JWT verificable con HS256 + issuer +
 *    audience correctos.
 *  - El formato legacy `token-{id}-{ts}` es rechazado.
 *  - JWT con `alg: none` es rechazado.
 *  - JWT expirado retorna 401.
 *  - JWT firmado con otra clave es rechazado.
 *  - JWT sin issuer/audience es rechazado.
 * ================================================================
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import bcrypt from "bcryptjs";

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
const { createTestApp } = await import("./app-test-factory.js");
const jwt = (await import("jsonwebtoken")).default;

const app = createTestApp();

const PASS = "passw0rd";
const HASH = await bcrypt.hash(PASS, 10);

function userRow(extra = {}) {
  return {
    id: 1,
    nombre_completo: "U",
    usuario: "u",
    correo: "u@u.com",
    password: HASH,
    id_dgeneral: 1,
    id_dauxiliar: 1,
    activo: true,
    dgeneral_clave: "L01",
    dgeneral_nombre: "DG",
    dauxiliar_clave: "101",
    dauxiliar_nombre: "DA",
    roles: ["AREA"],
    ...extra,
  };
}

describe("C-6: Login emite JWT firmado verificable", () => {
  beforeEach(() => query.mockReset());

  it("login válido emite token decodificable con jwt.verify", async () => {
    query.mockResolvedValueOnce({ rows: [userRow()], rowCount: 1 });
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "u", password: PASS });

    expect(res.status).toBe(200);
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET, {
      issuer: "control-presupuestal",
      audience: "cp-frontend",
      algorithms: ["HS256"],
    });
    expect(decoded.sub).toBe(1);
    expect(Array.isArray(decoded.roles)).toBe(true);
    expect(decoded.iss).toBe("control-presupuestal");
    expect(decoded.aud).toBe("cp-frontend");
  });

  it("el token tiene exp configurada (10 minutos)", async () => {
    query.mockResolvedValueOnce({ rows: [userRow()], rowCount: 1 });
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "u", password: PASS });

    const decoded = jwt.decode(res.body.token);
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
    const dur = decoded.exp - decoded.iat;
    expect(dur).toBe(600); // 10 min
  });
});

describe("C-6: el sistema rechaza tokens NO-JWT", () => {
  it("token legacy 'token-1-{ts}' es rechazado en ruta protegida", async () => {
    const legacy = `token-1-${Date.now()}`;
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer ${legacy}`);
    expect(res.status).toBe(401);
  });

  it("string aleatorio es rechazado", async () => {
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", "Bearer aaa.bbb.ccc");
    expect(res.status).toBe(401);
  });
});

describe("C-6: JWT con alg=none es rechazado", () => {
  it("JWT sin firmar (alg:none) → 401", async () => {
    // Construir manualmente un JWT con alg:none
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: 1,
        iss: "control-presupuestal",
        aud: "cp-frontend",
        exp: Math.floor(Date.now() / 1000) + 600,
      })
    ).toString("base64url");
    const unsignedToken = `${header}.${payload}.`;

    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer ${unsignedToken}`);

    expect(res.status).toBe(401);
  });
});

describe("C-6: JWT expirado es rechazado", () => {
  it("JWT con expiresIn:-1s retorna 401", async () => {
    const expired = jwt.sign(
      { sub: 1, roles: ["AREA"] },
      process.env.JWT_SECRET,
      {
        algorithm: "HS256",
        issuer: "control-presupuestal",
        audience: "cp-frontend",
        expiresIn: "-1s",
      }
    );
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });
});

describe("C-6: JWT con issuer/audience incorrectos es rechazado", () => {
  it("JWT firmado con otra issuer → 401", async () => {
    const bad = jwt.sign(
      { sub: 1, roles: ["AREA"] },
      process.env.JWT_SECRET,
      {
        algorithm: "HS256",
        issuer: "otro-emisor",
        audience: "cp-frontend",
        expiresIn: "10m",
      }
    );
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  it("JWT firmado con otra audience → 401", async () => {
    const bad = jwt.sign(
      { sub: 1, roles: ["AREA"] },
      process.env.JWT_SECRET,
      {
        algorithm: "HS256",
        issuer: "control-presupuestal",
        audience: "otra-app",
        expiresIn: "10m",
      }
    );
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  it("JWT firmado con secreto diferente → 401", async () => {
    const bad = jwt.sign(
      { sub: 1, roles: ["AREA"] },
      "otro_secreto_de_32_chars_xxxxxxxxxxx",
      {
        algorithm: "HS256",
        issuer: "control-presupuestal",
        audience: "cp-frontend",
        expiresIn: "10m",
      }
    );
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });
});
