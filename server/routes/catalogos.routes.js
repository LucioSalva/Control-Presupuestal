import express from "express";
import { query } from "../db.js";
import {
  isPartidaMilKey,
  logUnauthorizedPartidasAccess,
} from "../utils/helpers.js";

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

function normalizeDigits(v) {
  return String(v || "").replace(/[^\d]/g, "").trim();
}

function canViewPartidasMil(dg, da) {
  const dgKey = normalizeKey(dg);
  const daKey = normalizeKey(da);
  return (dgKey === "L00" && daKey === "117") || dgKey === "E00";
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
    const { dg, da } = await getUserDGDA(req);
    const allowed = canViewPartidasMil(dg, da);
    const rows = Array.isArray(r.rows) ? r.rows : [];
    const filtered = allowed
      ? rows
      : rows.filter((row) => !isPartidaMilKey(row?.clave));
    if (!allowed && filtered.length !== rows.length) {
      await logUnauthorizedPartidasAccess(req, {
        motivo: "PARTIDAS_MIL_CATALOGO",
        data: { dg, da },
      });
    }
    res.json(filtered);
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

    const { dg, da } = await getUserDGDA(req);
    const allowed = canViewPartidasMil(dg, da);

    if (isGodOrAdmin) {
      const r = await query(`
        SELECT
          p.clave AS clave,
          COALESCE(p.descripcion, 'SIN DESCRIPCION') AS partida
        FROM public.partidas p
        ORDER BY p.clave::text ASC
      `);
      const rows = Array.isArray(r.rows) ? r.rows : [];
      const filtered = allowed
        ? rows
        : rows.filter((row) => !isPartidaMilKey(row?.clave));
      if (!allowed && filtered.length !== rows.length) {
        await logUnauthorizedPartidasAccess(req, {
          motivo: "PARTIDAS_MIL_PERMITIDAS",
          data: { dg, da },
        });
      }
      return res.json({ rows: filtered });
    }

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

    const rows = Array.isArray(r.rows) ? r.rows : [];
    const filtered = allowed
      ? rows
      : rows.filter((row) => !isPartidaMilKey(row?.clave));
    if (!allowed && filtered.length !== rows.length) {
      await logUnauthorizedPartidasAccess(req, {
        motivo: "PARTIDAS_MIL_PERMITIDAS",
        data: { dg, da },
      });
    }
    return res.json({ dg, da, rows: filtered });
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

router.get("/fuentes-permitidas", async (req, res) => {
  try {
    let dg = normalizeKey(req.query.dg_clave);
    let da = normalizeDigits(req.query.da_clave);

    if (!dg || !da) {
      const ud = await getUserDGDA(req);
      dg = normalizeKey(ud.dg);
      da = normalizeDigits(ud.da);
    }

    let proyClave = normalizeDigits(req.query.proy_clave);
    const idProyecto = Number(req.query.id_proyecto || 0);
    if (!proyClave && Number.isFinite(idProyecto) && idProyecto > 0) {
      const rp = await query(
        `SELECT clave FROM public.proyectos WHERE id = $1 LIMIT 1`,
        [idProyecto]
      );
      proyClave = normalizeDigits(rp.rows?.[0]?.clave);
    }

    if (!dg || !da || !proyClave) {
      return res
        .status(400)
        .json({ error: "Faltan parámetros (dg_clave, da_clave, proy_clave)" });
    }

    const r = await query(
      `
      SELECT TRIM(fuente_clave) AS fuente
      FROM public.proyectos_fuentes_permitidas
      WHERE TRIM(dgeneral_clave) = $1
        AND TRIM(dauxiliar_clave) = $2
        AND TRIM(proyecto_clave) = $3
      ORDER BY fuente_clave
      `,
      [dg, da, proyClave]
    );

    const rows = Array.isArray(r.rows) ? r.rows : [];
    res.json({
      ok: true,
      filtros: { dg_clave: dg, da_clave: da, proy_clave: proyClave },
      fuentes: rows.map((x) => x.fuente),
    });
  } catch (e) {
    console.error("GET /api/catalogos/fuentes-permitidas", e);
    res.status(500).json({ error: "Error obteniendo fuentes permitidas" });
  }
});

router.get("/partidas-permitidas-detalle", async (req, res) => {
  try {
    let dg = normalizeKey(req.query.dg_clave);
    let da = normalizeDigits(req.query.da_clave);

    if (!dg || !da) {
      const ud = await getUserDGDA(req);
      dg = normalizeKey(ud.dg);
      da = normalizeDigits(ud.da);
    }

    let proyClave = normalizeDigits(req.query.proy_clave);
    const fuenteClave = normalizeDigits(req.query.fuente_clave);

    const idProyecto = Number(req.query.id_proyecto || 0);
    if (!proyClave && Number.isFinite(idProyecto) && idProyecto > 0) {
      const rp = await query(
        `SELECT clave FROM public.proyectos WHERE id = $1 LIMIT 1`,
        [idProyecto]
      );
      proyClave = normalizeDigits(rp.rows?.[0]?.clave);
    }

    if (!dg || !da || !proyClave || !fuenteClave) {
      return res.status(400).json({
        error: "Faltan parámetros (dg_clave, da_clave, proy_clave, fuente_clave)",
      });
    }

    const r = await query(
      `
      SELECT TRIM(partida_clave) AS partida
      FROM public.partidas_permitidas
      WHERE TRIM(dgeneral_clave) = $1
        AND TRIM(dauxiliar_clave) = $2
        AND TRIM(proyecto_clave) = $3
        AND TRIM(fuente_clave) = $4
      ORDER BY partida_clave
      `,
      [dg, da, proyClave, fuenteClave]
    );

    const rows = Array.isArray(r.rows) ? r.rows : [];
    res.json({
      ok: true,
      filtros: {
        dg_clave: dg,
        da_clave: da,
        proy_clave: proyClave,
        fuente_clave: fuenteClave,
      },
      partidas: rows.map((x) => x.partida),
    });
  } catch (e) {
    console.error("GET /api/catalogos/partidas-permitidas-detalle", e);
    res.status(500).json({ error: "Error obteniendo partidas permitidas" });
  }
});

export default router;
