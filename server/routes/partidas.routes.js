import { Router } from "express";
import { query } from "../db.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const idDg = Number(req.user?.id_dgeneral);
    const idDa = Number(req.user?.id_dauxiliar);

    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const k = await query(
      `
      SELECT
        (SELECT TRIM(clave) FROM public.dgeneral WHERE id = $1) AS dg,
        (SELECT TRIM(clave) FROM public.dauxiliar WHERE id = $2) AS da
      `,
      [idDg, idDa]
    );

    const dg = k.rows?.[0]?.dg;
    const da = k.rows?.[0]?.da;

    if (!dg || !da) {
      return res.status(400).json({ error: "Usuario sin DG/DA" });
    }

    const r = await query(
      `
      SELECT
        p.clave AS clave,
        COALESCE(p.descripcion, 'SIN DESCRIPCIÓN') AS partida,
        COALESCE(pp.monto, 0)::numeric(18,2) AS monto,
        (pp.id_usuario IS NOT NULL) AS capturada
      FROM public.partidas_permitidas per
      JOIN public.partidas p
        ON TRIM(p.clave) = TRIM(per.partida_clave)
      LEFT JOIN public.partidas_presupuesto pp
        ON pp.id_usuario = $1
       AND TRIM(pp.partida_clave) = TRIM(p.clave)
       AND pp.ejercicio = EXTRACT(YEAR FROM now())
      WHERE TRIM(per.dgeneral_clave) = $2
        AND TRIM(per.dauxiliar_clave) = $3
      ORDER BY p.clave::text ASC
      `,
      [userId, dg, da]
    );

    // ✅ IMPORTANTE: regresamos dg/da y rows
    return res.json({ dg, da, rows: r.rows });
  } catch (e) {
    console.error("[PARTIDAS][GET] Error:", e);
    return res.status(500).json({ error: "Error al cargar partidas" });
  }
}); // ✅ AQUÍ se cerraba y te faltaba

router.post("/monto", async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const clave = String(req.body?.clave || "").trim();
    const monto = Number(req.body?.monto);

    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: "No autenticado" });
    }
    if (!clave) return res.status(400).json({ error: "clave requerida" });
    if (!Number.isFinite(monto) || monto < 0) {
      return res.status(400).json({ error: "monto inválido" });
    }

    const keys = await query(
      `
      SELECT
        (SELECT TRIM(clave) FROM public.dgeneral WHERE id = $1 LIMIT 1) AS dg,
        (SELECT TRIM(clave) FROM public.dauxiliar WHERE id = $2 LIMIT 1) AS da
      `,
      [Number(req.user?.id_dgeneral), Number(req.user?.id_dauxiliar)]
    );

    const dg = String(keys.rows?.[0]?.dg || "").trim();
    const da = String(keys.rows?.[0]?.da || "").trim();

    const allowed = await query(
      `
      SELECT 1
      FROM public.partidas_permitidas
      WHERE TRIM(dgeneral_clave) = $1
        AND TRIM(dauxiliar_clave) = $2
        AND TRIM(partida_clave) = $3
      LIMIT 1
      `,
      [dg, da, clave]
    );

    if (allowed.rowCount === 0) {
      return res.status(403).json({ error: "Partida no permitida para tu área" });
    }

    const r = await query(
      `
      INSERT INTO public.partidas_presupuesto (id_usuario, partida_clave, monto, ejercicio)
      VALUES ($1, $2, $3, EXTRACT(YEAR FROM now()))
      ON CONFLICT (id_usuario, partida_clave, ejercicio)
      DO NOTHING
      RETURNING id_usuario, partida_clave AS clave, monto;
      `,
      [userId, clave, Number(monto.toFixed(2))]
    );

    // ✅ si ya existía (bloqueo de edición en el año)
    if (r.rowCount === 0) {
      return res.status(409).json({
        error:
          "Esta partida ya fue capturada en el ejercicio actual y no puede modificarse.",
      });
    }

    return res.json(r.rows[0]);
  } catch (e) {
    console.error("[PARTIDAS][POST monto] Error:", e);
    return res.status(500).json({ error: "Error al guardar monto" });
  }
});

export default router;
