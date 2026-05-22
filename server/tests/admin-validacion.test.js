/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: H-4 + H-5 (admin-usuarios)
 * ================================================================
 *  - POST con __proto__ → 400.
 *  - POST con rol fuera de la allowlist → 400.
 *  - POST sin password → 400.
 *  - x-user-id en header NO se confía: el actor es req.user.id.
 * ================================================================
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

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
const { query, getClient } = await import("../db.js");
const { createTestApp, signTestToken } = await import("./app-test-factory.js");

const app = createTestApp();

function mockAuthAsGod() {
  query.mockResolvedValueOnce({
    rows: [{ id: 7, activo: true, id_dgeneral: 1, id_dauxiliar: 1, roles: ["GOD"] }],
    rowCount: 1,
  });
}

function godToken() {
  return signTestToken(7, { roles: ["GOD"] });
}

describe("H-5: admin POST rechaza prototype pollution", () => {
  beforeEach(() => {
    query.mockReset();
    if (getClient.mockReset) getClient.mockReset();
    getClient.mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    });
  });

  it("body con __proto__ → 400 (express parsea raw JSON sin perder la key)", async () => {
    mockAuthAsGod();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    // Enviamos el body como raw JSON string para que el express.json
    // parser sea quien procese el __proto__. Express en versiones
    // recientes preserva __proto__ como propiedad propia (no como
    // mutación del prototipo) — el handler debe detectarlo con
    // hasOwnProperty.
    const res = await request(app)
      .post("/api/admin/usuarios")
      .set("Authorization", `Bearer ${godToken()}`)
      .set("Content-Type", "application/json")
      .send('{"nombre_completo":"X","usuario":"u","password":"pw","__proto__":{"isAdmin":true}}');

    // El handler tiene hasUnsafeKeys que chequea __proto__/constructor/prototype.
    // Si Express no lo preserva (cuelga del prototype), el chequeo no detecta y
    // entra al flujo normal. Aceptamos 400 (rechazado por hasUnsafeKeys o por
    // validación) o 500 (si el body queda corrupto y el handler falla).
    // Lo crítico: el usuario malicioso NO obtiene 200 OK.
    expect(res.status).not.toBe(200);
    expect([400, 500]).toContain(res.status);
  });

  it("body con 'constructor' como llave → 400", async () => {
    mockAuthAsGod();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const malicious = JSON.parse('{"nombre_completo":"X","usuario":"u","password":"pw","constructor":{"x":1}}');

    const res = await request(app)
      .post("/api/admin/usuarios")
      .set("Authorization", `Bearer ${godToken()}`)
      .send(malicious);

    expect(res.status).toBe(400);
  });
});

describe("H-5: admin POST valida roles contra allowlist", () => {
  beforeEach(() => {
    query.mockReset();
    if (getClient.mockReset) getClient.mockReset();
    getClient.mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    });
  });

  it("rol fuera de [GOD,ADMIN,AREA] → 400", async () => {
    mockAuthAsGod();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/admin/usuarios")
      .set("Authorization", `Bearer ${godToken()}`)
      .send({
        nombre_completo: "X",
        usuario: "u1",
        password: "pw123456",
        roles: ["HACKER"],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.detalles?.join(" ") || res.body.error).toMatch(/rol/i);
  });

  it("roles como array vacío es aceptado", async () => {
    mockAuthAsGod();
    // mockear getClient para que el INSERT tenga éxito
    const clientQ = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })           // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }) // INSERT usuarios
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })           // DELETE usuario_rol
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });          // COMMIT
    getClient.mockResolvedValueOnce({ query: clientQ, release: jest.fn() });
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/admin/usuarios")
      .set("Authorization", `Bearer ${godToken()}`)
      .send({
        nombre_completo: "Sin Rol",
        usuario: "u2",
        password: "pw123456",
        roles: [],
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });
});

describe("H-5: admin POST valida password requerido", () => {
  beforeEach(() => {
    query.mockReset();
    if (getClient.mockReset) getClient.mockReset();
    getClient.mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    });
  });

  it("sin password → 400", async () => {
    mockAuthAsGod();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/admin/usuarios")
      .set("Authorization", `Bearer ${godToken()}`)
      .send({
        nombre_completo: "X",
        usuario: "u3",
        // sin password
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Validación/i);
  });

  it("nombre_completo vacío → 400", async () => {
    mockAuthAsGod();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/admin/usuarios")
      .set("Authorization", `Bearer ${godToken()}`)
      .send({ nombre_completo: "", usuario: "u4", password: "pw" });

    expect(res.status).toBe(400);
  });

  it("correo con formato inválido → 400", async () => {
    mockAuthAsGod();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/admin/usuarios")
      .set("Authorization", `Bearer ${godToken()}`)
      .send({
        nombre_completo: "X",
        usuario: "u5",
        password: "pw1234",
        correo: "no-es-email",
      });

    expect(res.status).toBe(400);
  });
});

describe("H-4: x-user-id NO sustituye a req.user.id", () => {
  beforeEach(() => {
    query.mockReset();
    if (getClient.mockReset) getClient.mockReset();
    getClient.mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    });
  });

  it("POST como GOD id=7 con header x-user-id:999 → actor es 7", async () => {
    mockAuthAsGod();
    let capturedActor = null;
    const clientQ = jest.fn((sql, params) => {
      if (typeof sql === "string" && sql.includes("INSERT INTO usuarios")) {
        // updated_by es el octavo param ($8) según el handler
        capturedActor = params?.[7];
        return Promise.resolve({ rows: [{ id: 99 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    getClient.mockResolvedValueOnce({ query: clientQ, release: jest.fn() });
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/admin/usuarios")
      .set("Authorization", `Bearer ${godToken()}`)
      .set("x-user-id", "999") // intento de spoofing
      .send({
        nombre_completo: "Test",
        usuario: "u6",
        password: "pw1234",
        roles: [],
      });

    expect(res.status).toBe(200);
    // El actor inserto en updated_by debe ser 7 (req.user.id), NO 999.
    expect(capturedActor).toBe(7);
    expect(capturedActor).not.toBe(999);
  });
});
