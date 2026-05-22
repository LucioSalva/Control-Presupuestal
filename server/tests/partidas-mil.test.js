/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: C-3 + C-4 (partidas mil)
 * ================================================================
 *  - GET /api/catalogos/partidas filtra claves 1xxx para usuarios
 *    que no son L00/117 ni E00.
 *  - POST /api/catalogos/partidas/monto con clave 1xxx como AREA
 *    no-L00/117 → 403 vía blockPartidasMilAccess.
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

/**
 * Configura el mock de query con routing por SQL.
 *
 * El factory monta DOS cadenas authRequired diferentes que ejecutan
 * la misma SELECT de usuarios:
 *   1) presupuestoRouter.use(authRequired) (montado en /api)
 *   2) app.use("/api/catalogos/partidas", authRequired, ...) (factory)
 *
 * Si usamos mockResolvedValueOnce en cola, ambos consumen mocks
 * distintos y rompen el orden. La solución es mockear por patrón SQL:
 * la SELECT de usuarios SIEMPRE retorna el mismo user activo, y el
 * resto de queries (que son las que importan en el test) se manejan
 * con `queueExtra(rows)` que las encola en orden.
 */
function setupAuthQueryMock(roles = ["AREA"], idDg = 99, idDa = 99) {
  const userRow = { id: 1, activo: true, id_dgeneral: idDg, id_dauxiliar: idDa, roles };
  const extraQueue = [];
  const fallback = { rows: [], rowCount: 0 };

  query.mockImplementation((sql) => {
    const s = String(sql || "");
    // SELECT u.id ... FROM usuarios WHERE u.id = $1 (authRequired)
    if (/FROM usuarios/i.test(s) && /u\.id/i.test(s)) {
      return Promise.resolve({ rows: [userRow], rowCount: 1 });
    }
    // checkIsUserL00117: SELECT dg.clave AS dg_clave, da.clave AS da_clave FROM usuarios
    if (/dg_clave/i.test(s) && /FROM usuarios/i.test(s)) {
      return Promise.resolve({
        rows: [{ dg_clave: "OTRO", da_clave: "000" }],
        rowCount: 1,
      });
    }
    // checkIsUserE00: SELECT dg.clave FROM usuarios
    if (/dg\.clave/i.test(s) && /FROM usuarios/i.test(s)) {
      return Promise.resolve({ rows: [{ clave: "OTRO" }], rowCount: 1 });
    }
    // getUserDGDA en partidas: subselects sobre dgeneral/dauxiliar
    if (/SELECT[\s\S]*FROM public\.dgeneral/i.test(s)) {
      return Promise.resolve({ rows: [{ dg: "OTRO", da: "000" }], rowCount: 1 });
    }
    // Resto: dequeue extras (en orden)
    if (extraQueue.length > 0) return Promise.resolve(extraQueue.shift());
    return Promise.resolve(fallback);
  });

  return {
    /** Encola la siguiente respuesta para queries que no son de auth. */
    queueExtra(rows, rowCount = rows.length) {
      extraQueue.push({ rows, rowCount });
    },
    /** Sobrescribe los retornos de checkIsUserL00117 y checkIsUserE00. */
    setUserDgDa(dg, da) {
      query.mockImplementation((sql) => {
        const s = String(sql || "");
        if (/FROM usuarios/i.test(s) && /u\.id/i.test(s)) {
          return Promise.resolve({ rows: [userRow], rowCount: 1 });
        }
        if (/dg_clave/i.test(s) && /FROM usuarios/i.test(s)) {
          return Promise.resolve({ rows: [{ dg_clave: dg, da_clave: da }], rowCount: 1 });
        }
        if (/dg\.clave/i.test(s) && /FROM usuarios/i.test(s)) {
          return Promise.resolve({ rows: [{ clave: dg }], rowCount: 1 });
        }
        if (/SELECT[\s\S]*FROM public\.dgeneral/i.test(s)) {
          return Promise.resolve({ rows: [{ dg, da }], rowCount: 1 });
        }
        if (extraQueue.length > 0) return Promise.resolve(extraQueue.shift());
        return Promise.resolve(fallback);
      });
    },
  };
}

describe("C-3: GET /api/catalogos/partidas filtra 1xxx", () => {
  beforeEach(() => {
    // jest.clearAllMocks NO limpia mockResolvedValueOnce en cola.
    // Reseteamos solo la implementación de query (NO getClient para preservar
    // el mock por defecto del factory).
    query.mockReset();
  });

  it("AREA no-L00/117 no ve claves 1xxx en el listado", async () => {
    const m = setupAuthQueryMock(["AREA"], 99, 99);
    m.setUserDgDa("OTRO", "000");
    // El SELECT principal de partidas se identifica por "FROM public.partidas".
    // Redefinimos la implementación para capturarlo:
    query.mockImplementation((sql) => {
      const s = String(sql || "");
      if (/FROM usuarios/i.test(s) && /u\.id/i.test(s)) {
        return Promise.resolve({
          rows: [{ id: 1, activo: true, id_dgeneral: 99, id_dauxiliar: 99, roles: ["AREA"] }],
          rowCount: 1,
        });
      }
      if (/dg_clave/i.test(s) && /FROM usuarios/i.test(s)) {
        return Promise.resolve({ rows: [{ dg_clave: "OTRO", da_clave: "000" }], rowCount: 1 });
      }
      if (/dg\.clave/i.test(s) && /FROM usuarios/i.test(s)) {
        return Promise.resolve({ rows: [{ clave: "OTRO" }], rowCount: 1 });
      }
      if (/FROM public\.dgeneral/i.test(s)) {
        return Promise.resolve({ rows: [{ dg: "OTRO", da: "000" }], rowCount: 1 });
      }
      if (/FROM public\.partidas/i.test(s)) {
        return Promise.resolve({
          rows: [
            { clave: "1100", partida: "Mil", monto: 0, capturada: false },
            { clave: "2200", partida: "Otra", monto: 100, capturada: true },
            { clave: "3300", partida: "Tercera", monto: 50, capturada: false },
          ],
          rowCount: 3,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .get("/api/catalogos/partidas")
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["AREA"] })}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    const claves = res.body.rows.map((r) => r.clave);
    expect(claves).not.toContain("1100");
    expect(claves).toContain("2200");
    expect(claves).toContain("3300");
  });

  it("L00/117 SÍ ve claves 1xxx", async () => {
    query.mockImplementation((sql) => {
      const s = String(sql || "");
      if (/FROM usuarios/i.test(s) && /u\.id/i.test(s) && /AS roles/i.test(s)) {
        return Promise.resolve({
          rows: [{ id: 1, activo: true, id_dgeneral: 1, id_dauxiliar: 1, roles: ["AREA"] }],
          rowCount: 1,
        });
      }
      // checkIsUserL00117: SELECT dg.clave AS dg_clave, da.clave AS da_clave FROM usuarios u JOIN dgeneral dg ... JOIN dauxiliar da
      if (/da_clave/i.test(s) && /FROM usuarios/i.test(s)) {
        return Promise.resolve({ rows: [{ dg_clave: "L00", da_clave: "117" }], rowCount: 1 });
      }
      // checkIsUserE00: SELECT dg.clave FROM usuarios (sin da_clave)
      if (/FROM usuarios/i.test(s) && /JOIN dgeneral/i.test(s) && !/da_clave/i.test(s)) {
        return Promise.resolve({ rows: [{ clave: "L00" }], rowCount: 1 });
      }
      // getUserDGDA (en partidas.routes.js)
      if (/FROM public\.dgeneral/i.test(s) && /FROM public\.dauxiliar/i.test(s)) {
        return Promise.resolve({ rows: [{ dg: "L00", da: "117" }], rowCount: 1 });
      }
      if (/FROM public\.partidas/i.test(s)) {
        return Promise.resolve({
          rows: [
            { clave: "1100", partida: "Mil", monto: 0, capturada: false },
            { clave: "2200", partida: "Otra", monto: 100, capturada: true },
          ],
          rowCount: 2,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .get("/api/catalogos/partidas")
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["AREA"] })}`);

    expect(res.status).toBe(200);
    const claves = res.body.rows.map((r) => r.clave);
    expect(claves).toContain("1100");
  });

  it("E00 SÍ ve claves 1xxx", async () => {
    query.mockImplementation((sql) => {
      const s = String(sql || "");
      if (/FROM usuarios/i.test(s) && /u\.id/i.test(s) && /AS roles/i.test(s)) {
        return Promise.resolve({
          rows: [{ id: 1, activo: true, id_dgeneral: 5, id_dauxiliar: 1, roles: ["AREA"] }],
          rowCount: 1,
        });
      }
      if (/da_clave/i.test(s) && /FROM usuarios/i.test(s)) {
        // No L00/117
        return Promise.resolve({ rows: [{ dg_clave: "E00", da_clave: "001" }], rowCount: 1 });
      }
      if (/FROM usuarios/i.test(s) && /JOIN dgeneral/i.test(s) && !/da_clave/i.test(s)) {
        // checkIsUserE00 → es E00
        return Promise.resolve({ rows: [{ clave: "E00" }], rowCount: 1 });
      }
      if (/FROM public\.dgeneral/i.test(s) && /FROM public\.dauxiliar/i.test(s)) {
        return Promise.resolve({ rows: [{ dg: "E00", da: "001" }], rowCount: 1 });
      }
      if (/FROM public\.partidas/i.test(s)) {
        return Promise.resolve({
          rows: [{ clave: "1100", partida: "Mil", monto: 0, capturada: false }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .get("/api/catalogos/partidas")
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["AREA"] })}`);

    expect(res.status).toBe(200);
    const claves = res.body.rows.map((r) => r.clave);
    expect(claves).toContain("1100");
  });
});

describe("C-3: POST /api/catalogos/partidas/monto bloquea 1xxx para AREA", () => {
  beforeEach(() => {
    // jest.clearAllMocks NO limpia mockResolvedValueOnce en cola.
    // Reseteamos solo la implementación de query (NO getClient para preservar
    // el mock por defecto del factory).
    query.mockReset();
  });

  it("AREA no-L00/117 con clave 1100 → 403", async () => {
    query.mockImplementation((sql) => {
      const s = String(sql || "");
      if (/FROM usuarios/i.test(s) && /u\.id/i.test(s)) {
        return Promise.resolve({
          rows: [{ id: 1, activo: true, id_dgeneral: 99, id_dauxiliar: 99, roles: ["AREA"] }],
          rowCount: 1,
        });
      }
      if (/dg_clave/i.test(s) && /FROM usuarios/i.test(s)) {
        return Promise.resolve({ rows: [{ dg_clave: "OTRO", da_clave: "000" }], rowCount: 1 });
      }
      if (/dg\.clave/i.test(s) && /FROM usuarios/i.test(s)) {
        return Promise.resolve({ rows: [{ clave: "OTRO" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .post("/api/catalogos/partidas/monto")
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["AREA"] })}`)
      .send({ clave: "1100", monto: 5000 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permisos|partidas mil/i);
  });

  it("AREA no-L00/117 con clave 2200 (no-mil) NO es bloqueado por el guard de mil", async () => {
    query.mockImplementation((sql) => {
      const s = String(sql || "");
      if (/FROM usuarios/i.test(s) && /u\.id/i.test(s)) {
        return Promise.resolve({
          rows: [{ id: 1, activo: true, id_dgeneral: 99, id_dauxiliar: 99, roles: ["AREA"] }],
          rowCount: 1,
        });
      }
      if (/FROM public\.dgeneral/i.test(s)) {
        return Promise.resolve({ rows: [{ dg: "OTRO", da: "000" }], rowCount: 1 });
      }
      if (/INSERT|UPDATE/i.test(s) && /partidas/i.test(s)) {
        return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .post("/api/catalogos/partidas/monto")
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["AREA"] })}`)
      .send({ clave: "2200", monto: 5000 });

    if (res.status === 403) {
      expect(String(res.body.error || "")).not.toMatch(/partidas mil/i);
    }
  });
});
