/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 * ================================================================
 *  Módulo: Middlewares centralizados de permisos
 *  Archivo: middleware/permisos.js
 *
 *  REC-003: Centraliza los guards de permisos más usados para
 *  evitar duplicación de lógica en cada archivo de rutas.
 * ================================================================
 */
import { checkIsUserL00117, checkIsUserE00 } from "../utils/helpers.js";

// =====================================================
//  GUARD: GOD O ADMIN
// =====================================================

/**
 * Middleware: solo permite acceso a usuarios GOD o ADMIN.
 * Equivalente al requireGodOrAdmin definido en server.js pero
 * disponible para importar directamente en rutas individuales.
 */
export function requireGodOrAdmin(req, res, next) {
  const roles = req.user?.roles || [];
  if (roles.includes("GOD") || roles.includes("ADMIN")) return next();
  return res.status(403).json({ error: "Acceso restringido a administradores" });
}

// =====================================================
//  GUARD: L00/117 O E00
// =====================================================

/**
 * Middleware: solo permite acceso a usuarios L00/117 o E00.
 * Útil para proteger endpoints de partidas mil y campos IEPS/Pensiones.
 */
export async function requireL00117orE00(req, res, next) {
  try {
    const [isL00, isE00] = await Promise.all([
      checkIsUserL00117(req),
      checkIsUserE00(req),
    ]);
    if (isL00 || isE00) return next();
    return res.status(403).json({ error: "Acceso restringido" });
  } catch {
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}

// =====================================================
//  GUARD: BLOQUEO DE PARTIDAS MIL EN BODY
// =====================================================

/**
 * Middleware: bloquea acceso a partidas mil para usuarios sin permisos.
 * Verifica el campo 'clave_programatica' o 'partida_clave' en req.body.
 * Solo bloquea si la clave empieza con "1" (partidas mil).
 * En caso de error al verificar permisos, deja pasar (fail-open)
 * para no romper flujos legítimos; el guard real está en el handler.
 */
export async function blockPartidasMilAccess(req, res, next) {
  try {
    const clave = req.body?.clave_programatica || req.body?.partida_clave || "";
    if (!clave || !clave.startsWith("1")) return next();
    const [isL00, isE00] = await Promise.all([
      checkIsUserL00117(req),
      checkIsUserE00(req),
    ]);
    if (isL00 || isE00) return next();
    return res.status(403).json({ error: "Sin permisos para partidas mil" });
  } catch {
    return next(); // En caso de error, no bloquear
  }
}
