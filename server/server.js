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


dotenv.config();

// ── JWT SECRET ──────────────────────────────────────────────
// En producción es obligatorio; en desarrollo se usa un valor
// de respaldo exclusivo para entorno local (no apto para prod).
const _JWT_SECRET = process.env.JWT_SECRET;
if (!_JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("[FATAL] JWT_SECRET no está configurado en .env. El servidor se detendrá.");
    process.exit(1);
  } else {
    // Solo en desarrollo: continúa con valor local, nunca usar en producción
    console.warn("[WARN] JWT_SECRET no configurado. Usando secreto de desarrollo — NO APTO PARA PRODUCCIÓN.");
  }
}
const JWT_SECRET = _JWT_SECRET || "cp_dev_only_secret_no_usar_en_prod";

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

app.use(
  cors({
    origin(origin, cb) {
      // Permitir tools como Postman/curl (sin origin)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      return cb(new Error("CORS bloqueado: " + origin), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-user-id"],
  })
);

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
//  AUTH — JWT (nuevo) + formato legacy token-{id}-{ts}
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
 * Intenta parsear el formato legacy: token-{userId}-{timestamp}
 * Retorna { userId } si es válido, null si no.
 */
function parseLegacyToken(rawToken) {
  const parts = rawToken.split("-");
  if (parts.length < 3) return null;
  if (parts[0] !== "token") return null;

  const userId = Number(parts[1]);
  if (!Number.isFinite(userId) || userId <= 0) return null;

  const ts = Number(parts[2]);
  if (!Number.isFinite(ts) || ts <= 0) return null;

  // Expira si tiene más de 10 min
  const MAX_AGE_MS = 10 * 60 * 1000;
  if (Date.now() - ts > MAX_AGE_MS) return null;

  return { userId, ts };
}

/**
 * Resuelve el userId desde el rawToken.
 * Intenta JWT primero; si falla, usa el formato legacy.
 * BUG-002, RIESGO-001, REC-01: compatibilidad hacia atrás garantizada.
 */
function resolveUserId(rawToken) {
  // Intentar JWT primero
  try {
    const decoded = jwt.verify(rawToken, JWT_SECRET);
    const userId = Number(decoded?.id);
    if (Number.isFinite(userId) && userId > 0) return userId;
  } catch {
    // No es JWT válido — continúa con formato legacy
  }

  // Fallback: formato legacy token-{userId}-{timestamp}
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
//  HEALTH CHECK — REC-008: estado de BD incluido
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
      console.error("[MIGRATION] reconducciones error:", e);
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
      console.error("[MIGRATION] reconduccion_oficios error:", e);
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
      console.error("[MIGRATION] reconducciones_firmas error:", e);
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
      console.error("[MIGRATION] firmas_suf_comp_dev error:", e);
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
      console.error("[MIGRATION] fn_saldo_disponible_partida error:", e);
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
      console.error("[MIGRATION] normalizacion_db error:", e);
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
      console.error("[MIGRATION] expedientes_entrega_fks error:", e);
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
      console.error("[MIGRATION] folio_sequences error:", e);
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
  const shutdown = async (signal) => {
    console.log(`[SHUTDOWN] ${signal} recibido — cerrando servidor...`);
    server.close(async () => {
      try { await pool.end(); } catch {}
      console.log("[SHUTDOWN] Conexiones cerradas. Proceso terminado.");
      process.exit(0);
    });
    // Forzar salida si tarda más de 10 s
    setTimeout(() => { console.error("[SHUTDOWN] Timeout forzado."); process.exit(1); }, 10_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
})();

