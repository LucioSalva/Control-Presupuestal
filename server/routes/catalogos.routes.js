import express from "express";
import { query } from "../db.js";

const router = express.Router();

/* =========================
   CATÁLOGOS
   ========================= */

router.get("/dgeneral", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, dependencia FROM dgeneral ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /catalogos/dgeneral", e);
    res.status(500).json({ error: "Error obteniendo catálogo dgeneral" });
  }
});

router.get("/dauxiliar", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, dependencia FROM dauxiliar ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /catalogos/dauxiliar", e);
    res.status(500).json({ error: "Error obteniendo catálogo dauxiliar" });
  }
});

router.get("/fuentes", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, fuente FROM fuentes ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /catalogos/fuentes", e);
    res.status(500).json({ error: "Error obteniendo catálogo fuentes" });
  }
});

router.get("/programas", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, descripcion FROM programas ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /catalogos/programas", e);
    res.status(500).json({ error: "Error obteniendo catálogo programas" });
  }
});

function normalizeKey(v) {
  return String(v || "").trim().toUpperCase();
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

router.get("/partidas", async (req, res) => {
  try {
    const r = await query(`
      SELECT clave, descripcion
      FROM public.partidas
      ORDER BY clave
    `);
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/catalogos/partidas", e);
    res.status(500).json({ error: "Error obteniendo partidas" });
  }
});

router.get("/partidas-permitidas", async (req, res) => {
  try {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const isGodOrAdmin = roles
      .map((r) => normalizeKey(r))
      .some((r) => r === "GOD" || r === "ADMIN");

    if (isGodOrAdmin) {
      const r = await query(`
        SELECT
          p.clave AS clave,
          COALESCE(p.descripcion, 'SIN DESCRIPCION') AS partida
        FROM public.partidas p
        ORDER BY p.clave::text ASC
      `);
      return res.json({ rows: r.rows });
    }

    const { dg, da } = await getUserDGDA(req);
    if (!dg || !da) return res.json({ rows: [] });

    const r = await query(
      `
      SELECT
        p.clave AS clave,
        COALESCE(p.descripcion, 'SIN DESCRIPCION') AS partida
      FROM public.partidas_permitidas pp
      JOIN public.partidas p
        ON TRIM(pp.partida_clave) = TRIM(p.clave)
      WHERE TRIM(pp.dgeneral_clave) = $1
        AND TRIM(pp.dauxiliar_clave) = $2
      ORDER BY p.clave::text ASC
      `,
      [dg, da]
    );

    return res.json({ dg, da, rows: r.rows });
  } catch (e) {
    console.error("GET /api/catalogos/partidas-permitidas", e);
    return res
      .status(500)
      .json({ error: "Error obteniendo partidas permitidas" });
  }
});

router.get("/proyectos", async (req, res) => {
  try {
    const r = await query(`
      SELECT id, clave, conac, descripcion
      FROM public.proyectos
      ORDER BY clave
    `);
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/catalogos/proyectos", e);
    res.status(500).json({ error: "Error obteniendo proyectos" });
  }
});

export default router;
