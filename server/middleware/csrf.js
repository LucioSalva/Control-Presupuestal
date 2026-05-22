/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 * ================================================================
 *  Módulo: Middleware CSRF
 *  Archivo: middleware/csrf.js
 *
 *  RIESGO-002: Protección CSRF para endpoints que aceptan token
 *  por query param (?token=), usados en descargas con window.open.
 *
 *  H-1: Parseo estricto del Origin con new URL() — se elimina el
 *  bug de substring (`origin.includes(host)` aceptaba originales
 *  como `https://malicioso.com/?host=ecatepec.gob.mx`).
 * ================================================================
 */

// =====================================================
//  VALIDACIÓN DE ORIGEN (CSRF SIMPLIFICADO)
// =====================================================

/**
 * validateOrigin: Verifica que el Origin/Referer del request
 * coincida exactamente (host + puerto) con el host del servidor.
 * Solo aplica a métodos que modifican estado (POST, PUT, PATCH, DELETE).
 *
 * Comportamiento:
 *  - Métodos seguros (GET/HEAD/OPTIONS): pasa siempre.
 *  - Authorization: Bearer presente → pasa (es API legítima, CSRF
 *    no aplica al no haber cookies de sesión cross-origin).
 *  - No hay header Origin/Referer pero sí Authorization: pasa.
 *  - Hay Origin/Referer: se parsea con new URL() y se compara
 *    host estricto contra el header Host del servidor.
 *  - Si el parseo falla → 403 invalid_origin.
 *  - Si el host no coincide → 403 origin_mismatch.
 */
export function validateOrigin(req, res, next) {
  const method = String(req.method || "").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return next();
  }

  // Si usa Authorization header (Bearer), es una llamada API legítima.
  // Los browsers no pueden setear headers arbitrarios cross-origin sin
  // preflight CORS, así que el riesgo CSRF aquí no aplica.
  const authHeader = String(req.headers["authorization"] || "");
  if (/^Bearer\s+/i.test(authHeader)) {
    return next();
  }

  const origin = String(req.headers["origin"] || req.headers["referer"] || "").trim();
  const host = String(req.headers["host"] || "").trim();

  // Si no hay header Origin/Referer y no había Bearer, no podemos
  // verificar el origen → bloqueamos por seguridad.
  if (!origin) {
    return res.status(403).json({
      error: "origin_required",
      trace_id: req.cpTraceId || null,
    });
  }

  // Parseo estricto. new URL() lanza si la cadena no es absoluta válida.
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return res.status(403).json({
      error: "invalid_origin",
      trace_id: req.cpTraceId || null,
    });
  }

  if (!host || originHost !== host) {
    return res.status(403).json({
      error: "origin_mismatch",
      trace_id: req.cpTraceId || null,
    });
  }

  next();
}
