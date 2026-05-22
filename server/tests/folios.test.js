/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: B-3 (folios mensuales atómicos)
 * ================================================================
 *  Verifica el comportamiento de public.fn_next_folio(tipo, anio, mes)
 *  con tabla public.folios_contadores. Requiere Postgres real.
 *
 *  Casos que REQUIEREN Postgres test:
 *   - secuencial dentro del mismo mes
 *   - reset al cambiar de mes
 *   - 10 Promise.all → 10 valores únicos (concurrencia)
 *
 *  Se gatean con process.env.DATABASE_URL_TEST. Si no está definida,
 *  se hace describe.skip con un mensaje claro.
 * ================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";

const HAS_DB = !!process.env.DATABASE_URL_TEST;
const dscribe = HAS_DB ? describe : describe.skip;

dscribe("B-3: fn_next_folio (REQUIERE Postgres test)", () => {
  let pg;
  let pool;

  beforeAll(async () => {
    pg = (await import("pg")).default;
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it("fn_next_folio('SP', 2026, 5) retorna entero >0", async () => {
    const r = await pool.query("SELECT public.fn_next_folio($1,$2,$3) AS n", ["SP", 2026, 5]);
    const n = Number(r.rows[0].n);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it("dos invocaciones consecutivas en mismo mes son secuenciales", async () => {
    const a = await pool.query("SELECT public.fn_next_folio($1,$2,$3) AS n", ["SP", 2026, 5]);
    const b = await pool.query("SELECT public.fn_next_folio($1,$2,$3) AS n", ["SP", 2026, 5]);
    expect(Number(b.rows[0].n)).toBe(Number(a.rows[0].n) + 1);
  });

  it("cambio de mes resetea el contador", async () => {
    const a = await pool.query("SELECT public.fn_next_folio($1,$2,$3) AS n", ["SP", 2099, 11]);
    const b = await pool.query("SELECT public.fn_next_folio($1,$2,$3) AS n", ["SP", 2099, 12]);
    // El primer folio del nuevo mes debe ser 1 (reset mensual).
    expect(Number(b.rows[0].n)).toBe(1);
    expect(Number(a.rows[0].n)).toBeGreaterThan(0);
  });

  it("concurrencia (Promise.all 10) → 10 enteros únicos", async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(pool.query("SELECT public.fn_next_folio($1,$2,$3) AS n", ["CP", 2098, 7]));
    }
    const results = await Promise.all(promises);
    const values = results.map((r) => Number(r.rows[0].n));
    const unique = new Set(values);
    expect(unique.size).toBe(10);
  });
});

// Cuando NO hay Postgres test, deja al menos un test que documenta el skip.
if (!HAS_DB) {
  describe("B-3 folios (skip)", () => {
    it.skip(
      "tests de fn_next_folio requieren Postgres — definir DATABASE_URL_TEST para correrlos",
      () => {}
    );
  });
}
