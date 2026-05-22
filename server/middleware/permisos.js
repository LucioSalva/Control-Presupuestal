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
import {
  checkIsUserL00117,
  checkIsUserE00,
  isPartidaMilKey,
  logUnauthorizedPartidasAccess,
} from "../utils/helpers.js";

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
 * Recolecta posibles claves de partida desde body, query y params.
 * Cubre los campos comunes utilizados en el sistema:
 *   - clave_programatica, partida_clave, partida, clave
 *   - id_partida (numérico — se ignora porque no es la clave textual)
 * Para arrays/objetos anidados (ej. recursos[], lados[], detalle[]),
 * recorre recursivamente y extrae las claves de los renglones.
 *
 * H-4/C-4 (Fase 3B): centralizado para que `blockPartidasMilAccess`
 * detecte partidas mil ocultas dentro de arrays anidados.
 */
function extractPartidaClaves(source) {
  const claves = [];
  if (source == null) return claves;

  const CLAVE_KEYS = new Set([
    "clave_programatica",
    "partida_clave",
    "partida",
    "clave",
  ]);

  function visit(node, depth = 0) {
    if (node == null || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (CLAVE_KEYS.has(k) && (typeof v === "string" || typeof v === "number")) {
        const s = String(v).trim();
        if (s) claves.push(s);
      } else if (v && typeof v === "object") {
        visit(v, depth + 1);
      }
    }
  }

  visit(source, 0);
  return claves;
}

/**
 * Middleware: bloquea acceso a partidas mil (clave 1xxx) para usuarios
 * que no son L00/117 ni E00.
 *
 * Lee body, query y params; recorre arrays/objetos anidados.
 * Si encuentra al menos una partida mil y el usuario no tiene permisos,
 * registra en auditoría y devuelve 403.
 *
 * IMPORTANTE: este middleware fail-CLOSE — si hay error al verificar
 * permisos, deniega el acceso para evitar bypass por excepción.
 * (Cambio C-4 Fase 3B respecto al fail-open anterior.)
 */
export async function blockPartidasMilAccess(req, res, next) {
  try {
    const claves = [
      ...extractPartidaClaves(req.body),
      ...extractPartidaClaves(req.query),
      ...extractPartidaClaves(req.params),
    ];
    const milClaves = claves.filter((c) => isPartidaMilKey(c));
    if (milClaves.length === 0) return next();

    const [isL00, isE00] = await Promise.all([
      checkIsUserL00117(req),
      checkIsUserE00(req),
    ]);
    if (isL00 || isE00) return next();

    try {
      await logUnauthorizedPartidasAccess(req, {
        motivo: "PARTIDA_MIL_WRITE_BLOQUEADO",
        data: { claves: milClaves.slice(0, 20) },
      });
    } catch (_) {
      // best-effort: si falla la auditoría no romper la respuesta
    }

    return res.status(403).json({
      error: "Sin permisos para operar sobre partidas mil",
      trace_id: req.cpTraceId,
    });
  } catch (err) {
    // fail-close: si no pudimos validar permisos, denegar.
    console.error("[blockPartidasMilAccess] Error:", err);
    return res.status(500).json({
      error: "No fue posible validar permisos sobre partidas",
      trace_id: req.cpTraceId,
    });
  }
}
