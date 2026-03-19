/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: API — Auditoría del Sistema
 *  Archivo: admin-auditoria.routes.js
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
import { ensureAuditoriaEventosSchema } from "../utils/helpers.js";

const router = Router();

router.use((req, res, next) => {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const rolesNorm = roles.map((r) => String(r || "").trim().toUpperCase());
  if (!rolesNorm.includes("GOD")) {
    return res.status(403).json({ error: "Solo GOD puede acceder." });
  }
  next();
});

function toNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toPosIntOrNull(v) {
  const n = toNumOrNull(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function toDateOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normTipoList(v) {
  const s = String(v ?? "").trim();
  if (!s) return [];
  return s
    .split(",")
    .map((x) => String(x || "").trim().toUpperCase())
    .filter((x) => x);
}

router.get("/eventos", async (req, res) => {
  try {
    await ensureAuditoriaEventosSchema();

    const limitRaw = toPosIntOrNull(req.query.limit);
    const limit = Math.min(Math.max(limitRaw || 200, 1), 1000);

    const beforeId = toPosIntOrNull(req.query.before_id);
    const sinceId = toPosIntOrNull(req.query.since_id);

    const tipos = normTipoList(req.query.tipo);
    const actorId = toPosIntOrNull(req.query.actor_id);

    const from = toDateOrNull(req.query.from);
    const to = toDateOrNull(req.query.to);

    const qRaw = String(req.query.q ?? "").trim();
    const q = qRaw ? qRaw.slice(0, 200) : "";

    const params = [];
    const where = [];

    const add = (v) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (sinceId) where.push(`e.id > ${add(sinceId)}`);
    if (beforeId) where.push(`e.id < ${add(beforeId)}`);
    if (tipos.length) where.push(`e.tipo = ANY(${add(tipos)})`);
    if (actorId) where.push(`e.actor_id = ${add(actorId)}`);
    if (from) where.push(`e.created_at >= ${add(from.toISOString())}::timestamp`);
    if (to) where.push(`e.created_at <= ${add(to.toISOString())}::timestamp`);
    if (q) {
      const like = `%${q}%`;
      const p = add(like);
      where.push(
        `(
          COALESCE(u.usuario,'') ILIKE ${p}
          OR COALESCE(u.nombre_completo,'') ILIKE ${p}
          OR COALESCE(e.tipo,'') ILIKE ${p}
          OR COALESCE(e.entidad,'') ILIKE ${p}
          OR COALESCE(e.entidad_id,'') ILIKE ${p}
          OR COALESCE(e.estado,'') ILIKE ${p}
          OR COALESCE(e.ruta,'') ILIKE ${p}
          OR COALESCE(e.detalles::text,'') ILIKE ${p}
        )`
      );
    }

    const order = sinceId ? "ASC" : "DESC";

    const sql = `
      SELECT
        e.id,
        e.created_at,
        e.tipo,
        e.entidad,
        e.entidad_id,
        e.estado,
        e.actor_id,
        u.usuario AS actor_usuario,
        u.nombre_completo AS actor_nombre,
        e.id_dgeneral,
        dg.clave AS dgeneral_clave,
        dg.dependencia AS dgeneral_nombre,
        e.id_dauxiliar,
        da.clave AS dauxiliar_clave,
        da.dependencia AS dauxiliar_nombre,
        e.metodo,
        e.ruta,
        e.detalles
      FROM public.auditoria_eventos e
      LEFT JOIN public.usuarios u ON u.id = e.actor_id
      LEFT JOIN public.dgeneral dg ON dg.id = e.id_dgeneral
      LEFT JOIN public.dauxiliar da ON da.id = e.id_dauxiliar
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY e.id ${order}
      LIMIT ${add(limit)}
    `;

    const r = await query(sql, params);
    const rows = r.rows || [];

    const maxId = rows.length ? Number(rows[rows.length - 1]?.id || 0) : null;
    const minId = rows.length ? Number(rows[0]?.id || 0) : null;

    return res.json({
      ok: true,
      data: rows,
      meta: {
        limit,
        since_id: sinceId || null,
        before_id: beforeId || null,
        tipos,
        actor_id: actorId || null,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        q: q || null,
        order,
        min_id: Number.isFinite(minId) && minId > 0 ? minId : null,
        max_id: Number.isFinite(maxId) && maxId > 0 ? maxId : null,
        next_before_id:
          !sinceId && rows.length ? Number(rows[rows.length - 1]?.id || 0) : null,
      },
    });
  } catch (e) {
    console.error("[ADMIN-AUDITORIA][GET eventos] Error:", e);
    return res.status(500).json({ error: "Error al cargar auditoría" });
  }
});

router.get("/tipos", async (_req, res) => {
  try {
    await ensureAuditoriaEventosSchema();
    const r = await query(
      `
      SELECT DISTINCT tipo
      FROM public.auditoria_eventos
      WHERE tipo IS NOT NULL AND TRIM(tipo) <> ''
      ORDER BY tipo
      `
    );
    return res.json({ ok: true, data: (r.rows || []).map((x) => x.tipo) });
  } catch (e) {
    console.error("[ADMIN-AUDITORIA][GET tipos] Error:", e);
    return res.status(500).json({ error: "Error al cargar tipos" });
  }
});

router.get("/usuarios", async (_req, res) => {
  try {
    const r = await query(
      `
      SELECT id, usuario, nombre_completo
      FROM public.usuarios
      WHERE activo = true
      ORDER BY usuario
      `
    );
    return res.json({ ok: true, data: r.rows || [] });
  } catch (e) {
    console.error("[ADMIN-AUDITORIA][GET usuarios] Error:", e);
    return res.status(500).json({ error: "Error al cargar usuarios" });
  }
});

export default router;

