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
  const actorId = Number(req.headers["x-user-id"] || 0);
  return Number.isFinite(actorId) && actorId > 0 ? actorId : null;
}

export function isPartidaMilKey(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 && digits.startsWith("1");
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
  } catch (err) {
    console.warn("[AUDITORIA_PARTIDAS] no se pudo registrar", err?.message || err);
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
