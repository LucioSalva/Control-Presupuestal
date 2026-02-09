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
