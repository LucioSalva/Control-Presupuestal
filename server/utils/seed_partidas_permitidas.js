/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Semilla de Partidas Permitidas
 *  Archivo: seed_partidas_permitidas.js
 *
 *  © 2025–2026 Humberto Salvador Ruiz Lucio.
 *  Todos los derechos reservados.
 *
 *  AVISO LEGAL: Este software es propiedad exclusiva del
 *  Humberto Salvador Ruiz Lucio. Su reproducción,
 *  distribución o modificación sin autorización escrita previa
 *  del titular queda estrictamente prohibida y será perseguida
 *  conforme a las leyes aplicables en los Estados Unidos Mexicanos.
 *
 *  Software de uso interno exclusivo. No compartir.
 * ================================================================
 */
import { query } from "../db.js";

const RULES = [
  // (todo tu arreglo, no lo cambio)
];

export async function seedPartidasPermitidas() {
  const sql = `
    INSERT INTO public.partidas_permitidas
      (dgeneral_clave, dauxiliar_clave, partida_clave)
    VALUES ($1, $2, $3)
    ON CONFLICT (dgeneral_clave, dauxiliar_clave, partida_clave)
    DO NOTHING;
  `;

  let inserted = 0;

  for (const [dg, da, p] of RULES) {
    const r = await query(sql, [
      String(dg).trim(),
      String(da).trim(),
      String(p).trim(),
    ]);
    if (r.rowCount === 1) inserted++;
  }

  console.log(
    `[SEED] partidas_permitidas: ${inserted} nuevas reglas insertadas (si eran nuevas). Total reglas en archivo: ${RULES.length}`
  );
}
