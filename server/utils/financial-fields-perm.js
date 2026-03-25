/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Permisos de Campos Financieros
 *  Archivo: financial-fields-perm.js
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
export function normKey(v) {
  return String(v || "").trim().toUpperCase();
}

export function normDa(v) {
  return String(v || "").trim().toUpperCase();
}

export function canViewIepsPensionesByClaves(dgClave, daClave) {
  const dg = normKey(dgClave);
  const da = normDa(daClave);
  if (!dg) return false;
  if (dg === "E00") return true;
  return dg === "L00" && da === "117";
}

/**
 * Verifica permisos de IEPS/Pensiones basándose en roles.
 * MIGRACIÓN 2026-03-24: reemplaza canViewIepsPensionesByClaves para el modelo por roles.
 * ADMIN y GOD tienen permiso; AREA no.
 * @param {string[]} roles — arreglo de claves de roles del usuario (req.user.roles)
 */
export function canViewIepsPensionesByRoles(roles) {
  if (!Array.isArray(roles)) return false;
  const r = roles.map((x) => String(x).toUpperCase());
  return r.includes("ADMIN") || r.includes("GOD");
}

export function sanitizeFinancialFieldsForLimitedView(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const out = { ...p };
  if ("ieps_tasa" in out) out.ieps_tasa = null;
  if ("ieps" in out) out.ieps = 0;
  if ("pension_total" in out) out.pension_total = 0;
  if ("pension1_tasa" in out) out.pension1_tasa = null;
  if ("pension2_tasa" in out) out.pension2_tasa = null;
  if ("pension3_tasa" in out) out.pension3_tasa = null;
  if ("pension4_tasa" in out) out.pension4_tasa = null;
  if ("pension5_tasa" in out) out.pension5_tasa = null;
  if ("pension1" in out) out.pension1 = 0;
  if ("pension2" in out) out.pension2 = 0;
  if ("pension3" in out) out.pension3 = 0;
  if ("pension4" in out) out.pension4 = 0;
  if ("pension5" in out) out.pension5 = 0;
  return out;
}

