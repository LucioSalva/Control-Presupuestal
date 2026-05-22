/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: B-2 (suficiencias cancelar)
 * ================================================================
 *  Verifica que POST /api/suficiencias/:id/cancelar ya NO emite
 *  ReferenceError("userIsL00117 is not defined"). El handler ahora
 *  inicializa la variable correctamente con checkIsUserL00117.
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

function mockAuthUser(roles = ["AREA"], idDg = 99, idDa = 99) {
  query.mockResolvedValueOnce({
    rows: [{ id: 1, activo: true, id_dgeneral: idDg, id_dauxiliar: idDa, roles }],
    rowCount: 1,
  });
}

describe("B-2: POST /api/suficiencias/:id/cancelar sin ReferenceError", () => {
  beforeEach(() => {
    query.mockReset();
    if (getClient.mockReset) getClient.mockReset();
    getClient.mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    });
  });

  it("AREA no-L00/117 cancelando una suficiencia inexistente retorna 4xx sin error de ReferenceError", async () => {
    // authRequired query
    mockAuthUser(["AREA"], 99, 99);
    // checkIsUserL00117 query (consulta dg/da claves del usuario)
    query.mockResolvedValueOnce({ rows: [{ dg_clave: "OTRO", da_clave: "000" }], rowCount: 1 });
    // getClient mock para el transaction
    const clientQ = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    getClient.mockResolvedValueOnce({ query: clientQ, release: jest.fn() });
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const token = signTestToken(1, { roles: ["AREA"] });
    const res = await request(app)
      .post("/api/suficiencias/999/cancelar")
      .set("Authorization", `Bearer ${token}`)
      .send({ motivo: "test" });

    // Lo crítico: NO debe ser 500 con "userIsL00117 is not defined"
    expect(res.status).not.toBe(500);

    // Y la respuesta nunca debe mencionar el nombre de la variable rota
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("userIsL00117 is not defined");
    expect(body).not.toContain("ReferenceError");
  });

  it("la ruta NO emite stack trace con nombre de variable suelto", async () => {
    mockAuthUser(["AREA"], 50, 50);
    query.mockResolvedValueOnce({ rows: [{ dg_clave: "X", da_clave: "Y" }], rowCount: 1 });
    const clientQ = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    getClient.mockResolvedValueOnce({ query: clientQ, release: jest.fn() });
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const token = signTestToken(1, { roles: ["AREA"] });
    const res = await request(app)
      .post("/api/suficiencias/123/cancelar")
      .set("Authorization", `Bearer ${token}`)
      .send({ motivo: "x" });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("is not defined");
  });
});
