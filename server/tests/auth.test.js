/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: Autenticación (auth.routes.js)
 * ================================================================
 *  Casos cubiertos:
 *    CP-001: Login exitoso retorna JWT firmado HS256
 *    CP-002: Login con credenciales incorrectas retorna 401
 *    CP-003: Usuario inactivo retorna 403
 *    CP-004: Token expirado retorna 401 en ruta protegida
 *    CP-004b: Sin token retorna 401
 *    CP-004c: Token con formato inválido retorna 401
 *
 *  Actualizado para C-6: JWT firmado HS256 con issuer/audience.
 *  El formato legacy token-{id}-{ts} ya NO se acepta.
 * ================================================================
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import bcrypt from "bcryptjs";

// =====================================================
//  Mock de db.js — debe declararse ANTES de import del factory
//  para que los routers (que importan db.js) reciban el mock.
// =====================================================
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
const jwt = (await import("jsonwebtoken")).default;

const app = createTestApp();

const PLAIN_PASSWORD = "miPassword123";
const BCRYPT_HASH = await bcrypt.hash(PLAIN_PASSWORD, 10);

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

function mockAuditQueries() {
  query.mockResolvedValue({ rows: [], rowCount: 0 });
}

describe("CP-001 a CP-004: Autenticación", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("CP-001: login exitoso retorna JWT firmado HS256", async () => {
    query.mockResolvedValueOnce({ rows: [mockUsuarioActivo()], rowCount: 1 });
    mockAuditQueries();

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "testuser", password: PLAIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    // C-6: ya no es token-{id}-{ts} sino JWT (3 segmentos base64url)
    expect(res.body.token.split(".")).toHaveLength(3);

    // Verifica que el token es decodificable con la clave correcta
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET, {
      issuer: "control-presupuestal",
      audience: "cp-frontend",
      algorithms: ["HS256"],
    });
    expect(decoded.sub).toBe(1);
  });

  it("CP-001: login incluye datos del usuario en la respuesta", async () => {
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

  it("CP-002: usuario inexistente retorna 401 sin exponer detalles", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockAuditQueries();

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "noexiste", password: "cualquiera" });

    expect(res.status).toBe(401);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("relation");
    expect(body).not.toContain("does not exist");
    expect(res.body).not.toHaveProperty("stack");
  });

  it("CP-002: password incorrecto retorna 401", async () => {
    query.mockResolvedValueOnce({ rows: [mockUsuarioActivo()], rowCount: 1 });
    mockAuditQueries();

    const res = await request(app)
      .post("/api/login")
      .send({ usuario: "testuser", password: "passwordIncorrecto" });

    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty("token");
  });

  it("CP-002: sin cuerpo retorna 400", async () => {
    mockAuditQueries();
    const res = await request(app).post("/api/login").send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("CP-002: solo usuario sin password retorna 400", async () => {
    mockAuditQueries();
    const res = await request(app).post("/api/login").send({ usuario: "testuser" });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty("token");
  });

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
    expect(res.body).not.toHaveProperty("token");
  });

  it("CP-004: token expirado retorna 401 en ruta protegida", async () => {
    // JWT firmado pero ya vencido
    const expired = jwt.sign(
      { sub: 1, roles: ["AREA"] },
      process.env.JWT_SECRET,
      { algorithm: "HS256", issuer: "control-presupuestal", audience: "cp-frontend", expiresIn: "-1s" }
    );

    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("CP-004b: sin Authorization header retorna 401", async () => {
    const res = await request(app).get("/api/catalogos/metas");
    expect(res.status).toBe(401);
  });

  it("CP-004c: token con formato inválido retorna 401", async () => {
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", "Bearer esto-no-es-un-jwt");
    expect(res.status).toBe(401);
  });

  it("CP-004d: token legacy token-1-{ts} ahora retorna 401 (C-6)", async () => {
    const legacy = `token-1-${Date.now()}`;
    const res = await request(app)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer ${legacy}`);
    expect(res.status).toBe(401);
  });

  it("logout siempre retorna 200 con ok:true aunque el token sea inválido", async () => {
    mockAuditQueries();
    const res = await request(app)
      .post("/api/logout")
      .set("Authorization", "Bearer token-invalido");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });

  it("logout con JWT válido consulta BD y retorna ok:true", async () => {
    const token = signTestToken(1, { roles: ["AREA"] });

    query.mockResolvedValueOnce({
      rows: [{ id: 1, usuario: "testuser", id_dgeneral: 2, id_dauxiliar: 3, activo: true }],
      rowCount: 1,
    });
    mockAuditQueries();

    const res = await request(app)
      .post("/api/logout")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });
});

describe("GET /api/health (real, post-fix orden de mounts)", () => {
  beforeEach(() => query.mockReset());

  // ----------------------------------------------------------
  // FIX aplicado: app.get("/api/health", ...) se movió ANTES
  // de app.use("/api", presupuestoRouter). El healthcheck ya no
  // queda detrás del authRequired del router de presupuesto y
  // responde 200 sin token (necesario para load balancers / k8s).
  // ----------------------------------------------------------
  it("/api/health SIN token responde 200 con estado de BD", async () => {
    query.mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 });

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("database");
    expect(res.body.database.status).toBe("ok");
  });

  it("/api/health responde 503 si la BD está caída (sin token)", async () => {
    query.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.database.status).toBe("error");
  });
});
