/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: Factory de app Express para tests
 * ================================================================
 *  Construye una instancia de Express configurada exactamente igual
 *  que server.js pero SIN llamar a app.listen() ni ejecutar
 *  migraciones de BD.
 *
 *  Razón: server.js ejecuta su arranque dentro de un IIFE asíncrono
 *  y no exporta `app`. Esta factory replica la configuración de
 *  middleware y rutas para que Supertest pueda usarla.
 * ================================================================
 */
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { randomUUID } from "crypto";

import { query } from "../db.js";
import authRouter from "../routes/auth.routes.js";
import suficienciasRouter from "../routes/suficiencias.routes.js";
import catalogosRoutes from "../routes/catalogos.routes.js";
import partidasRouter from "../routes/partidas.routes.js";
import metasRouter from "../routes/metas.routes.js";
import { logAuditEvent } from "../utils/helpers.js";
import jwt from "jsonwebtoken";

// =====================================================
//  CONSTANTES
// =====================================================
const _JWT_SECRET = process.env.JWT_SECRET || "cp_dev_only_secret_no_usar_en_prod";
const MAX_AGE_MS = 10 * 60 * 1000;

// =====================================================
//  HELPERS DE AUTH (réplica fiel de server.js)
// =====================================================
function extractRawToken(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  if (req.query?.token) return String(req.query.token).trim();
  return null;
}

function parseLegacyToken(rawToken) {
  const parts = rawToken.split("-");
  if (parts.length < 3) return null;
  if (parts[0] !== "token") return null;
  const userId = Number(parts[1]);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const ts = Number(parts[2]);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (Date.now() - ts > MAX_AGE_MS) return null;
  return { userId, ts };
}

function resolveUserId(rawToken) {
  try {
    const decoded = jwt.verify(rawToken, _JWT_SECRET);
    const userId = Number(decoded?.id);
    if (Number.isFinite(userId) && userId > 0) return userId;
  } catch {
    // No es JWT — continúa con formato legacy
  }
  const legacy = parseLegacyToken(rawToken);
  return legacy ? legacy.userId : null;
}

async function authRequired(req, res, next) {
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

    // Auditoría automática en escrituras
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
            const tipo = `${tipoBase}_${method}_${seg}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
            logAuditEvent(req, {
              tipo,
              entidad: "HTTP",
              entidad_id: null,
              estado: `HTTP_${sc}`,
              detalles: { auto: true, status: sc },
            });
          } catch {}
        });
      }
    } catch {}

    next();
  } catch (e) {
    console.error("[AUTH-TEST] Error:", e);
    return res.status(500).json({ error: "Error interno de autenticación" });
  }
}

function isGodOrAdmin(req) {
  const roles = req.user?.roles || [];
  return roles.includes("GOD") || roles.includes("ADMIN");
}

function requireGodOrAdmin(req, res, next) {
  if (!isGodOrAdmin(req)) {
    return res.status(403).json({ error: "Solo GOD/ADMIN puede acceder." });
  }
  next();
}

function blockPartidasWrite(req, res, next) {
  const method = String(req.method || "").toUpperCase();
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (!isWrite) return next();
  if (req.path === "/monto") return next();
  if (!isGodOrAdmin(req)) {
    return res.status(403).json({
      error: "AREA no puede modificar el catálogo de partidas (solo GOD/ADMIN).",
    });
  }
  next();
}

// =====================================================
//  FACTORY
// =====================================================
export function createTestApp() {
  const app = express();

  // Helmet desactivado en tests para no interferir con headers
  app.use(helmet({ contentSecurityPolicy: false }));

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // Trace ID
  app.use((req, res, next) => {
    req.cpTraceId = randomUUID();
    res.setHeader("x-trace-id", req.cpTraceId);
    next();
  });

  // CORS permisivo en tests (Supertest no manda Origin)
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        return cb(null, true); // en tests aceptar cualquier origen
      },
      credentials: true,
    })
  );

  // Rate limit muy alto para no interferir con tests
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10000,
    standardHeaders: false,
    legacyHeaders: false,
  });
  app.use("/api", apiLimiter);

  // =====================================================
  //  RUTAS
  // =====================================================
  app.use("/api", authRouter);
  app.use("/api/suficiencias", authRequired, suficienciasRouter);
  app.use("/api/catalogos/partidas", authRequired, blockPartidasWrite, partidasRouter);
  app.use("/api/catalogos/metas", authRequired, metasRouter);
  app.use("/api/catalogos", authRequired, catalogosRoutes);

  // Health
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // 404 para rutas API no encontradas
  app.use((req, res) => {
    if (req.originalUrl.startsWith("/api/")) {
      return res.status(404).json({ error: "Ruta de API no encontrada" });
    }
    return res.status(404).json({ error: "Not found" });
  });

  // Error handler global (oculta detalles de BD)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const traceId = req.cpTraceId || "N/A";
    console.error(`[TEST-APP][ERROR] trace=${traceId}`, err);
    return res.status(500).json({
      error: "Error interno del servidor",
      trace_id: traceId,
    });
  });

  return app;
}
