/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: API — Metas Presupuestales
 *  Archivo: metas.routes.js
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
// server/routes/metas.routes.js
import express from "express";
import { query } from "../db.js";

const router = express.Router();

/* =====================================================
   Helpers roles
   ===================================================== */
function getRole(req) {
  const roles = (req.user?.roles || []).map((r) => String(r).toUpperCase());
  if (roles.includes("GOD")) return "GOD";
  if (roles.includes("ADMIN")) return "ADMIN";
  return "AREA";
}

function normStr(v) {
  return String(v || "").trim();
}
function normUp(v) {
  return normStr(v).toUpperCase();
}
function onlyDigits(v) {
  return normStr(v).replace(/[^\d]/g, "");
}
function pad10Digits(v) {
  const d = onlyDigits(v);
  return d ? d.padStart(10, "0") : "";
}

/**
 * Obtiene dg_clave y da_clave del usuario logueado (para rol AREA)
 * Ajusta nombres de tabla/campos si difieren en tu BD.
 */
async function getUserDgDaClaves(userId) {
  const r = await query(
    `
    SELECT
      dg.clave AS dg_clave,
      da.clave AS da_clave
    FROM usuarios u
    JOIN dgeneral dg ON dg.id = u.id_dgeneral
    JOIN dauxiliar da ON da.id = u.id_dauxiliar
    WHERE u.id = $1
    LIMIT 1
    `,
    [userId]
  );

  const row = r.rows?.[0];
  return {
    dg_clave: row?.dg_clave ? normUp(row.dg_clave) : "",
    da_clave: row?.da_clave ? normStr(row.da_clave) : "",
  };
}

/**
 * Permite mandar id_proyecto y conac (o solo id_proyecto si tu tabla trae conac).
 * Ajusta tabla/campos si en tu BD se llaman distinto.
 */
async function getProyectoClaveConacById(idProyecto) {
  const r = await query(
    `
    SELECT clave, conac
    FROM proyectos
    WHERE id = $1
    LIMIT 1
    `,
    [idProyecto]
  );

  const row = r.rows?.[0];
  if (!row) return null;

  const proy_clave = pad10Digits(row.clave);
  const conac = normUp(row.conac);
  return { proy_clave, conac };
}

/* =====================================================
   GET /api/catalogos/metas
   Opciones:
   - Por claves:
     /api/catalogos/metas?dg_clave=L00&da_clave=137&proy_clave=0108050103&conac=E
   - Por id_proyecto:
     /api/catalogos/metas?id_proyecto=123   (DG/DA por query o por usuario si AREA)
   ===================================================== */
router.get("/", async (req, res) => {
  try {
    const role = getRole(req);

    // --- DG/DA
    let dg_clave = normUp(req.query.dg_clave);
    let da_clave = normStr(req.query.da_clave);

    // Si es AREA, forzamos DG/DA desde su usuario logueado
    if (role === "AREA") {
      const ud = await getUserDgDaClaves(req.user.id);
      dg_clave = ud.dg_clave;
      da_clave = ud.da_clave;
    }

    if (!dg_clave || !da_clave) {
      return res.status(400).json({
        error: "Faltan parámetros de dependencia (dg_clave / da_clave).",
      });
    }

    // --- PROY/CONAC
    let proy_clave = pad10Digits(req.query.proy_clave);
    let conac = normUp(req.query.conac);

    const idProyecto = req.query.id_proyecto ? Number(req.query.id_proyecto) : null;

    if ((!proy_clave || !conac) && Number.isFinite(idProyecto) && idProyecto > 0) {
      const p = await getProyectoClaveConacById(idProyecto);
      if (!p) return res.status(404).json({ error: "Proyecto no encontrado" });
      proy_clave = p.proy_clave;
      conac = p.conac;
    }

    if (!proy_clave || !conac) {
      return res.status(400).json({
        error: "Falta proyecto. Envía (proy_clave y conac) o id_proyecto.",
      });
    }

    // --- Query metas
    const r = await query(
      `
      SELECT id, meta
      FROM public.metas
      WHERE TRIM(UPPER(dg_clave)) = $1
        AND TRIM(da_clave)        = $2
        AND LPAD(REGEXP_REPLACE(TRIM(proy_clave), '\\D', '', 'g'), 10, '0') = $3
        AND TRIM(UPPER(conac))    = $4
        AND COALESCE(activo, TRUE) = TRUE
      ORDER BY id ASC
      `,
      [dg_clave, da_clave, proy_clave, conac]
    );

    return res.json({
      ok: true,
      filtros: { dg_clave, da_clave, proy_clave, conac },
      data: r.rows || [],
    });
  } catch (err) {
    console.error("[GET /catalogos/metas] error:", err);
    return res.status(500).json({
      error: "Error interno",
    });
  }
});

export default router;
