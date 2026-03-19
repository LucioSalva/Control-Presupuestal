/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: suficiencias.routes.js
 * ================================================================
 *  Casos cubiertos:
 *    CP-005: GET /saldo-partida con parámetros válidos retorna saldo
 *    CP-006: Saldo insuficiente en POST retorna 400 con errores_saldo
 *    CP-007: mes_pago inválido retorna 400 con mención de mes_pago
 *    CP-008: Lote vacío retorna 400
 *    CP-009: Lote con más de 20 items retorna 400
 *    CP-010: GET /saldo-partida sin parámetros retorna 400
 *    CP-011: GET /next-folio retorna número de folio
 * ================================================================
 */
import request from "supertest";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Mock de BD antes de cualquier import
jest.mock("../db.js", () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const { query, getClient } = await import("../db.js");
const { createTestApp } = await import("./app-test-factory.js");

const app = createTestApp();

// =====================================================
//  Helpers
// =====================================================
const makeToken = (userId = 1) => `token-${userId}-${Date.now()}`;

/**
 * Mockea el middleware authRequired.
 * La query que hace authRequired es la SELECT de usuarios con roles.
 */
function mockAuthUser(overrides = {}) {
  query.mockResolvedValueOnce({
    rows: [{
      id: 1,
      activo: true,
      id_dgeneral: 2,
      id_dauxiliar: 3,
      roles: ["AREA"],
      ...overrides,
    }],
    rowCount: 1,
  });
}

/**
 * Mockea la secuencia de queries necesaria para que canViewIepsPensiones
 * funcione (consulta dgeneral y dauxiliar).
 */
function mockDgDaClaves(dgClave = "L01", daClave = "101") {
  query.mockResolvedValueOnce({ rows: [{ clave: dgClave }], rowCount: 1 });
  query.mockResolvedValueOnce({ rows: [{ clave: daClave }], rowCount: 1 });
}

/**
 * Mockea un cliente de BD (getClient) con transacciones.
 */
function mockDbClient(clientQueryMock) {
  const mockClient = {
    query: clientQueryMock || jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
  getClient.mockResolvedValue(mockClient);
  return mockClient;
}

/**
 * Queries residuales de logAuditEvent / ensureAuditoriaEventosSchema.
 * Las mockeamos con respuesta vacía para no romper el flujo.
 */
function mockAuditResiduales() {
  query.mockResolvedValue({ rows: [], rowCount: 0 });
}

// =====================================================
//  SUITE: GET /api/suficiencias/saldo-partida
// =====================================================
describe("CP-005 / CP-010: GET /api/suficiencias/saldo-partida", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("CP-005: retorna saldo disponible con parámetros válidos", async () => {
    mockAuthUser();
    // Mock de la función DB fn_saldo_disponible_partida
    query.mockResolvedValueOnce({
      rows: [{
        presupuesto_base: 100000,
        reservado_suficiencias: 20000,
        comprometido_vigente: 5000,
        devengado_en_cerrados: 0,
        saldo_disponible: 75000,
      }],
      rowCount: 1,
    });

    const res = await request(app)
      .get("/api/suficiencias/saldo-partida")
      .set("Authorization", `Bearer ${makeToken()}`)
      .query({
        id_dgeneral: 2,
        id_dauxiliar: 3,
        id_fuente: 1,
        id_proyecto: 1,
        clave: "2001",
        mes_pago: "MARZO",
        ejercicio: 2026,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("saldo_disponible");
    expect(res.body.saldo_disponible).toBe(75000);
    expect(res.body).toHaveProperty("presupuesto_base", 100000);
  });

  it("CP-010: sin parámetros obligatorios retorna 400", async () => {
    mockAuthUser();

    const res = await request(app)
      .get("/api/suficiencias/saldo-partida")
      .set("Authorization", `Bearer ${makeToken()}`);
    // Sin ningún query param

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("CP-010: mes_pago inválido en saldo-partida retorna 400", async () => {
    mockAuthUser();

    const res = await request(app)
      .get("/api/suficiencias/saldo-partida")
      .set("Authorization", `Bearer ${makeToken()}`)
      .query({
        id_dgeneral: 2, id_dauxiliar: 3, id_fuente: 1,
        id_proyecto: 1, clave: "2001", mes_pago: "BADMONTH",
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/mes_pago/i);
  });

  it("retorna saldo 0 cuando la partida no tiene presupuesto registrado", async () => {
    mockAuthUser();
    // fn_saldo_disponible_partida retorna rowCount 0
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .get("/api/suficiencias/saldo-partida")
      .set("Authorization", `Bearer ${makeToken()}`)
      .query({
        id_dgeneral: 2, id_dauxiliar: 3, id_fuente: 1,
        id_proyecto: 1, clave: "5001", mes_pago: "ENERO",
      });

    expect(res.status).toBe(200);
    expect(res.body.saldo_disponible).toBe(0);
    expect(res.body.presupuesto_base).toBe(0);
  });
});

// =====================================================
//  SUITE: GET /api/suficiencias/next-folio
// =====================================================
describe("CP-011: GET /api/suficiencias/next-folio", () => {
  beforeEach(() => jest.clearAllMocks());

  it("retorna el siguiente número de folio", async () => {
    mockAuthUser();
    query.mockResolvedValueOnce({
      rows: [{ folio_num: 42 }],
      rowCount: 1,
    });

    const res = await request(app)
      .get("/api/suficiencias/next-folio")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("folio_num");
    expect(typeof res.body.folio_num).toBe("number");
  });

  it("retorna folio_num=1 cuando no hay suficiencias previas (MAX es NULL)", async () => {
    mockAuthUser();
    // COALESCE(MAX(folio_num),0)+1 → devuelve 1
    query.mockResolvedValueOnce({ rows: [{ folio_num: 1 }], rowCount: 1 });

    const res = await request(app)
      .get("/api/suficiencias/next-folio")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.folio_num).toBe(1);
  });
});

// =====================================================
//  SUITE: POST /api/suficiencias (cabecera individual)
// =====================================================
describe("CP-006 / CP-007: POST /api/suficiencias", () => {
  beforeEach(() => jest.clearAllMocks());

  it("CP-007: mes_pago inválido retorna 400 con mención de mes_pago en el error", async () => {
    mockAuthUser();
    mockDgDaClaves(); // canViewIepsPensiones necesita estas queries

    const res = await request(app)
      .post("/api/suficiencias")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        mes_pago: "BADMONTH",
        subtotal: 1000,
        clave_programatica: "2001",
        id_dgeneral: 2,
        id_dauxiliar: 3,
        id_fuente: 1,
        id_proyecto: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/mes_pago/i);
  });

  it("CP-006: saldo insuficiente retorna 400 con errores_saldo", async () => {
    mockAuthUser();
    mockDgDaClaves();

    // Mock fn_saldo_disponible_partida — saldo de 100 para una solicitud de 5000
    query.mockResolvedValueOnce({
      rows: [{
        saldo_disponible: 100,
        presupuesto_base: 100,
        reservado_suficiencias: 0,
      }],
      rowCount: 1,
    });
    mockAuditResiduales();

    const res = await request(app)
      .post("/api/suficiencias")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        mes_pago: "MARZO",
        subtotal: 5000,
        clave_programatica: "2001",
        id_dgeneral: 2,
        id_dauxiliar: 3,
        id_fuente: 1,
        id_proyecto: 1,
        detalle: [
          { renglon: 1, clave: "2001", concepto_partida: "Test", importe: 5000 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("errores_saldo");
    expect(Array.isArray(res.body.errores_saldo)).toBe(true);
    expect(res.body.errores_saldo[0]).toMatchObject({
      clave: "2001",
      importe_solicitado: 5000,
      saldo_disponible: 100,
    });
  });
});

// =====================================================
//  SUITE: POST /api/suficiencias/lote
// =====================================================
describe("CP-008 / CP-009: POST /api/suficiencias/lote", () => {
  beforeEach(() => jest.clearAllMocks());

  it("CP-008: lote vacío retorna 400", async () => {
    mockAuthUser();
    mockDgDaClaves();

    const res = await request(app)
      .post("/api/suficiencias/lote")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ suficiencias: [] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/al menos una suficiencia/i);
  });

  it("CP-009: lote con más de 20 items retorna 400", async () => {
    mockAuthUser();
    mockDgDaClaves();

    // Construir array de 21 suficiencias mínimas
    const suficiencias = Array.from({ length: 21 }, (_, i) => ({
      id_dgeneral: 2,
      id_dauxiliar: 3,
      id_fuente: 1,
      id_proyecto: 1,
      mes_pago: "MARZO",
      subtotal: 100 * (i + 1),
      clave_programatica: "2001",
    }));

    const res = await request(app)
      .post("/api/suficiencias/lote")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ suficiencias });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/máximo 20/i);
  });

  it("sin campo suficiencias en body retorna 400", async () => {
    mockAuthUser();
    mockDgDaClaves();

    const res = await request(app)
      .post("/api/suficiencias/lote")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

// =====================================================
//  SUITE: Acceso sin autenticación
// =====================================================
describe("Suficiencias: acceso sin token", () => {
  beforeEach(() => jest.clearAllMocks());

  it("GET /api/suficiencias/next-folio sin token retorna 401", async () => {
    const res = await request(app).get("/api/suficiencias/next-folio");
    expect(res.status).toBe(401);
  });

  it("POST /api/suficiencias sin token retorna 401", async () => {
    const res = await request(app)
      .post("/api/suficiencias")
      .send({ subtotal: 1000 });
    expect(res.status).toBe(401);
  });

  it("POST /api/suficiencias/lote sin token retorna 401", async () => {
    const res = await request(app)
      .post("/api/suficiencias/lote")
      .send({ suficiencias: [] });
    expect(res.status).toBe(401);
  });
});
