/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Middleware de Autenticación (Fase 3A)
 *  Archivo: middleware/auth.js
 *
 *  Extrae authRequired desde server.js para permitir que routers
 *  individuales apliquen la guardia a nivel router (necesario en
 *  presupuesto.routes.js, que en server.js se montaba SIN auth).
 *
 *  La validación de JWT_SECRET en producción ya ocurre en
 *  validateEnv() durante el arranque (server.js). Aquí sólo
 *  reutilizamos process.env.JWT_SECRET con el mismo fallback
 *  dev-only que server.js para no divergir.
 *
 *  © 2025–2026 Humberto Salvador Ruiz Lucio.
 *  Todos los derechos reservados.
 * ================================================================
 */
import jwt from "jsonwebtoken";
import { query } from "../db.js";
import { logAuditEvent } from "../utils/helpers.js";

// =====================================================
//  CONSTANTES JWT (deben coincidir con server.js y auth.routes.js)
// =====================================================
const JWT_SECRET = process.env.JWT_SECRET || "cp_dev_only_secret_no_usar_en_prod";
const JWT_ISSUER = "control-presupuestal";
const JWT_AUDIENCE = "cp-frontend";

// =====================================================
//  EXTRACTOR DE TOKEN
// =====================================================
/**
 * Extrae el rawToken del header Authorization o del query param ?token=
 * (el query param solo se acepta para descargas vía window.open).
 */
function extractRawToken(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  if (req.query?.token) return String(req.query.token).trim();
  return null;
}

/**
 * Verifica un JWT firmado y retorna el userId del campo `sub`.
 * Si el token es inválido, está expirado, o no coincide
 * issuer/audience → retorna null.
 */
function resolveUserId(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  try {
    const decoded = jwt.verify(rawToken, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    });
    const userId = Number(decoded?.sub);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    return userId;
  } catch {
    return null;
  }
}

// =====================================================
//  AUTH REQUIRED — MIDDLEWARE PRINCIPAL
// =====================================================
/**
 * Valida el JWT y carga req.user con { id, id_dgeneral, id_dauxiliar, roles }.
 * Además inscribe un res.on("finish") para auditoría automática de
 * escrituras (mismo patrón que server.js, sin tracking de promesas
 * porque el shutdown hook ya está conectado al Set global allá).
 */
export async function authRequired(req, res, next) {
  try {
    const rawToken = extractRawToken(req);
    if (!rawToken) return res.status(401).json({ error: "Token requerido" });

    const userId = resolveUserId(rawToken);
    if (!userId) return res.status(401).json({ error: "Token requerido" });

    const sql = `
      SELECT u.id,
             u.activo,
             u.id_dgeneral,
             u.id_dauxiliar,
             ARRAY(
               SELECT r.clave
               FROM usuario_rol ur
               JOIN roles r ON r.id = ur.id_rol
               WHERE ur.id_usuario = u.id
             ) AS roles
      FROM usuarios u
      WHERE u.id = $1
      LIMIT 1;
    `;

    const r = await query(sql, [userId]);
    if (r.rowCount === 0) return res.status(401).json({ error: "Token inválido" });

    const user = r.rows[0];
    if (!user.activo) return res.status(403).json({ error: "Usuario inactivo" });

    const roles = Array.isArray(user.roles) ? user.roles : [];

    req.user = {
      id: user.id,
      id_dgeneral: user.id_dgeneral,
      id_dauxiliar: user.id_dauxiliar,
      roles: roles.map((x) => String(x).trim().toUpperCase()),
    };

    // Auditoría automática para escrituras.
    try {
      const method = String(req.method || "").toUpperCase();
      const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
      const pathNoQuery = String(req.originalUrl || req.path || "").split("?")[0];
      const isAuditApi = pathNoQuery.startsWith("/api/admin/auditoria");
      if (isWrite && !isAuditApi) {
        res.on("finish", () => {
          try {
            if (req._cpAuditLogged) return;
            const sc = Number(res.statusCode || 0);
            const ok = sc >= 200 && sc < 400;
            const denied = sc === 401 || sc === 403;
            if (!ok && !denied) return;
            const seg = pathNoQuery.replace(/^\/api\/?/, "").split("/")[0] || "API";
            const tipoBase = denied ? "AUTO_DENEGADO" : "AUTO";
            const tipo = `${tipoBase}_${method}_${seg}`
              .toUpperCase()
              .replace(/[^A-Z0-9_]/g, "_");
            // Best-effort; no se trackea para shutdown porque server.js
            // ya hace el tracking en su propio authRequired. Para rutas
            // que pasan por este middleware (presupuesto.routes.js),
            // perder el audit en shutdown es tolerable.
            Promise.resolve()
              .then(() =>
                logAuditEvent(req, {
                  tipo,
                  entidad: "HTTP",
                  entidad_id: null,
                  estado: `HTTP_${sc}`,
                  detalles: { auto: true, status: sc },
                })
              )
              .catch((err) => {
                console.error("[AUDIT] fallo:", err?.message || err);
              });
          } catch {}
        });
      }
    } catch {}

    next();
  } catch (e) {
    console.error("[AUTH] Error:", e);
    return res.status(500).json({ error: "Error interno de autenticación" });
  }
}

// =====================================================
//  HELPERS DE ROL
// =====================================================
export function isGodOrAdmin(req) {
  const roles = req.user?.roles || [];
  return roles.includes("GOD") || roles.includes("ADMIN");
}

export function isGod(req) {
  const roles = req.user?.roles || [];
  return roles.includes("GOD");
}

export function requireGodOrAdmin(req, res, next) {
  if (!isGodOrAdmin(req)) {
    return res.status(403).json({ error: "Solo GOD/ADMIN puede acceder." });
  }
  next();
}

/**
 * Guardia GOD-only. Usado para operaciones destructivas como
 * DELETE /api/project (borrado completo de un proyecto).
 */
export function requireGod(req, res, next) {
  if (!isGod(req)) {
    return res.status(403).json({
      error: "Operación restringida: solo GOD puede ejecutarla.",
      trace_id: req.cpTraceId || null,
    });
  }
  next();
}
