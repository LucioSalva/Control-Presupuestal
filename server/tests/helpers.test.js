/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: utils/helpers.js
 * ================================================================
 *  Cubre funciones puras que no requieren BD.
 *  Casos: BUG-001 (computeTotal), BUG-008 (isPartidaMilKey),
 *         CP-007 (validateMesPago), computeSaldo.
 * ================================================================
 */

// Mock de db.js debe declararse ANTES de cualquier import que lo use
import { jest, describe, it, expect } from "@jest/globals";

jest.mock("../db.js", () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  getClient: jest.fn(() =>
    Promise.resolve({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    })
  ),
}));

// Importar las funciones puras de helpers después del mock
const { computeTotal, isPartidaMilKey, validateMesPago, computeSaldo } =
  await import("../utils/helpers.js");

// =====================================================
//  computeTotal()
// =====================================================
describe("computeTotal()", () => {
  it("BUG-001: incluye ieps y pension_total cuando allowIEPS=true", () => {
    const total = computeTotal(
      { subtotal: 1000, iva: 160, isr: 50, ieps: 100, pension_total: 200 },
      true
    );
    // 1000 + 160 + 50 + 100 + 200 = 1510
    expect(total).toBe(1510);
  });

  it("BUG-001: excluye ieps y pension_total cuando allowIEPS=false", () => {
    const total = computeTotal(
      { subtotal: 1000, iva: 160, isr: 50, ieps: 100, pension_total: 200 },
      false
    );
    // solo subtotal + iva + isr = 1000 + 160 + 50 = 1210
    expect(total).toBe(1210);
  });

  it("redondea a 2 decimales con Math.round", () => {
    // 100.005 * 100 = 10000.5 → round → 10001 → /100 = 100.01
    // 16.001 * 100 = 1600.1 → round → 1600 → /100 = 16
    // suma: 116.005 * 100 = 11600.5 → round → 11601 → /100 = 116.01
    const total = computeTotal({ subtotal: 100.005, iva: 16.001, isr: 0, ieps: 0, pension_total: 0 }, true);
    expect(total).toBe(116.01);
  });

  it("retorna 0 cuando todos los campos son 0 o falsy", () => {
    expect(computeTotal({}, true)).toBe(0);
    expect(computeTotal({ subtotal: 0, iva: 0, isr: 0, ieps: 0, pension_total: 0 }, false)).toBe(0);
  });

  it("tolera valores no numéricos convirtiéndolos a 0", () => {
    const total = computeTotal({ subtotal: "abc", iva: null, isr: undefined }, true);
    expect(total).toBe(0);
  });

  it("subtotal sin IVA retorna solo el subtotal", () => {
    expect(computeTotal({ subtotal: 5000 }, true)).toBe(5000);
  });
});

// =====================================================
//  isPartidaMilKey()
// =====================================================
describe("isPartidaMilKey()", () => {
  it("BUG-008: detecta partida 1001 como partida mil", () => {
    expect(isPartidaMilKey("1001")).toBe(true);
  });

  it("BUG-008: detecta partida 1500 como partida mil", () => {
    expect(isPartidaMilKey("1500")).toBe(true);
  });

  it("BUG-008: detecta partida 1000 como partida mil", () => {
    expect(isPartidaMilKey("1000")).toBe(true);
  });

  it("BUG-008: 2001 NO es partida mil", () => {
    expect(isPartidaMilKey("2001")).toBe(false);
  });

  it("BUG-008: clave alfanumérica A001 NO es partida mil", () => {
    expect(isPartidaMilKey("A001")).toBe(false);
  });

  it("BUG-008: string vacío retorna false", () => {
    expect(isPartidaMilKey("")).toBe(false);
  });

  it("BUG-008: null retorna false", () => {
    expect(isPartidaMilKey(null)).toBe(false);
  });

  it("BUG-008: undefined retorna false", () => {
    expect(isPartidaMilKey(undefined)).toBe(false);
  });

  it("BUG-008: clave 9999 NO es partida mil", () => {
    expect(isPartidaMilKey("9999")).toBe(false);
  });

  it("detecta partida mil con espacios alrededor (trim)", () => {
    // isPartidaMilKey hace String(clave).trim() antes de evaluar
    expect(isPartidaMilKey("  1200  ")).toBe(true);
  });
});

// =====================================================
//  validateMesPago()
// =====================================================
describe("validateMesPago()", () => {
  it("acepta ENERO en mayúsculas", () => {
    expect(validateMesPago("ENERO")).toBe(true);
  });

  it("acepta DICIEMBRE en mayúsculas", () => {
    expect(validateMesPago("DICIEMBRE")).toBe(true);
  });

  it("acepta enero en minúsculas (case-insensitive)", () => {
    expect(validateMesPago("enero")).toBe(true);
  });

  it("acepta Marzo en mixed case", () => {
    expect(validateMesPago("Marzo")).toBe(true);
  });

  it("CP-007: rechaza INVALIDO", () => {
    expect(validateMesPago("INVALIDO")).toBe(false);
  });

  it("CP-007: rechaza JANUARY (mes en inglés)", () => {
    expect(validateMesPago("JANUARY")).toBe(false);
  });

  it("CP-007: rechaza cadena numérica '01'", () => {
    expect(validateMesPago("01")).toBe(false);
  });

  it("acepta null (campo opcional)", () => {
    expect(validateMesPago(null)).toBe(true);
  });

  it("acepta string vacío (campo opcional)", () => {
    expect(validateMesPago("")).toBe(true);
  });

  it("acepta undefined (campo opcional)", () => {
    expect(validateMesPago(undefined)).toBe(true);
  });

  it("acepta los 12 meses del año", () => {
    const meses = [
      "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
      "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
    ];
    for (const mes of meses) {
      expect(validateMesPago(mes)).toBe(true);
    }
  });
});

// =====================================================
//  computeSaldo()
// =====================================================
describe("computeSaldo()", () => {
  it("calcula saldo = presupuesto - total_gastado + total_reconducido", () => {
    const saldo = computeSaldo({
      presupuesto: 100000,
      total_gastado: 30000,
      total_reconducido: 5000,
    });
    expect(saldo).toBe(75000);
  });

  it("saldo negativo cuando gasto supera presupuesto", () => {
    const saldo = computeSaldo({
      presupuesto: 10000,
      total_gastado: 15000,
      total_reconducido: 0,
    });
    expect(saldo).toBe(-5000);
  });

  it("saldo igual al presupuesto cuando no hay gasto ni reconducción", () => {
    const saldo = computeSaldo({
      presupuesto: 50000,
      total_gastado: 0,
      total_reconducido: 0,
    });
    expect(saldo).toBe(50000);
  });

  it("usa 0 por defecto en campos faltantes", () => {
    const saldo = computeSaldo({ presupuesto: 20000 });
    expect(saldo).toBe(20000);
  });

  it("retorna 0 con objeto vacío", () => {
    const saldo = computeSaldo({});
    expect(saldo).toBe(0);
  });
});
