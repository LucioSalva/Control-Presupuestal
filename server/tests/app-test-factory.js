/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: Factory de app Express para tests
 * ================================================================
 *  Construye una instancia de Express configurada EXACTAMENTE
 *  igual que server.js (mismos middlewares, mismo orden de auth,
 *  mismos routers) pero SIN llamar a app.listen() ni ejecutar
 *  migraciones.
 *
 *  H-8: la versión anterior sólo montaba 4 routers y usaba un
 *  /api/health falso ({ok:true}). El sistema real expone más
 *  rutas y un health distinto. Esta versión replica el árbol real.
 *
 *  CRÍTICO: este factory debe importarse DESPUÉS de que el test
 *  haya hecho `jest.unstable_mockModule("../db.js", ...)`. De otra
 *  forma los routers se quedarán con el Pool real al cargar.
 * ================================================================
 */
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

import { query } from "../db.js";
import authRouter from "../routes/auth.routes.js";
import suficienciasRouter from "../routes/suficiencias.routes.js";
import presupuestoRouter from "../routes/presupuesto.routes.js";
import comprometidoRouter from "../routes/comprometido.routes.js";
import devengadoRouter from "../routes/devengado.routes.js";
import expedientesEntregaRouter from "../routes/expedientes_entrega.routes.js";
import catalogosRoutes from "../routes/catalogos.routes.js";
import partidasRouter from "../routes/partidas.routes.js";
import metasRouter from "../routes/metas.routes.js";
import presupuestoBasePartidasRouter from "../routes/presupuesto_base_partidas.routes.js";
import dashboardPartidasRouter from "../routes/dashboard_partidas.routes.js";
import reconduccionesRouter from "../routes/reconducciones.routes.js";
import reconduccionesOficiosRouter from "../routes/reconducciones_oficios.routes.js";
import adminUsuariosRouter from "../routes/admin-usuarios.routes.js";
import adminAuditoriaRouter from "../routes/admin-auditoria.routes.js";

import { logAuditEvent } from "../utils/helpers.js";
import { validateOrigin } from "../middleware/csrf.js";
import jwt from "jsonwebtoken";

// =====================================================
//  CONSTANTES JWT (idénticas a server.js y middleware/auth.js)
// =====================================================
const _JWT_SECRET = process.env.JWT_SECRET || "cp_dev_only_secret_no_usar_en_prod";
const JWT_ISSUER = "control-presupuestal";
const JWT_AUDIENCE = "cp-frontend";

// =====================================================
//  HELPERS DE AUTH (réplica fiel de server.js — C-6 JWT-only)
// =====================================================
function extractRawToken(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  if (req.query?.token) return String(req.query.token).trim();
  return null;
}

/**
 * C-6: SOLO JWT firmado (issuer + audience estrictos, HS256).
 * El formato legacy `token-{id}-{ts}` ya NO se acepta.
 */
function resolveUserId(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  try {
    const decoded = jwt.verify(rawToken, _JWT_SECRET, {
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

    // Auditoría automática en escrituras — réplica de server.js
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
              .catch(() => {});
          } catch {}
        });
      }
    } catch {}

    next();
  } catch (e) {
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
//  HELPERS DE FIRMA DE TOKEN PARA TESTS
// =====================================================
/**
 * Firma un JWT con los mismos parámetros que auth.routes.js emite en login.
 * Los tests usan esto para construir tokens válidos rápidamente.
 */
export function signTestToken(userId, opts = {}) {
  const payload = { sub: userId, roles: opts.roles || ["AREA"] };
  return jwt.sign(payload, _JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: opts.expiresIn || "10m",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    ...(opts.notBefore ? { notBefore: opts.notBefore } : {}),
  });
}

/**
 * Firma un JWT con expiración pasada (para tests de token expirado).
 */
export function signExpiredToken(userId) {
  return jwt.sign(
    { sub: userId, roles: ["AREA"] },
    _JWT_SECRET,
    {
      algorithm: "HS256",
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: "-1s", // ya expirado
    }
  );
}

// =====================================================
//  FACTORY
// =====================================================
/**
 * Crea una instancia de Express configurada como server.js.
 * @param {object} opts
 * @param {boolean} opts.production  Si true, simula NODE_ENV=production
 *                                    (activa el writeOriginGuard estricto).
 * @param {boolean} opts.skipCors    Si true, no instala el middleware CORS
 *                                    (útil para tests de Origin que necesitan
 *                                    enviar Origin "cross-site" sin que CORS
 *                                    lo rechace antes).
 * @param {boolean} opts.enableOriginGuard
 *                                    Si true, instala validateOrigin (H-1).
 *                                    Por defecto false en tests para que
 *                                    supertest (que no manda Origin) pueda
 *                                    hacer POST sin recibir 403. Los tests
 *                                    específicos de CSRF/Origin lo activan.
 */
export function createTestApp(opts = {}) {
  const app = express();
  const isProd = !!opts.production;
  // validateOrigin (H-1) y writeOriginGuard (H-2) son los dos guards
  // de CSRF. En tests por defecto los desactivamos para que supertest
  // (que no envía Origin por defecto) no reciba 403 en POST de login.
  // Los tests de csrf-origin los activan con opts.enableOriginGuard.
  const enableOriginGuard = !!opts.enableOriginGuard;

  app.set("trust proxy", 1);

  // 1) Helmet (sin CSP en tests para no bloquear nada)
  app.use(helmet({ contentSecurityPolicy: false }));

  // 2) Body parser con límite 1mb (igual que server.js)
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // 3) Trace ID
  app.use((req, res, next) => {
    req.cpTraceId = randomUUID();
    res.setHeader("x-trace-id", req.cpTraceId);
    next();
  });

  // 4) CORS — permisivo en tests para no bloquear supertest. Se puede
  //    desactivar con opts.skipCors si el test necesita probar el
  //    writeOriginGuard sin que cors() responda antes.
  if (!opts.skipCors) {
    app.use(
      cors({
        origin(_origin, cb) {
          // Aceptar cualquier origen en tests. La validación estricta
          // se hace en writeOriginGuard (H-2) y validateOrigin (RIESGO-002).
          return cb(null, true);
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization", "x-user-id", "x-recon-session"],
      })
    );
  }

  // 5) H-2 — writeOriginGuard: en production exige Origin O Bearer.
  //    En tests solo se instala si isProd=true (modo simulado).
  if (isProd && enableOriginGuard) {
    app.use((req, res, next) => {
      const method = String(req.method || "").toUpperCase();
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return next();
      const origin = String(req.headers["origin"] || "").trim();
      if (origin) return next();
      const auth = String(req.headers["authorization"] || "");
      if (/^Bearer\s+/i.test(auth)) return next();
      return res.status(403).json({
        error: "origin_required",
        trace_id: req.cpTraceId || null,
      });
    });
  }

  // 6) Rate limit muy alto para no interferir con tests
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10000,
    standardHeaders: false,
    legacyHeaders: false,
  });
  app.use("/api", apiLimiter);

  // 7) Rate limit fuerte para LOGIN (igual que server.js — anti-bruteforce).
  //    En tests lo dejamos alto para no romper suites.
  const loginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 1000,
    standardHeaders: false,
    legacyHeaders: false,
  });
  app.use("/api/login", loginLimiter);

  // 8) RIESGO-002 / H-1: validateOrigin con parseo URL estricto.
  //    Solo se instala si el test lo pide (opts.enableOriginGuard).
  if (enableOriginGuard) {
    app.use("/api", validateOrigin);
  }

  // 9) Rate limit por usuario autenticado para escrituras (RIESGO-007).
  //    Se aplica solo si hay user; muy alto en tests.
  const userWriteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10000,
    keyGenerator: (req) => {
      if (req.user?.id) return `u:${req.user.id}`;
      return ipKeyGenerator(req);
    },
    standardHeaders: false,
    legacyHeaders: false,
    skip: (req) => !["POST", "PUT", "PATCH", "DELETE"].includes(req.method?.toUpperCase()),
  });

  // =====================================================
  //  ROUTERS API — orden idéntico a server.js
  // =====================================================
  app.use("/api", authRouter);

  app.use("/api/admin/usuarios", authRequired, requireGodOrAdmin, adminUsuariosRouter);
  app.use("/api/admin/auditoria", authRequired, requireGodOrAdmin, adminAuditoriaRouter);

  // =====================================================
  //  HEALTH CHECK — REC-008 (idéntico a server.js)
  //  IMPORTANTE: se registra ANTES de cualquier app.use("/api", ...)
  //  con authRequired a nivel router (p. ej. presupuestoRouter), o
  //  el healthcheck devolvería 401 (ver fix de orden en server.js).
  // =====================================================
  app.get("/api/health", async (req, res) => {
    const health = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        unit: "MB",
      },
      database: { status: "unknown", latency_ms: null },
    };

    try {
      const dbStart = Date.now();
      await query("SELECT 1");
      health.database.status = "ok";
      health.database.latency_ms = Date.now() - dbStart;
    } catch (e) {
      health.status = "degraded";
      health.database.status = "error";
    }

    const statusCode = health.status === "ok" ? 200 : 503;
    res.status(statusCode).json(health);
  });

  app.use("/api/suficiencias", authRequired, userWriteLimiter, suficienciasRouter);
  app.use("/api/comprometido", authRequired, userWriteLimiter, comprometidoRouter);
  app.use("/api/devengado", authRequired, userWriteLimiter, devengadoRouter);
  app.use("/api/expedientes-entrega", authRequired, expedientesEntregaRouter);

  // presupuestoRouter aplica su propio authRequired internamente (B-1).
  app.use("/api", presupuestoRouter);

  app.use("/api/catalogos/partidas", authRequired, blockPartidasWrite, partidasRouter);
  app.use("/api/presupuesto-base-partidas", authRequired, requireGodOrAdmin, presupuestoBasePartidasRouter);
  app.use("/api/catalogos/metas", authRequired, metasRouter);
  app.use("/api/catalogos", authRequired, catalogosRoutes);
  app.use("/api/dashboard", authRequired, dashboardPartidasRouter);
  app.use("/api/reconducciones", authRequired, userWriteLimiter, reconduccionesRouter);
  app.use("/api/reconducciones", authRequired, userWriteLimiter, reconduccionesOficiosRouter);

  // =====================================================
  //  404 — RUTAS NO ENCONTRADAS
  // =====================================================
  app.use((req, res) => {
    if (req.originalUrl.startsWith("/api/")) {
      return res.status(404).json({ error: "Ruta de API no encontrada" });
    }
    return res.status(404).json({ error: "Not found" });
  });

  // =====================================================
  //  ERROR HANDLER GLOBAL — oculta detalles de BD
  // =====================================================
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const traceId = req.cpTraceId || "N/A";
    return res.status(500).json({
      error: "Error interno del servidor",
      trace_id: traceId,
    });
  });

  return app;
}
