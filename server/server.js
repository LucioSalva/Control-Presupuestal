/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Servidor Principal Express
 *  Archivo: server.js
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
// =====================================================
//  IMPORTS Y CONFIG
// =====================================================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import jwt from "jsonwebtoken";

import { query, pool } from "./db.js";
import catalogosRoutes from "./routes/catalogos.routes.js";
import adminUsuariosRouter from "./routes/admin-usuarios.routes.js";
import authRouter from "./routes/auth.routes.js";
import suficienciasRouter from "./routes/suficiencias.routes.js";
import presupuestoRouter from "./routes/presupuesto.routes.js";
import comprometidoRouter from "./routes/comprometido.routes.js";
import devengadoRouter from "./routes/devengado.routes.js";
import expedientesEntregaRouter from "./routes/expedientes_entrega.routes.js";
import metasRouter from "./routes/metas.routes.js";
import partidasRouter from "./routes/partidas.routes.js";
import presupuestoBasePartidasRouter from "./routes/presupuesto_base_partidas.routes.js";
import dashboardPartidasRouter from "./routes/dashboard_partidas.routes.js";
import reconduccionesRouter from "./routes/reconducciones.routes.js";
import reconduccionesOficiosRouter from "./routes/reconducciones_oficios.routes.js";
import adminAuditoriaRouter from "./routes/admin-auditoria.routes.js";
import { seedPartidasPermitidas } from "./utils/seed_partidas_permitidas.js";
import { logAuditEvent } from "./utils/helpers.js";
import { validateOrigin } from "./middleware/csrf.js";
import { validateEnv } from "./utils/env-schema.js";


dotenv.config();

// ── VALIDACIÓN DE ENV (fail-fast) ───────────────────────────
// Debe correr ANTES de cualquier `new Pool` o `app.listen`.
// Si falla, hace process.exit(1) con un log detallado del campo.
validateEnv();

// ── JWT SECRET ──────────────────────────────────────────────
// Después de validateEnv() sabemos que:
//   - en producción/staging: JWT_SECRET existe con longitud >= 32.
//   - en development/test: puede faltar (warning ya emitido).
// El secreto de respaldo SOLO se usa en development/test explícito.
const _JWT_SECRET = process.env.JWT_SECRET;
const _NODE_ENV = String(process.env.NODE_ENV || "").trim().toLowerCase();
const _IS_DEV_OR_TEST = _NODE_ENV === "development" || _NODE_ENV === "test" || _NODE_ENV === "";

if (!_JWT_SECRET && !_IS_DEV_OR_TEST) {
  // Doble red de seguridad — no debería llegar aquí porque validateEnv()
  // ya habría abortado, pero protege contra cambios futuros del schema.
  console.error("[FATAL] JWT_SECRET no está configurado y NODE_ENV no es dev/test. Abortando.");
  process.exit(1);
}
if (_JWT_SECRET && _JWT_SECRET.length < 32 && !_IS_DEV_OR_TEST) {
  console.error("[FATAL] JWT_SECRET tiene menos de 32 caracteres en NODE_ENV=" + _NODE_ENV + ". Abortando.");
  process.exit(1);
}
const JWT_SECRET = _JWT_SECRET || "cp_dev_only_secret_no_usar_en_prod";

// Constantes JWT — deben coincidir con auth.routes.js
const JWT_ISSUER = "control-presupuestal";
const JWT_AUDIENCE = "cp-frontend";

// =====================================================
//  TRACKING DE AUDITS PENDIENTES (C-7)
// =====================================================
// Set global de promesas de logAuditEvent en vuelo. En graceful
// shutdown esperamos a que se resuelvan (con timeout) para no
// perder eventos de auditoría críticos durante un deploy.
const pendingAuditPromises = new Set();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================================================
//  TRUST PROXY (por si algún día lo subes a Render/Nginx)
// =====================================================
app.set("trust proxy", 1);

// =====================================================
//  MIDDLEWARE BASE (SEGURIDAD)
// =====================================================


// 1) Helmet: headers de seguridad
const isProd = process.env.NODE_ENV === "production";
app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          useDefaults: true,
          directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
            "style-src": ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
            "img-src": ["'self'", "data:", "https:"],
            "font-src": ["'self'", "https://cdn.jsdelivr.net", "data:"],
            "connect-src": ["'self'", "http://localhost:3000", "http://127.0.0.1:3000"],
          },
        }
      : false, // ✅ LOCAL: deja cargar CDNs y todo
  })
);


// 2) Body size limit: evita payloads enormes
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use((req, res, next) => {
  req.cpTraceId = randomUUID();
  res.setHeader("x-trace-id", req.cpTraceId);
  next();
});

// 3) CORS: orígenes permitidos.
// En producción, configura ALLOWED_ORIGINS en .env (comma-separated).
// Ejemplo: ALLOWED_ORIGINS=https://presupuestal.ecatepec.gob.mx
const API_PORT = Number(process.env.PORT) || 3000;
const ALLOWED_ORIGINS = new Set(
  process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : [
        `http://localhost:${API_PORT}`,
        `http://127.0.0.1:${API_PORT}`,
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:5502",
        "http://127.0.0.1:5502",
      ]
);

// H-2: en producción exigimos Origin presente para métodos de
// escritura, EXCEPTO cuando viene Authorization Bearer (caso típico
// de API cliente legítima). GET/HEAD/OPTIONS siguen siendo permisivos
// para no romper healthchecks ni navegación directa.
app.use(
  cors({
    origin(origin, cb) {
      // Origen presente: validar whitelist
      if (origin) {
        if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
        return cb(new Error("CORS bloqueado: " + origin), false);
      }

      // Sin origin: permitir SIEMPRE en este callback. La regla
      // estricta para métodos de escritura se aplica más adelante en
      // un middleware dedicado (writeOriginGuard) que tiene acceso a
      // req.headers (cors() solo recibe el string origin, no el req).
      return cb(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-user-id"],
  })
);

// H-2: bloquea writes en producción cuando NO hay Origin Y NO hay
// Bearer token. Esto cierra el hueco de scripts cron/curl externos
// sin autenticación contra rutas de escritura.
const isProductionEnv = process.env.NODE_ENV === "production";
app.use((req, res, next) => {
  if (!isProductionEnv) return next();
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

// 4) Rate limit global para /api (suave)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 600, // ajusta si quieres
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes, intenta más tarde." },
});
app.use("/api", apiLimiter);

// 5) Rate limit fuerte para LOGIN (anti brute-force)
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 20, // 20 intentos por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de login. Espera 10 minutos." },
});
app.use("/api/login", loginLimiter);

// RIESGO-002: Validación de origen para prevenir CSRF en endpoints
// que aceptan token por query param (?token=) además del Bearer header.
app.use("/api", validateOrigin);

// 6) Rate limit por usuario autenticado para rutas de escritura (RIESGO-007)
// Debe aplicarse DESPUÉS de authRequired para que req.user esté disponible
const userWriteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // máx 30 requests de escritura por minuto por usuario
  keyGenerator: (req) => {
    // Si hay usuario autenticado, usar su ID como clave
    if (req.user?.id) return `u:${req.user.id}`;
    // Fallback: IP normalizada con el helper oficial (previene ERR_ERL_KEY_GEN_IPV6)
    return ipKeyGenerator(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Intenta en un momento." },
  skip: (req) => {
    // Solo aplica a métodos de escritura
    return !["POST", "PUT", "PATCH", "DELETE"].includes(req.method?.toUpperCase());
  },
});

// =====================================================
//  STATIC (FRONTEND)
// =====================================================

// =====================================================
//  ARCHIVOS JS: PRODUCCIÓN vs DESARROLLO
//  En producción (NODE_ENV=production), si existe public/dist/js/,
//  se sirven los archivos JS ofuscados desde ahí.
//  En desarrollo, se sirven directamente de public/js/.
// =====================================================
const distJsDir = path.join(__dirname, "public", "dist", "js");
if (process.env.NODE_ENV === "production" && existsSync(distJsDir)) {
  app.use("/js", express.static(distJsDir));
  console.log("[SERVER] Modo producción: sirviendo JS ofuscado de public/dist/js/");
} else {
  console.log("[SERVER] Modo desarrollo: sirviendo JS fuente de public/js/");
}

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => {
  return res.sendFile(path.join(__dirname, "public", "login.html"));
});

// =====================================================
//  AUTH — JWT firmado (issuer/audience estrictos)
// =====================================================
// C-6: El formato legacy `token-{userId}-{timestamp}` fue ELIMINADO.
// Solo se aceptan JWT verificados con issuer="control-presupuestal"
// y audience="cp-frontend". Tras el deploy, todas las sesiones
// activas con tokens legacy serán rechazadas → relogin obligatorio.

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

    if (r.rowCount === 0)
      return res.status(401).json({ error: "Token inválido" });

    const user = r.rows[0];
    if (!user.activo)
      return res.status(403).json({ error: "Usuario inactivo" });

    const roles = Array.isArray(user.roles) ? user.roles : [];

    req.user = {
      id: user.id,
      id_dgeneral: user.id_dgeneral,
      id_dauxiliar: user.id_dauxiliar,
      roles: roles.map((x) => String(x).trim().toUpperCase()),
    };

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
            // C-7: trackear la promesa para esperarla en graceful shutdown.
            // logAuditEvent() puede ser una promesa o un valor; lo normalizamos.
            const p = Promise.resolve()
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
              })
              .finally(() => {
                pendingAuditPromises.delete(p);
              });
            pendingAuditPromises.add(p);
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
//  ROUTERS API
// =====================================================

// Login / auth
app.use("/api", authRouter);

// 🔥 CIERRE DE HUECO: admin usuarios YA NO va público
app.use("/api/admin/usuarios", authRequired, requireGodOrAdmin, adminUsuariosRouter);
app.use("/api/admin/auditoria", authRequired, requireGodOrAdmin, adminAuditoriaRouter);

// =====================================================
//  HEALTH CHECK — REC-008: estado de BD incluido
//  IMPORTANTE: debe registrarse ANTES de cualquier app.use("/api", ...)
//  que aplique authRequired a nivel router (p. ej. presupuestoRouter
//  con su router.use(authRequired)), o el healthcheck devolverá 401
//  y romperá load balancers / kubernetes probes.
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
    console.error("[HEALTH] BD no disponible:", e?.message);
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  res.status(statusCode).json(health);
});

app.use("/api/suficiencias", authRequired, userWriteLimiter, suficienciasRouter);
app.use("/api/comprometido", authRequired, userWriteLimiter, comprometidoRouter);
app.use("/api/devengado", authRequired, userWriteLimiter, devengadoRouter);
app.use("/api/expedientes-entrega", authRequired, expedientesEntregaRouter);

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
  return res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

// =====================================================
//  ERROR HANDLER GLOBAL
//  BUG-005, RIESGO-006, REC-03: oculta detalles de BD en errores HTTP
// =====================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const traceId = req.cpTraceId || "N/A";
  if (process.env.NODE_ENV === "production") {
    console.error(`[ERROR][${traceId}] ${err?.message || "Error desconocido"}`);
  } else {
    console.error(`[ERROR][${traceId}]`, err);
  }
  return res.status(500).json({
    error: "Error interno del servidor",
    trace_id: traceId,
  });
});

// =====================================================
//  HELPER: fail-fast de migraciones (H-11)
// =====================================================
// En cualquier entorno que NO sea "development", si una migración
// falla → abortamos el arranque con process.exit(1). En development
// mantenemos el comportamiento permisivo para no bloquear el dev
// loop cuando alguien está iterando schema.
function handleMigrationFailure(nombre, error) {
  const env = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const isDev = env === "development" || env === "";
  console.error(`[MIGRATION] ${nombre} error:`, error?.message || error);
  if (!isDev) {
    console.error(`[FATAL] Migración "${nombre}" falló en NODE_ENV=${env}. Abortando arranque.`);
    process.exit(1);
  }
}

// =====================================================
//  ARRANQUE
// =====================================================
(async () => {
  try {
    try {
      const r = await query("SELECT to_regclass('public.reconducciones') AS tbl");
      const exists = Boolean(r.rows?.[0]?.tbl);
      if (!exists) {
        const sqlPath = path.join(__dirname, "sql", "migrations", "2026_02_23_reconducciones.sql");
        const sql = await fs.readFile(sqlPath, "utf8");
        await query(sql);
        console.log("[MIGRATION] reconducciones aplicada");
      }
    } catch (e) {
      handleMigrationFailure("reconducciones", e);
    }

    // Migración: reconduccion_oficios
    try {
      const rOficios = await query("SELECT to_regclass('public.reconduccion_oficios') AS tbl");
      const existsOficios = Boolean(rOficios.rows?.[0]?.tbl);
      if (!existsOficios) {
        const sqlPathOficios = path.join(__dirname, "sql", "migrations", "2026_03_11_reconduccion_oficios.sql");
        const sqlOficios = await fs.readFile(sqlPathOficios, "utf8");
        await query(sqlOficios);
        console.log("[MIGRATION] reconduccion_oficios aplicada");
      }
    } catch (e) {
      handleMigrationFailure("reconduccion_oficios", e);
    }

    // Migración: firma fields en reconducciones
    try {
      const rFirmas = await query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='reconducciones' AND column_name='firma_enlace_label'"
      );
      if (rFirmas.rowCount === 0) {
        const sqlPathFirmas = path.join(__dirname, "sql", "migrations", "2026_03_11_reconducciones_firmas.sql");
        const sqlFirmas = await fs.readFile(sqlPathFirmas, "utf8");
        await query(sqlFirmas);
        console.log("[MIGRATION] reconducciones_firmas aplicada");
      }
    } catch (e) {
      handleMigrationFailure("reconducciones_firmas", e);
    }

    // Migración: firma fields en suficiencias, comprometidos y devengados
    try {
      const rFirmasSuf = await query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='suficiencias' AND column_name='firma_enlace_label'"
      );
      if (rFirmasSuf.rowCount === 0) {
        const sqlPathFirmasSuf = path.join(__dirname, "sql", "migrations", "2026_03_11_firmas_suf_comp_dev.sql");
        const sqlFirmasSuf = await fs.readFile(sqlPathFirmasSuf, "utf8");
        await query(sqlFirmasSuf);
        console.log("[MIGRATION] firmas_suf_comp_dev aplicada");
      }
    } catch (e) {
      handleMigrationFailure("firmas_suf_comp_dev", e);
    }

    // Migración: función fn_saldo_disponible_partida
    try {
      const rFnSaldo = await query(
        "SELECT routine_name FROM information_schema.routines WHERE routine_name = 'fn_saldo_disponible_partida' AND routine_schema = 'public'"
      );
      if (rFnSaldo.rowCount === 0) {
        const sqlPathFnSaldo = path.join(__dirname, "sql", "migrations", "2026_03_11_fn_saldo_partida.sql");
        const sqlFnSaldo = await fs.readFile(sqlPathFnSaldo, "utf8");
        await query(sqlFnSaldo);
        console.log("[MIGRATION] fn_saldo_disponible_partida aplicada");
      }
    } catch (e) {
      handleMigrationFailure("fn_saldo_disponible_partida", e);
    }

    // Migración: normalización general de presupuesto_db
    // (idempotente: usa IF NOT EXISTS / IF EXISTS en todo el script)
    try {
      const rNorm = await query(
        "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_suf_saldo_lookup' LIMIT 1"
      );
      if (rNorm.rowCount === 0) {
        const sqlPathNorm = path.join(__dirname, "sql", "migrations", "2026_03_11_normalizacion_db.sql");
        const sqlNorm = await fs.readFile(sqlPathNorm, "utf8");
        await query(sqlNorm);
        console.log("[MIGRATION] normalizacion_db aplicada");
      }
    } catch (e) {
      handleMigrationFailure("normalizacion_db", e);
    }

    // Migración: FKs y triggers en expedientes_entrega
    try {
      const rExpFks = await query(
        "SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='fk_expedientes_suficiencia' AND table_name='expedientes_entrega' LIMIT 1"
      );
      if (rExpFks.rowCount === 0) {
        const sqlPathExpFks = path.join(__dirname, "sql", "2026_03_18_expedientes_entrega_fks.sql");
        const sqlExpFks = await fs.readFile(sqlPathExpFks, "utf8");
        await query(sqlExpFks);
        console.log("[MIGRATION] expedientes_entrega_fks aplicada");
      }
    } catch (e) {
      handleMigrationFailure("expedientes_entrega_fks", e);
    }

    // Migración: sequences para generación atómica de folios
    try {
      const rSeq = await query(
        "SELECT 1 FROM information_schema.sequences WHERE sequence_name = 'seq_suficiencia_folio' AND sequence_schema = 'public' LIMIT 1"
      );
      if (rSeq.rowCount === 0) {
        const sqlPathSeq = path.join(__dirname, "sql", "2026_03_19_folio_sequences.sql");
        const sqlSeq = await fs.readFile(sqlPathSeq, "utf8");
        await query(sqlSeq);
        console.log("[MIGRATION] folio_sequences aplicada");
      }
    } catch (e) {
      handleMigrationFailure("folio_sequences", e);
    }

    // Migración 2026-05-21: folios mensuales atómicos + lock saldo
    // (idempotente: usa CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
    //  ON CONFLICT DO NOTHING para el seed, y guard sobre pg_constraint para UNIQUE)
    try {
      const rFoliosMes = await query(
        "SELECT to_regclass('public.folios_contadores') AS tbl"
      );
      const existsFolios = Boolean(rFoliosMes.rows?.[0]?.tbl);
      if (!existsFolios) {
        const sqlPathFolios = path.join(
          __dirname, "sql", "migrations", "2026_05_21_folios_mensuales.sql"
        );
        const sqlFolios = await fs.readFile(sqlPathFolios, "utf8");
        await query(sqlFolios);
        console.log("[MIGRATION] folios_mensuales aplicada");
      }
    } catch (e) {
      handleMigrationFailure("folios_mensuales", e);
    }

    // Migración 2026-05-21: corrección de fn_saldo_disponible_partida
    // Hallazgo B-4: la versión 2026-03-11 leía columnas inexistentes
    // (pb.monto, pb.clave, s.monto, c.monto). Se reescribe usando el
    // esquema real (columnas mensuales ene..dic + tablas *_detalle).
    // Reaplicar siempre con CREATE OR REPLACE para corregir instalaciones
    // que ya tenían la versión rota.
    try {
      const sqlPathFnSaldoFix = path.join(
        __dirname, "sql", "migrations", "2026_05_21_fn_saldo_fix.sql"
      );
      const sqlFnSaldoFix = await fs.readFile(sqlPathFnSaldoFix, "utf8");
      await query(sqlFnSaldoFix);
      console.log("[MIGRATION] fn_saldo_fix aplicada");
    } catch (e) {
      handleMigrationFailure("fn_saldo_fix", e);
    }

    if (process.env.SEED === "true") {
      await seedPartidasPermitidas();
    }
  } catch (e) {
    console.error("[SEED] Error:", e);
  }

  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    console.log("API escuchando en http://localhost:" + PORT);
  });

  // ── Graceful shutdown ────────────────────────────────────
  // C-7: además de cerrar el servidor HTTP, esperamos a que se
  // resuelvan los logAuditEvent en vuelo (con timeout de 8s) antes
  // de cerrar el pool. Esto evita perder eventos críticos durante
  // un deploy en producción.
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SHUTDOWN] ${signal} recibido — cerrando servidor...`);

    // 1) Dejar de aceptar conexiones nuevas.
    server.close(async () => {
      try {
        // 2) Esperar audits en vuelo (máx 8s).
        const pending = [...pendingAuditPromises];
        if (pending.length > 0) {
          console.log(`[SHUTDOWN] esperando ${pending.length} audits…`);
          const timeoutPromise = new Promise((resolve) =>
            setTimeout(() => resolve("timeout"), 8000)
          );
          const result = await Promise.race([
            Promise.allSettled(pending),
            timeoutPromise,
          ]);
          if (result === "timeout") {
            console.warn(
              `[SHUTDOWN] timeout de audits — ${pendingAuditPromises.size} pendientes descartados.`
            );
          } else {
            console.log("[SHUTDOWN] audits drenados correctamente.");
          }
        }
      } catch (e) {
        console.error("[SHUTDOWN] error esperando audits:", e?.message || e);
      }

      // 3) Cerrar pool de Postgres.
      try {
        await pool.end();
      } catch (e) {
        console.error("[SHUTDOWN] error cerrando pool:", e?.message || e);
      }

      console.log("[SHUTDOWN] Conexiones cerradas. Proceso terminado.");
      process.exit(0);
    });

    // 4) Red de seguridad: timeout duro de 10s para todo el proceso.
    setTimeout(() => {
      console.error("[SHUTDOWN] Timeout forzado.");
      process.exit(1);
    }, 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
})();

