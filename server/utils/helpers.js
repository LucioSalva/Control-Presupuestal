/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Utilidades y Helpers del Sistema
 *  Archivo: helpers.js
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

// saldo = presupuesto - total_gastado + total_reconducido
export function computeSaldo({
  presupuesto = 0,
  total_gastado = 0,
  total_reconducido = 0,
}) {
  return Number(presupuesto) - Number(total_gastado) + Number(total_reconducido);
}

export function buildHttpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Auditoría: quién ejecuta la acción (viene del front en header)
 * Front debe mandar: headers: { "x-user-id": "<id>" }
 */
export function getActorId(req) {
  const fromHeader = Number(req.headers["x-user-id"] || 0);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  const fromUser = Number(req.user?.id || 0);
  return Number.isFinite(fromUser) && fromUser > 0 ? fromUser : null;
}

// BUG-008: valida que la clave empiece con "1" y el segundo carácter sea también dígito
// Ej: "1001" → true, "1abc" → false, "2001" → false
export function isPartidaMilKey(clave) {
  if (!clave) return false;
  const s = String(clave).trim();
  return s.startsWith("1") && /^\d/.test(s.charAt(1) || "0");
}

export async function logUnauthorizedPartidasAccess(req, context = {}) {
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS public.auditoria_accesos (
        id bigserial PRIMARY KEY,
        actor_id integer,
        id_dgeneral integer,
        id_dauxiliar integer,
        metodo text,
        ruta text,
        motivo text,
        payload jsonb,
        created_at timestamp without time zone DEFAULT now()
      )`
    );

    await query(
      `ALTER TABLE public.auditoria_accesos ADD COLUMN IF NOT EXISTS actor_id integer`
    );
    await query(
      `ALTER TABLE public.auditoria_accesos ADD COLUMN IF NOT EXISTS id_dgeneral integer`
    );
    await query(
      `ALTER TABLE public.auditoria_accesos ADD COLUMN IF NOT EXISTS id_dauxiliar integer`
    );
    await query(
      `ALTER TABLE public.auditoria_accesos ADD COLUMN IF NOT EXISTS metodo text`
    );
    await query(
      `ALTER TABLE public.auditoria_accesos ADD COLUMN IF NOT EXISTS ruta text`
    );
    await query(
      `ALTER TABLE public.auditoria_accesos ADD COLUMN IF NOT EXISTS motivo text`
    );
    await query(
      `ALTER TABLE public.auditoria_accesos ADD COLUMN IF NOT EXISTS payload jsonb`
    );
    await query(
      `ALTER TABLE public.auditoria_accesos ADD COLUMN IF NOT EXISTS created_at timestamp without time zone DEFAULT now()`
    );

    const actorId = getActorId(req) || req.user?.id || null;
    const idDg = Number(req.user?.id_dgeneral ?? null);
    const idDa = Number(req.user?.id_dauxiliar ?? null);
    const metodo = String(req.method || "").toUpperCase();
    const ruta = String(req.originalUrl || req.path || "");
    const motivo = String(context.motivo || "ACCESO_NO_AUTORIZADO");
    const payload = context.data ? JSON.stringify(context.data) : null;

    await query(
      `INSERT INTO public.auditoria_accesos
        (actor_id, id_dgeneral, id_dauxiliar, metodo, ruta, motivo, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb, now())`,
      [actorId, Number.isFinite(idDg) ? idDg : null, Number.isFinite(idDa) ? idDa : null, metodo, ruta, motivo, payload]
    );

    await logAuditEvent(req, {
      tipo: "DENEGADO",
      entidad: "PARTIDAS",
      entidad_id: null,
      estado: "BLOQUEADO",
      detalles: {
        motivo,
        ruta,
        metodo,
        data: context?.data ?? null,
      },
    });
  } catch (err) {
    console.warn("[AUDITORIA_PARTIDAS] no se pudo registrar", err?.message || err);
  }
}

export async function ensureAuditoriaEventosSchema() {
  await query(
    `CREATE TABLE IF NOT EXISTS public.auditoria_eventos (
      id bigserial PRIMARY KEY,
      created_at timestamp without time zone DEFAULT now(),
      tipo text NOT NULL,
      entidad text,
      entidad_id text,
      estado text,
      actor_id integer,
      id_dgeneral integer,
      id_dauxiliar integer,
      metodo text,
      ruta text,
      detalles jsonb
    )`
  );

  await query(
    `ALTER TABLE public.auditoria_eventos ADD COLUMN IF NOT EXISTS created_at timestamp without time zone DEFAULT now()`
  );
  await query(`ALTER TABLE public.auditoria_eventos ADD COLUMN IF NOT EXISTS tipo text`);
  await query(`ALTER TABLE public.auditoria_eventos ADD COLUMN IF NOT EXISTS entidad text`);
  await query(`ALTER TABLE public.auditoria_eventos ADD COLUMN IF NOT EXISTS entidad_id text`);
  await query(`ALTER TABLE public.auditoria_eventos ADD COLUMN IF NOT EXISTS estado text`);
  await query(`ALTER TABLE public.auditoria_eventos ADD COLUMN IF NOT EXISTS actor_id integer`);
  await query(`ALTER TABLE public.auditoria_eventos ADD COLUMN IF NOT EXISTS id_dgeneral integer`);
  await query(`ALTER TABLE public.auditoria_eventos ADD COLUMN IF NOT EXISTS id_dauxiliar integer`);
  await query(`ALTER TABLE public.auditoria_eventos ADD COLUMN IF NOT EXISTS metodo text`);
  await query(`ALTER TABLE public.auditoria_eventos ADD COLUMN IF NOT EXISTS ruta text`);
  await query(`ALTER TABLE public.auditoria_eventos ADD COLUMN IF NOT EXISTS detalles jsonb`);

  await query(
    `CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_created_at ON public.auditoria_eventos (created_at DESC)`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_tipo_created_at ON public.auditoria_eventos (tipo, created_at DESC)`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_auditoria_eventos_actor_created_at ON public.auditoria_eventos (actor_id, created_at DESC)`
  );
}

// RIESGO-005, REC-08: reintentos automáticos en caso de fallo transitorio de BD
export async function logAuditEvent(req, event = {}) {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await ensureAuditoriaEventosSchema();

      const actorId = getActorId(req) || req.user?.id || null;
      const idDg = Number(req.user?.id_dgeneral ?? null);
      const idDa = Number(req.user?.id_dauxiliar ?? null);

      const tipo = String(event?.tipo || "").trim().toUpperCase();
      if (!tipo) return;

      const entidad = event?.entidad == null ? null : String(event.entidad).trim().toUpperCase();
      const entidadId = event?.entidad_id == null ? null : String(event.entidad_id).trim();
      const estado = event?.estado == null ? null : String(event.estado).trim().toUpperCase();
      const metodo = String(req.method || "").toUpperCase();
      const ruta = String(req.originalUrl || req.path || "");

      let detalles = null;
      const traceId =
        req.cpTraceId || req.traceId || (req.headers["x-trace-id"] ? String(req.headers["x-trace-id"]) : null);
      const baseDetalles = event?.detalles;
      if (baseDetalles != null) {
        if (typeof baseDetalles === "object") detalles = JSON.stringify({ ...baseDetalles, trace_id: traceId });
        else detalles = JSON.stringify({ value: baseDetalles, trace_id: traceId });
      } else if (traceId) {
        detalles = JSON.stringify({ trace_id: traceId });
      }

      await query(
        `
        INSERT INTO public.auditoria_eventos
          (tipo, entidad, entidad_id, estado, actor_id, id_dgeneral, id_dauxiliar, metodo, ruta, detalles, created_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb, now())
        `,
        [
          tipo,
          entidad,
          entidadId,
          estado,
          actorId,
          Number.isFinite(idDg) ? idDg : null,
          Number.isFinite(idDa) ? idDa : null,
          metodo,
          ruta,
          detalles,
        ]
      );
      req._cpAuditLogged = true;
      return; // éxito
    } catch (e) {
      if (attempt === MAX_RETRIES) {
        console.error("[AUDIT][FATAL] No se pudo registrar evento después de", MAX_RETRIES, "intentos:", e.message);
      } else {
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  }
}

/**
 * Valida llaves para proyecto (cuando aplique)
 */
export async function getProjectKeys({
  id_proyecto,
  id_dgeneral,
  id_dauxiliar,
  id_fuente,
}) {
  const projectCode = String(id_proyecto || "").trim();
  const dg = Number(id_dgeneral);
  const da = Number(id_dauxiliar);
  const fu = Number(id_fuente);

  if (
    !projectCode ||
    !Number.isInteger(dg) ||
    dg <= 0 ||
    !Number.isInteger(da) ||
    da <= 0 ||
    !Number.isInteger(fu) ||
    fu <= 0
  ) {
    throw buildHttpError(
      "id_dgeneral, id_dauxiliar, id_fuente e id_proyecto son obligatorios y deben ser enteros > 0",
      400
    );
  }

  return {
    id_proyecto: projectCode,
    id_dgeneral: dg,
    id_dauxiliar: da,
    id_fuente: fu,
  };
}

// =====================================================
//  CÁLCULO DE TOTAL PRESUPUESTAL CENTRALIZADO
// =====================================================

/**
 * Calcula el total presupuestal de forma consistente.
 * BUG-001, BUG-003, REC-07
 * Si allowIEPS es false, fuerza ieps=0 y pension_total=0.
 */
export function computeTotal(
  { subtotal = 0, iva = 0, isr = 0, ieps = 0, pension_total = 0 },
  allowIEPS = true
) {
  const s = Number(subtotal) || 0;
  const v = Number(iva) || 0;
  const r = Number(isr) || 0;
  const e = allowIEPS ? (Number(ieps) || 0) : 0;
  const p = allowIEPS ? (Number(pension_total) || 0) : 0;
  return Math.round((s + v + r + e + p) * 100) / 100;
}

// =====================================================
//  VALIDACIÓN DE MES DE PAGO
// =====================================================

// REC-05: lista canónica de meses válidos
const MESES_VALIDOS = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

/**
 * Valida que el mes de pago sea un mes del año en español.
 * Retorna true si el valor es nulo/vacío (campo opcional).
 */
export function validateMesPago(mes) {
  if (!mes) return true; // campo opcional
  return MESES_VALIDOS.includes(String(mes).trim().toUpperCase());
}

// =====================================================
//  HELPERS DE IDENTIDAD DE USUARIO CENTRALIZADOS
// =====================================================

/**
 * Verifica si el usuario pertenece a DG L00 con DA 117 (presupuesto central).
 * RIESGO-008, REC-02: centralizado para evitar duplicación en routes.
 */
export async function checkIsUserL00117(req) {
  try {
    const userId = req.user?.id;
    if (!userId) return false;
    const r = await query(
      `SELECT dg.clave AS dg_clave, da.clave AS da_clave
       FROM usuarios u
       JOIN dgeneral dg ON dg.id = u.id_dgeneral
       JOIN dauxiliar da ON da.id = u.id_dauxiliar
       WHERE u.id = $1 LIMIT 1`,
      [userId]
    );
    if (!r.rows.length) return false;
    return r.rows[0].dg_clave === "L00" && r.rows[0].da_clave === "117";
  } catch {
    return false;
  }
}

/**
 * Verifica si el usuario pertenece a DG E00.
 * RIESGO-008, REC-02: centralizado para evitar duplicación en routes.
 */
export async function checkIsUserE00(req) {
  try {
    const userId = req.user?.id;
    if (!userId) return false;
    const r = await query(
      `SELECT dg.clave
       FROM usuarios u
       JOIN dgeneral dg ON dg.id = u.id_dgeneral
       WHERE u.id = $1 LIMIT 1`,
      [userId]
    );
    return r.rows.length > 0 && r.rows[0].clave === "E00";
  } catch {
    return false;
  }
}
