/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: Autenticación (auth.routes.js)
 * ================================================================
 *  Casos cubiertos:
 *    CP-001: Login exitoso retorna token con formato correcto
 *    CP-002: Login con credenciales incorrectas retorna 401
 *    CP-003: Usuario inactivo retorna 403
 *    CP-004: Token expirado (>10 min) retorna 401 en ruta protegida
 *    CP-004b: Sin token retorna 401
 *    CP-004c: Token con formato inválido retorna 401
 * ================================================================
 */
import request from "supertest";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import bcrypt from "bcryptjs";

// =====================================================
//  Mock de BD — debe declararse ANTES de cualquier import
//  que use db.js (incluidos los routers y helpers)
// =====================================================
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
//  Helper: hash bcrypt sincrónico para tests
// =====================================================
const PLAIN_PASSWORD = "miPassword123";
const BCRYPT_HASH = await bcrypt.hash(PLAIN_PASSWORD, 10);

// =====================================================
//  Helper: fila de usuario activo base
// =====================================================
function mockUsuarioActivo(overrides = {}) {
  return {
    id: 1,
    nombre_completo: "Usuario Test",
    usuario: "testuser",
    correo: "test@example.com",
    password: BCRYPT_HASH,
    id_dgeneral: 2,
    id_dauxiliar: 3,
    activo: true,
    dgeneral_clave: "L01",
    dgeneral_nombre: "Dirección General Test",
    dauxiliar_clave: "101",
    dauxiliar_nombre: "Dirección Auxiliar Test",
    roles: ["AREA"],
    ...overrides,
  };
}

// =====================================================
//  Cada query call que logAuditEvent hace necesita
//  una respuesta válida para no romper el flujo.
//  Usamos un helper para encadenar mocks adicionales.
// =====================================================
function mockAuditQueries() {
  // ensureAuditoriaEventosSchema hace múltiples CREATE TABLE IF NOT EXISTS
  // e INSERT — los mockeamos con respuesta vacía genérica
  query.mockResolvedValue({ rows: [], rowCount: 0 });
}

// =====================================================
//  SUITE: Autenticación
// =====================================================
describe("CP-001 a CP-004: Autenticación", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------
  //  CP-001: Login exitoso
  // --------------------------------------------------
  it("CP-001: login exitoso retorna token con formato token-{id}-{ts}", async () => {
    // Primera query: buscar usuario por nombre
    query.mockResolvedValueOnce({
      rows: [mockUsuarioActivo()],
      rowCount: 1,
    });
    // Resto de queries (logAuditEvent, ensureAuditoriaEventosSchema, INSERT audit)
    mockAuditQueries();

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "testuser", password: PLAIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    // Formato: token-{número}-{timestamp}
    expect(res.body.token).toMatch(/^token-\d+-\d+$/);
    expect(res.body).toHaveProperty("usuario");
    expect(res.body.usuario.id).toBe(1);
    expect(res.body.usuario.roles).toContain("AREA");
  });

  it("CP-001: login exitoso incluye datos del usuario en la respuesta", async () => {
    query.mockResolvedValueOnce({
      rows: [mockUsuarioActivo({ dgeneral_clave: "L00" })],
      rowCount: 1,
    });
    mockAuditQueries();

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "testuser", password: PLAIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.usuario).toMatchObject({
      id: 1,
      usuario: "testuser",
      id_dgeneral: 2,
      id_dauxiliar: 3,
    });
  });

  // --------------------------------------------------
  //  CP-002: Credenciales incorrectas
  // --------------------------------------------------
  it("CP-002: usuario inexistente retorna 401 sin exponer detalles de BD", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockAuditQueries();

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "noexiste", password: "cualquiera" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    // No debe exponer mensajes internos de PostgreSQL
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("relation");
    expect(body).not.toContain("does not exist");
    expect(res.body).not.toHaveProperty("db");
    expect(res.body).not.toHaveProperty("stack");
  });

  it("CP-002: password incorrecto retorna 401", async () => {
    query.mockResolvedValueOnce({
      rows: [mockUsuarioActivo()],
      rowCount: 1,
    });
    mockAuditQueries();

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "testuser", password: "passwordIncorrecto" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(res.body).not.toHaveProperty("token");
  });

  it("CP-002: sin cuerpo retorna 400", async () => {
    mockAuditQueries();

    const res = await request(app)
      .post("/api/login")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("CP-002: solo usuario sin password retorna 400", async () => {
    mockAuditQueries();

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "testuser" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).not.toHaveProperty("token");
  });

  // --------------------------------------------------
  //  CP-003: Usuario inactivo
  // --------------------------------------------------
  it("CP-003: usuario inactivo retorna 403", async () => {
    query.mockResolvedValueOnce({
      rows: [mockUsuarioActivo({ activo: false })],
      rowCount: 1,
    });
    mockAuditQueries();

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "testuser", password: PLAIN_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    expect(res.body).not.toHaveProperty("token");
  });

  // --------------------------------------------------
  //  CP-004: Token expirado / inválido
  // --------------------------------------------------
  it("CP-004: token expirado (>10 min) retorna 401 en ruta protegida", async () => {
    const oldTimestamp = Date.now() - 11 * 60 * 1000; // 11 minutos atrás
    const expiredToken = `token-1-${oldTimestamp}`;

    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer ${expiredToken}`);

    // El middleware authRequired debe rechazarlo antes de llegar a la BD
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("CP-004b: sin Authorization header retorna 401", async () => {
    const res = await request(app).get("/api/catalogos/metas");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("CP-004c: token con formato inválido retorna 401", async () => {
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", "Bearer esto-no-es-un-token-valido");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("CP-004d: token con userId=0 retorna 401", async () => {
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer token-0-${Date.now()}`);

    expect(res.status).toBe(401);
  });

  // --------------------------------------------------
  //  Logout
  // --------------------------------------------------
  it("logout siempre retorna 200 con ok:true aunque el token sea inválido", async () => {
    mockAuditQueries();

    const res = await request(app)
      .post("/api/logout")
      .set("Authorization", "Bearer token-invalido");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });

  it("logout con token válido consulta BD y retorna ok:true", async () => {
    const validToken = `token-1-${Date.now()}`;

    // Mock: consulta de usuario en logout
    query.mockResolvedValueOnce({
      rows: [{ id: 1, usuario: "testuser", id_dgeneral: 2, id_dauxiliar: 3, activo: true }],
      rowCount: 1,
    });
    mockAuditQueries();

    const res = await request(app)
      .post("/api/logout")
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });
});

// =====================================================
//  SUITE: Health check (sin auth)
// =====================================================
describe("GET /api/health", () => {
  it("retorna 200 con ok:true sin necesidad de token", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });
});
