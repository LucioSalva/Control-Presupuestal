/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: H-1 + H-2 (CSRF/Origin)
 * ================================================================
 *  - H-1: validateOrigin parsea Origin con new URL() — substring
 *    tricks como "https://evil.com?x=localhost" NO bypassan.
 *  - H-2: en production, POST sin Origin y sin Bearer → 403.
 *  - POST con Bearer y sin Origin → permitido (es API legítima).
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
const { query } = await import("../db.js");
const { createTestApp, signTestToken } = await import("./app-test-factory.js");

// App con Origin estricto + writeOriginGuard (production)
const appProd = createTestApp({ production: true, enableOriginGuard: true, skipCors: true });
// App de development (NO aplica writeOriginGuard, sí validateOrigin para H-1)
const appDev = createTestApp({ enableOriginGuard: true, skipCors: true });

function mockAuthUser(roles = ["AREA"]) {
  query.mockResolvedValueOnce({
    rows: [{ id: 1, activo: true, id_dgeneral: 1, id_dauxiliar: 1, roles }],
    rowCount: 1,
  });
}

describe("H-1: validateOrigin con URL parse estricto", () => {
  beforeEach(() => query.mockReset());

  it("Origin malicioso con substring tricks → 403", async () => {
    // El bug previo: origin.includes(host) → "https://evil.com/?x=localhost"
    // pasaría si host = "localhost". Con new URL(origin).host obtenemos
    // "evil.com" y el strict equals contra Host falla.
    const res = await request(appDev)
      .post("/api/admin/usuarios")
      .set("Origin", "https://evil.com/?x=localhost")
      .set("Host", "localhost:3000")
      .send({ usuario: "u" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/origin/i);
  });

  it("Origin con host idéntico → pasa el guard (404 o downstream)", async () => {
    // Sin Bearer; pero el Origin coincide con Host
    const res = await request(appDev)
      .post("/api/ruta-inexistente-xyz")
      .set("Origin", "http://127.0.0.1:3000")
      .set("Host", "127.0.0.1:3000")
      .send({});

    // No es 403 origin_mismatch — el guard pasó. 404 esperado.
    expect(res.status).not.toBe(403);
  });

  it("Origin con formato inválido → 403 invalid_origin", async () => {
    const res = await request(appDev)
      .post("/api/admin/usuarios")
      .set("Origin", "not-a-url")
      .set("Host", "localhost:3000")
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/origin/i);
  });

  it("GET no ejecuta validateOrigin (método seguro)", async () => {
    mockAuthUser();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(appDev)
      .get("/api/catalogos/metas")
      .set("Authorization", `Bearer ${signTestToken(1)}`)
      .set("Origin", "https://evil.com");

    // Validación de Origin solo aplica a write methods; este GET pasa el guard.
    expect(res.status).not.toBe(403);
  });
});

describe("H-2: production exige Origin O Bearer para writes", () => {
  beforeEach(() => query.mockReset());

  it("POST en production SIN Origin Y SIN Bearer → 403", async () => {
    const res = await request(appProd)
      .post("/api/admin/usuarios")
      .send({ usuario: "x" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/origin_required/i);
  });

  it("POST en production CON Bearer y SIN Origin → permitido (no 403 origin)", async () => {
    mockAuthUser(["GOD"]);
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(appProd)
      .post("/api/admin/usuarios")
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["GOD"] })}`)
      .send({ nombre_completo: "X", usuario: "u_test_prod" });
      // password faltante → llegará a validación de admin (400) pero NO al 403 de Origin.

    expect(res.status).not.toBe(403);
  });

  it("POST en development SIN Origin Y SIN Bearer → cae en validateOrigin (origin_required) o 401", async () => {
    // En dev appDev tenemos enableOriginGuard=true → validateOrigin SÍ
    // se aplica. POST sin Origin y sin Bearer → 403 origin_required
    // del validateOrigin (no del writeOriginGuard de H-2). Distinguimos
    // que NO es el código 403 origin_required de H-2 (production-only):
    const res = await request(appDev)
      .post("/api/admin/usuarios")
      .send({ usuario: "x" });

    // appDev tiene validateOrigin instalado pero no writeOriginGuard.
    // Como no hay Bearer, validateOrigin retorna 403 "origin_required".
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/origin/i);
  });

  it("POST en production con Origin presente coincidiendo con Host → no es 403 por Origin", async () => {
    const res = await request(appProd)
      .post("/api/admin/usuarios")
      .set("Origin", "http://127.0.0.1:3000")
      .set("Host", "127.0.0.1:3000")
      .send({ usuario: "x" });

    // Origin coincide con Host → validateOrigin pasa. Luego falla por auth (no Bearer).
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(401);
  });
});
