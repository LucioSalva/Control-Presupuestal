/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: C-2 (lock saldo antes de leer)
 * ================================================================
 *  Verifica que POST /api/suficiencias y POST /api/suficiencias/lote
 *  llaman fn_lock_partida_para_saldo ANTES de fn_saldo_disponible_partida
 *  dentro de la misma transacción (BEGIN ... COMMIT).
 * ================================================================
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

jest.unstable_mockModule("../db.js", () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
  getClient: jest.fn(),
}));

const { default: request } = await import("supertest");
const { query, getClient } = await import("../db.js");
const { createTestApp, signTestToken } = await import("./app-test-factory.js");

const app = createTestApp();

function mockAuthAsAdmin() {
  query.mockResolvedValueOnce({
    rows: [{ id: 1, activo: true, id_dgeneral: 1, id_dauxiliar: 1, roles: ["ADMIN"] }],
    rowCount: 1,
  });
}

describe("C-2: orden de queries — lock ANTES de saldo", () => {
  beforeEach(() => {
    query.mockReset();
    if (getClient.mockReset) getClient.mockReset();
  });

  it("POST /api/suficiencias llama fn_lock_partida_para_saldo antes de fn_saldo_disponible_partida", async () => {
    mockAuthAsAdmin();
    // canViewIepsPensiones queries (rol-based ahora) — no se consultan DG/DA en nueva versión, pero por compatibilidad mockeamos
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const calls = [];
    const clientQ = jest.fn((sql, params) => {
      const s = String(sql || "");
      if (s.includes("fn_lock_partida_para_saldo")) calls.push({ type: "lock", params });
      else if (s.includes("fn_saldo_disponible_partida")) calls.push({ type: "saldo", params });
      else if (/^\s*BEGIN/i.test(s)) calls.push({ type: "begin" });
      else if (/^\s*COMMIT/i.test(s)) calls.push({ type: "commit" });
      else if (/^\s*ROLLBACK/i.test(s)) calls.push({ type: "rollback" });

      // Devolver saldo suficiente para que el flujo proceda
      if (s.includes("fn_saldo_disponible_partida")) {
        return Promise.resolve({
          rows: [{ saldo_disponible: 1000000, presupuesto_base: 1000000, reservado_suficiencias: 0 }],
          rowCount: 1,
        });
      }
      if (s.includes("fn_next_folio")) {
        return Promise.resolve({ rows: [{ next_num: 1 }], rowCount: 1 });
      }
      if (/INSERT INTO suficiencias/i.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, folio_num: 1, no_suficiencia: "ECA-2026-05-SP-0001" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    getClient.mockResolvedValue({ query: clientQ, release: jest.fn() });

    const res = await request(app)
      .post("/api/suficiencias")
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["ADMIN"] })}`)
      .send({
        mes_pago: "ENERO",
        subtotal: 500,
        iva: 80,
        clave_programatica: "2001",
        id_dgeneral: 1,
        id_dauxiliar: 1,
        id_fuente: 1,
        id_proyecto: 1,
        detalle: [
          { renglon: 1, clave: "2001", concepto_partida: "C", justificacion: "J", descripcion: "D", importe: 580 },
        ],
      });

    // No nos importa el status final del HTTP, sino el orden de llamadas a la DB.
    // BEGIN debe ocurrir, luego al menos un lock, luego al menos un saldo.
    const idxBegin = calls.findIndex((c) => c.type === "begin");
    const idxLock = calls.findIndex((c) => c.type === "lock");
    const idxSaldo = calls.findIndex((c) => c.type === "saldo");

    expect(idxBegin).toBeGreaterThanOrEqual(0);
    expect(idxLock).toBeGreaterThan(idxBegin);
    expect(idxSaldo).toBeGreaterThan(idxLock);
  });

  it("POST /api/suficiencias/lote también respeta orden: BEGIN → lock → saldo", async () => {
    mockAuthAsAdmin();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const calls = [];
    const clientQ = jest.fn((sql) => {
      const s = String(sql || "");
      if (s.includes("fn_lock_partida_para_saldo")) calls.push({ type: "lock" });
      else if (s.includes("fn_saldo_disponible_partida")) calls.push({ type: "saldo" });
      else if (/^\s*BEGIN/i.test(s)) calls.push({ type: "begin" });

      if (s.includes("fn_saldo_disponible_partida")) {
        return Promise.resolve({
          rows: [{ saldo_disponible: 1000000, presupuesto_base: 1000000, reservado_suficiencias: 0 }],
          rowCount: 1,
        });
      }
      if (s.includes("fn_next_folio")) {
        return Promise.resolve({ rows: [{ next_num: 1 }], rowCount: 1 });
      }
      if (/INSERT INTO suficiencias/i.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, folio_num: 1, no_suficiencia: "ECA-2026-05-SP-0001" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    getClient.mockResolvedValue({ query: clientQ, release: jest.fn() });

    await request(app)
      .post("/api/suficiencias/lote")
      .set("Authorization", `Bearer ${signTestToken(1, { roles: ["ADMIN"] })}`)
      .send({
        suficiencias: [
          {
            mes_pago: "ENERO",
            subtotal: 500,
            clave_programatica: "2001",
            id_dgeneral: 1,
            id_dauxiliar: 1,
            id_fuente: 1,
            id_proyecto: 1,
            detalle: [{ renglon: 1, clave: "2001", concepto_partida: "C", justificacion: "J", descripcion: "D", importe: 500 }],
          },
        ],
      });

    const idxBegin = calls.findIndex((c) => c.type === "begin");
    const idxLock = calls.findIndex((c) => c.type === "lock");
    const idxSaldo = calls.findIndex((c) => c.type === "saldo");

    expect(idxBegin).toBeGreaterThanOrEqual(0);
    expect(idxLock).toBeGreaterThan(idxBegin);
    expect(idxSaldo).toBeGreaterThan(idxLock);
  });
});
