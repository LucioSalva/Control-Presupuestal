/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: B-1 (presupuesto.routes.js auth)
 * ================================================================
 *  Verifica que presupuestoRouter ahora aplica authRequired a
 *  nivel router y que DELETE /api/project es GOD-only.
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

const app = createTestApp();

function mockUser(roles) {
  query.mockResolvedValueOnce({
    rows: [{ id: 1, activo: true, id_dgeneral: 2, id_dauxiliar: 3, roles }],
    rowCount: 1,
  });
}

describe("B-1: presupuesto.routes.js exige autenticación", () => {
  beforeEach(() => query.mockReset());

  it("POST /api/detalles sin token retorna 401", async () => {
    const res = await request(app)
      .post("/api/detalles")
      .send({ project: "A001", partida: "2001", presupuesto: 1000 });
    expect(res.status).toBe(401);
  });

  it("DELETE /api/project sin token retorna 401", async () => {
    const res = await request(app).delete("/api/project").query({ project: "A001" });
    expect(res.status).toBe(401);
  });

  it("GET /api/projects sin token retorna 401", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(401);
  });

  it("GET /api/detalles sin token retorna 401", async () => {
    const res = await request(app).get("/api/detalles").query({ project: "A001" });
    expect(res.status).toBe(401);
  });
});

describe("B-1: DELETE /api/project es GOD-only", () => {
  beforeEach(() => query.mockReset());

  it("DELETE como AREA retorna 403", async () => {
    mockUser(["AREA"]);
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .delete("/api/project")
      .query({ project: "A001" })
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["AREA"] })}`);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("DELETE como ADMIN retorna 403 (no GOD)", async () => {
    mockUser(["ADMIN"]);
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .delete("/api/project")
      .query({ project: "A001" })
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["ADMIN"] })}`);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/GOD/i);
  });

  it("DELETE como GOD elimina y retorna ok:true", async () => {
    mockUser(["GOD"]);
    // segunda query: DELETE FROM presupuesto_detalle
    query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .delete("/api/project")
      .query({ project: "A001" })
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["GOD"] })}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("deleted_rows", 3);
  });

  it("DELETE como GOD sin query param project retorna 400", async () => {
    mockUser(["GOD"]);
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .delete("/api/project")
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["GOD"] })}`);

    expect(res.status).toBe(400);
  });
});

describe("B-1: POST /api/detalles requiere GOD/ADMIN", () => {
  beforeEach(() => query.mockReset());

  it("POST como AREA retorna 403", async () => {
    mockUser(["AREA"]);
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app)
      .post("/api/detalles")
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["AREA"] })}`)
      .send({ project: "A001", partida: "2001", presupuesto: 1000, mes: "ENERO" });

    expect(res.status).toBe(403);
  });
});
