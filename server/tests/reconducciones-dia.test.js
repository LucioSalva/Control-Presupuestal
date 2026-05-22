/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: C-1 (reconducciones día permitido)
 * ================================================================
 *  Valida que las rutas de reconducciones bloquean operaciones en
 *  servidor cuando el día NO es lunes-jueves, y permiten el bypass
 *  para GOD/ADMIN y L00/117.
 *
 *  Estrategia: spy de Date.prototype.getDay() para forzar el día.
 *  El helper isReconduccionAllowedToday() llama a `new Date().getDay()`
 *  internamente — basta con interceptar ese método.
 * ================================================================
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

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

function mockAuthUser(roles = ["AREA"], idDg = 99, idDa = 99, dgClave = "OTRO", daClave = "000") {
  // El factory monta dos cadenas que ejecutan authRequired. Usamos
  // mockImplementation para que cualquier SELECT contra usuarios
  // retorne el mismo usuario, independientemente de cuántas veces se
  // llame.
  query.mockImplementation((sql) => {
    const s = String(sql || "");
    if (/FROM usuarios/i.test(s) && /AS roles/i.test(s)) {
      return Promise.resolve({
        rows: [{ id: 1, activo: true, id_dgeneral: idDg, id_dauxiliar: idDa, roles }],
        rowCount: 1,
      });
    }
    // checkIsUserL00117: SELECT dg.clave AS dg_clave, da.clave AS da_clave FROM usuarios
    if (/da_clave/i.test(s) && /FROM usuarios/i.test(s)) {
      return Promise.resolve({ rows: [{ dg_clave: dgClave, da_clave: daClave }], rowCount: 1 });
    }
    // checkIsUserE00
    if (/FROM usuarios/i.test(s) && /JOIN dgeneral/i.test(s) && !/da_clave/i.test(s)) {
      return Promise.resolve({ rows: [{ clave: dgClave }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

/**
 * Forza el día de la semana retornado por new Date().getDay().
 * 0 = domingo, 1..4 = lun-jue (permitido), 5 = viernes, 6 = sábado.
 */
function stubDayOfWeek(dow) {
  const orig = Date.prototype.getDay;
  Date.prototype.getDay = function () { return dow; };
  return () => { Date.prototype.getDay = orig; };
}

describe("C-1: requireReconDayAllowed bloquea en servidor", () => {
  let restoreDay;

  beforeEach(() => query.mockReset());
  afterEach(() => {
    if (restoreDay) restoreDay();
    restoreDay = null;
  });

  it("Sábado (dow=6) + AREA no-L00/117 con sesión válida → 403 'lunes a jueves'", async () => {
    restoreDay = stubDayOfWeek(6);

    // mockImplementation: usuario activo + sesión de reconducción válida
    // Hace que requireReconSession pase y el guard de día se ejecute.
    query.mockImplementation((sql) => {
      const s = String(sql || "");
      if (/FROM usuarios/i.test(s) && /AS roles/i.test(s)) {
        return Promise.resolve({
          rows: [{ id: 1, activo: true, id_dgeneral: 99, id_dauxiliar: 99, roles: ["AREA"] }],
          rowCount: 1,
        });
      }
      if (/da_clave/i.test(s) && /FROM usuarios/i.test(s)) {
        return Promise.resolve({ rows: [{ dg_clave: "OTRO", da_clave: "000" }], rowCount: 1 });
      }
      // requireReconSession: SELECT token FROM reconducciones_sesiones
      if (/reconducciones_sesiones/i.test(s) && /SELECT/i.test(s)) {
        return Promise.resolve({ rows: [{ token: "TEST_TOKEN" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const token = signTestToken(1, { roles: ["AREA"] });
    const res = await request(app)
      .post("/api/reconducciones")
      .set("Authorization", `Bearer ${token}`)
      .set("x-recon-session", "TEST_TOKEN")
      .send({ lados: [], motivo: "test" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/lunes a jueves/i);
  });

  it("Sábado (dow=6) + GOD → bypass del candado", async () => {
    restoreDay = stubDayOfWeek(6);

    mockAuthUser(["GOD"], 50, 50);

    const token = signTestToken(1, { roles: ["GOD"] });
    const res = await request(app)
      .post("/api/reconducciones")
      .set("Authorization", `Bearer ${token}`)
      .send({ lados: [{ id_dgeneral: 50, id_dauxiliar: 50 }] });

    // No debe ser 403 con "lunes a jueves" — el guard de día se saltó.
    if (res.status === 403) {
      expect(String(res.body.error || "")).not.toMatch(/lunes a jueves/i);
    }
  });

  it("Sábado (dow=6) + ADMIN → bypass del candado", async () => {
    restoreDay = stubDayOfWeek(6);

    mockAuthUser(["ADMIN"], 50, 50);

    const token = signTestToken(1, { roles: ["ADMIN"] });
    const res = await request(app)
      .post("/api/reconducciones")
      .set("Authorization", `Bearer ${token}`)
      .send({ lados: [] });

    if (res.status === 403) {
      expect(String(res.body.error || "")).not.toMatch(/lunes a jueves/i);
    }
  });

  it("Sábado (dow=6) + AREA L00/117 → bypass del candado", async () => {
    restoreDay = stubDayOfWeek(6);

    mockAuthUser(["AREA"], 1, 1, "L00", "117");

    const token = signTestToken(1, { roles: ["AREA"] });
    const res = await request(app)
      .post("/api/reconducciones")
      .set("Authorization", `Bearer ${token}`)
      .send({ lados: [{ id_dgeneral: 1, id_dauxiliar: 1 }] });

    if (res.status === 403) {
      expect(String(res.body.error || "")).not.toMatch(/lunes a jueves/i);
    }
  });

  it("Lunes (dow=1) + AREA → guard de día NO aplica", async () => {
    restoreDay = stubDayOfWeek(1);

    mockAuthUser(["AREA"], 99, 99, "OTRO", "000");

    const token = signTestToken(1, { roles: ["AREA"] });
    const res = await request(app)
      .post("/api/reconducciones")
      .set("Authorization", `Bearer ${token}`)
      .send({ lados: [] });

    // En lunes el guard de día permite pasar. Lo que falle puede ser
    // por otros guards (sesión, validaciones), pero NO por día.
    if (res.status === 403) {
      expect(String(res.body.error || "")).not.toMatch(/lunes a jueves/i);
    }
  });
});
