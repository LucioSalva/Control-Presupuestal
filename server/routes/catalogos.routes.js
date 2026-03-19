/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: API — Catálogos Generales
 *  Archivo: catalogos.routes.js
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
import express from "express";
import { query } from "../db.js";
import {
  isPartidaMilKey,
  logUnauthorizedPartidasAccess,
  checkIsUserL00117,
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

    // GOD/ADMIN y L00/117 ven todas las partidas sin filtro de DG/DA
    const userIsL00117 = await checkIsUserL00117(req);
    if (isGodOrAdmin || userIsL00117) {
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

// =====================================================
//  NOMBRES DE MESES EN ESPAÑOL PARA SALDO
// =====================================================
const MESES_ES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

// GET /api/catalogos/partidas-con-fuente
// Retorna todas las partidas del DG+DA+Proyecto con su fuente asignada,
// incluyendo saldo_disponible y presupuesto_base de cada partida.
// Parámetros opcionales: mes_pago (ej. "MARZO"), ejercicio (ej. 2026)
router.get("/partidas-con-fuente", async (req, res) => {
  try {
    let dg = normalizeKey(req.query.dg_clave);
    let da = normalizeDigits(req.query.da_clave);

    if (!dg || !da) {
      const ud = await getUserDGDA(req);
      dg = normalizeKey(ud.dg);
      da = normalizeDigits(ud.da);
    }

    let proyClave = normalizeDigits(req.query.proy_clave);

    if (!dg || !da || !proyClave) {
      return res.status(400).json({ error: "Faltan parámetros (dg_clave, da_clave, proy_clave)" });
    }

    // Resolver mes y ejercicio — usar valores del query o calcular los actuales
    const ahora = new Date();
    const mesPago = normalizeKey(req.query.mes_pago) || MESES_ES[ahora.getMonth()];
    const ejercicio = Number(req.query.ejercicio) || ahora.getFullYear();

    // Obtener IDs numéricos de DG y DA a partir de sus claves
    const [rDgId, rDaId] = await Promise.all([
      query(`SELECT id FROM public.dgeneral WHERE TRIM(clave) = $1 LIMIT 1`, [dg]),
      query(`SELECT id FROM public.dauxiliar WHERE TRIM(clave) = $1 LIMIT 1`, [da]),
    ]);

    const idDgeneral = Number(rDgId.rows?.[0]?.id ?? null);
    const idDauxiliar = Number(rDaId.rows?.[0]?.id ?? null);

    if (!Number.isFinite(idDgeneral) || idDgeneral <= 0 ||
        !Number.isFinite(idDauxiliar) || idDauxiliar <= 0) {
      return res.status(400).json({ error: "No se encontró el DG o DA especificado" });
    }

    // Obtener id del proyecto — preferir el ID directo si ya lo envía el cliente
    let idProyecto = Number(req.query.id_proyecto || 0);
    if (!Number.isFinite(idProyecto) || idProyecto <= 0) {
      const rProy = await query(
        `SELECT id FROM public.proyectos WHERE TRIM(clave) = $1 LIMIT 1`,
        [proyClave]
      );
      idProyecto = Number(rProy.rows?.[0]?.id ?? null);
    }

    if (!Number.isFinite(idProyecto) || idProyecto <= 0) {
      return res.status(400).json({ error: "No se encontró el proyecto especificado" });
    }

    // Obtener partidas con fuente para el DG+DA+Proyecto solicitado
    const r = await query(
      `
      SELECT
        TRIM(pp.partida_clave)                          AS partida_clave,
        COALESCE(p.descripcion, 'SIN DESCRIPCION')      AS partida_descripcion,
        TRIM(pp.fuente_clave)                           AS fuente_clave,
        f.id                                            AS fuente_id,
        COALESCE(f.fuente, pp.fuente_clave)             AS fuente_nombre
      FROM public.partidas_permitidas pp
      LEFT JOIN public.partidas p
        ON TRIM(p.clave) = TRIM(pp.partida_clave)
      LEFT JOIN public.fuentes f
        ON TRIM(f.clave) = TRIM(pp.fuente_clave)
      WHERE TRIM(pp.dgeneral_clave)  = $1
        AND TRIM(pp.dauxiliar_clave) = $2
        AND TRIM(pp.proyecto_clave)  = $3
      ORDER BY pp.fuente_clave, pp.partida_clave
      `,
      [dg, da, proyClave]
    );

    const allowedMil = canViewPartidasMil(dg, da);
    const rows = Array.isArray(r.rows) ? r.rows : [];
    const filtered = allowedMil
      ? rows
      : rows.filter((row) => !isPartidaMilKey(row.partida_clave));

    if (!allowedMil && filtered.length !== rows.length) {
      await logUnauthorizedPartidasAccess(req, {
        motivo: "PARTIDAS_MIL_CON_FUENTE",
        data: { dg, da, proyClave },
      });
    }

    // Consultar saldo de cada partida en paralelo usando fn_saldo_disponible_partida
    const conSaldo = await Promise.all(
      filtered.map(async (partida) => {
        const idFuente = Number(partida.fuente_id);
        if (!Number.isFinite(idFuente) || idFuente <= 0) {
          return { ...partida, saldo_disponible: null, presupuesto_base: null };
        }

        try {
          const rSaldo = await query(
            `SELECT saldo_disponible, presupuesto_base
             FROM fn_saldo_disponible_partida($1, $2, $3, $4, $5, $6, $7)`,
            [idDgeneral, idDauxiliar, idFuente, idProyecto, partida.partida_clave, mesPago, ejercicio]
          );
          const fila = rSaldo.rows?.[0];
          return {
            ...partida,
            saldo_disponible: fila?.saldo_disponible != null ? Number(fila.saldo_disponible) : null,
            presupuesto_base: fila?.presupuesto_base != null ? Number(fila.presupuesto_base) : null,
          };
        } catch (eSaldo) {
          // Si el saldo falla para una partida individual, no cancelamos todo el request
          console.error(
            `[CATALOGOS][GET partidas-con-fuente] Error al obtener saldo para partida ${partida.partida_clave}:`,
            eSaldo
          );
          return { ...partida, saldo_disponible: null, presupuesto_base: null };
        }
      })
    );

    return res.json({ ok: true, partidas: conSaldo });
  } catch (e) {
    console.error("[CATALOGOS][GET partidas-con-fuente] Error:", e);
    return res.status(500).json({ error: "Error al obtener partidas" });
  }
});

export default router;
