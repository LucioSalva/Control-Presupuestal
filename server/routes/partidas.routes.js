import { Router } from "express";
import { query } from "../db.js";

const router = Router();
const PARTIDAS_ALLOWED_DG = "L00";
const PARTIDAS_ALLOWED_DA = "117";

function normalizeKey(v) {
  return String(v || "").trim().toUpperCase();
}

function hasPartidasAccess(dg, da) {
  return (
    normalizeKey(dg) === PARTIDAS_ALLOWED_DG &&
    normalizeKey(da) === PARTIDAS_ALLOWED_DA
  );
}

async function getUserDGDA(req) {
  const idDg = Number(req.user?.id_dgeneral);
  const idDa = Number(req.user?.id_dauxiliar);

  const k = await query(
    `
    SELECT
      (SELECT TRIM(clave) FROM public.dgeneral WHERE id = $1) AS dg,
      (SELECT TRIM(clave) FROM public.dauxiliar WHERE id = $2) AS da
    `,
    [idDg, idDa]
  );

  return {
    dg: String(k.rows?.[0]?.dg || "").trim(),
    da: String(k.rows?.[0]?.da || "").trim(),
  };
}

router.get("/", async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const { dg, da } = await getUserDGDA(req);
    if (!dg || !da) {
      return res.status(400).json({ error: "Usuario sin DG/DA" });
    }

    if (!hasPartidasAccess(dg, da)) {
      return res.status(403).json({
        error: "Acceso denegado. Solo DG L00 con DA 117 puede entrar a Partidas.",
      });
    }

    const r = await query(
      `
      SELECT
        p.clave AS clave,
        COALESCE(p.descripcion, 'SIN DESCRIPCION') AS partida,
        COALESCE(pp.monto, 0)::numeric(18,2) AS monto,
        (pp.id_usuario IS NOT NULL) AS capturada
      FROM public.partidas p
      LEFT JOIN public.partidas_presupuesto pp
        ON pp.id_usuario = $1
       AND TRIM(pp.partida_clave) = TRIM(p.clave)
       AND pp.ejercicio = EXTRACT(YEAR FROM now())
      ORDER BY p.clave::text ASC
      `,
      [userId]
    );

    return res.json({ dg, da, rows: r.rows });
  } catch (e) {
    console.error("[PARTIDAS][GET] Error:", e);
    return res.status(500).json({ error: "Error al cargar partidas" });
  }
});

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
      return res.status(400).json({ error: "monto invalido" });
    }

    const { dg, da } = await getUserDGDA(req);
    if (!hasPartidasAccess(dg, da)) {
      return res.status(403).json({
        error: "Acceso denegado. Solo DG L00 con DA 117 puede guardar en Partidas.",
      });
    }

    const exists = await query(
      `
      SELECT 1
      FROM public.partidas
      WHERE TRIM(clave) = $1
      LIMIT 1
      `,
      [clave]
    );

    if (exists.rowCount === 0) {
      return res.status(404).json({ error: "Partida no encontrada" });
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

    if (r.rowCount === 0) {
      return res.status(409).json({
        error:
          "Esta partida ya fue capturada en el ejercicio actual y no puede modificarse",
      });
    }

    return res.json(r.rows[0]);
  } catch (e) {
    console.error("[PARTIDAS][POST monto] Error:", e);
    return res.status(500).json({ error: "Error al guardar monto" });
  }
});

export default router;
