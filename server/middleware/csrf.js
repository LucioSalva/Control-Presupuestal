/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 * ================================================================
 *  Módulo: Middleware CSRF
 *  Archivo: middleware/csrf.js
 *
 *  RIESGO-002: Protección CSRF para endpoints que aceptan token
 *  por query param (?token=), usados en descargas con window.open.
 * ================================================================
 */

// =====================================================
//  VALIDACIÓN DE ORIGEN (CSRF SIMPLIFICADO)
// =====================================================

/**
 * validateOrigin: Verifica que el Origin/Referer del request
 * sea el mismo host del servidor (simple CSRF check para browsers).
 * Solo aplica a métodos que modifican estado (POST, PUT, PATCH, DELETE).
 *
 * Para APIs REST que usan Authorization: Bearer no se aplica CSRF,
 * ya que los browsers no pueden enviar headers arbitrarios en
 * requests cross-origin sin CORS preflight. El riesgo real existe
 * únicamente cuando el token viaja por query param (?token=).
 */
export function validateOrigin(req, res, next) {
  const method = req.method?.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return next();
  }

  // Si usa Authorization header (Bearer), es una llamada API legítima
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) {
    return next();
  }

  // Si usa query param token (para descargas), validar Origin
  const origin = req.headers["origin"] || req.headers["referer"] || "";
  const host = req.headers["host"] || "";

  if (origin && !origin.includes(host)) {
    return res.status(403).json({ error: "Origen no permitido" });
  }

  next();
}
