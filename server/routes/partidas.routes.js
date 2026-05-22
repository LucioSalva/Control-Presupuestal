/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: API — Catálogo de Partidas
 *  Archivo: partidas.routes.js
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
import { Router } from "express";
import { query } from "../db.js";
import {
  isPartidaMilKey,
  logUnauthorizedPartidasAccess,
  checkIsUserL00117,
  checkIsUserE00,
} from "../utils/helpers.js";

const router = Router();

// =====================================================
//  HELPER — Permiso de partidas mil (Hallazgo C-3)
// =====================================================
// Solo L00/117 y E00 pueden ver partidas 1xxx (regla de negocio).
async function canViewPartidasMil(req) {
  return (await checkIsUserL00117(req)) || (await checkIsUserE00(req));
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

    // =====================================================
    //  Hallazgo C-3: Filtrado de partidas mil
    // =====================================================
    // Si el usuario no es L00/117 ni E00, ocultar partidas 1xxx.
    // Logueamos acceso no autorizado SOLO cuando el filtrado del cliente
    // pidió específicamente una clave mil (q/clave query param), no en
    // cada listado para evitar ruido en auditoría.
    const rowsRaw = Array.isArray(r.rows) ? r.rows : [];
    const allowed = await canViewPartidasMil(req);
    const rows = allowed
      ? rowsRaw
      : rowsRaw.filter((row) => !isPartidaMilKey(row?.clave));

    const qParam = String(req.query?.q || req.query?.clave || "").trim();
    if (!allowed && qParam && isPartidaMilKey(qParam)) {
      await logUnauthorizedPartidasAccess(req, {
        motivo: "PARTIDAS_MIL_CATALOGO_GET",
        data: { q: qParam },
      });
    }

    return res.json({ dg, da, rows });
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

    // =====================================================
    //  Hallazgo C-3: Bloqueo de partidas mil en escritura
    // =====================================================
    if (isPartidaMilKey(clave)) {
      const allowed = await canViewPartidasMil(req);
      if (!allowed) {
        await logUnauthorizedPartidasAccess(req, {
          motivo: "PARTIDAS_MIL_MONTO_WRITE",
          data: { clave },
        });
        return res.status(403).json({
          error: "Sin permisos para capturar partidas mil.",
          trace_id: req.cpTraceId || null,
        });
      }
    }

    await getUserDGDA(req);

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
