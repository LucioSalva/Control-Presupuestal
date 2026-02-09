// =====================================================
//  IMPORTS Y CONFIG
// =====================================================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { query } from "./db.js";
import catalogosRoutes from "./routes/catalogos.routes.js";
import adminUsuariosRouter from "./routes/admin-usuarios.routes.js";
import authRouter from "./routes/auth.routes.js";
import suficienciasRouter from "./routes/suficiencias.routes.js";
import presupuestoRouter from "./routes/presupuesto.routes.js";
import comprometidoRouter from "./routes/comprometido.routes.js";
import devengadoRouter from "./routes/devengado.routes.js";
import metasRouter from "./routes/metas.routes.js";
import partidasRouter from "./routes/partidas.routes.js";
import { seedPartidasPermitidas } from "./utils/seed_partidas_permitidas.js";


dotenv.config();

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
            "script-src": ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'", "'unsafe-eval'"],
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

// 3) CORS: NO uses origin:true en producción.
// Para local dejamos whitelist (ajusta si usas otro puerto)
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:5502",
  "http://127.0.0.1:5502",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

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

// =====================================================
//  STATIC (FRONTEND)
// =====================================================
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => {
  return res.sendFile(path.join(__dirname, "public", "login.html"));
});

// =====================================================
//  AUTH (token de mentiritas) + roles reales en BD
// =====================================================
function parseFakeToken(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const token = m[1].trim(); // token-<id>-<timestamp>
  const parts = token.split("-");
  if (parts.length < 3) return null;
  if (parts[0] !== "token") return null;

  const userId = Number(parts[1]);
  if (!Number.isFinite(userId) || userId <= 0) return null;

  const ts = Number(parts[2]); // timestamp del token
  if (!Number.isFinite(ts) || ts <= 0) return null;

  // ✅ expira si tiene más de 10 min
  const MAX_AGE_MS = 10 * 60 * 1000;
  if (Date.now() - ts > MAX_AGE_MS) return null;

  return { token, userId, ts };
}

async function authRequired(req, res, next) {
  try {
    const parsed = parseFakeToken(req);
    if (!parsed) return res.status(401).json({ error: "Token requerido" });

    const { userId } = parsed;

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

app.use("/api/suficiencias", authRequired, suficienciasRouter);
app.use("/api/comprometido", authRequired, comprometidoRouter);
app.use("/api/devengado", authRequired, devengadoRouter);

app.use("/api", presupuestoRouter);

app.use("/api/catalogos/partidas", authRequired, blockPartidasWrite, partidasRouter);
app.use("/api/catalogos/metas", authRequired, metasRouter);
app.use("/api/catalogos", authRequired, catalogosRoutes);


// =====================================================
//  HEALTH
// =====================================================
app.get("/api/health", (_req, res) => res.json({ ok: true }));

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
//  ARRANQUE
// =====================================================
(async () => {
  try {
    if (process.env.SEED === "true") {
      await seedPartidasPermitidas();
    }
  } catch (e) {
    console.error("[SEED] Error:", e);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log("API escuchando en http://localhost:" + PORT);
  });
})();

