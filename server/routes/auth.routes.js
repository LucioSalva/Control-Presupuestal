/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: API — Autenticación
 *  Archivo: auth.routes.js
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
// server/routes/auth.routes.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query, getClient } from "../db.js";
import { logAuditEvent } from "../utils/helpers.js";

const router = express.Router();

// =====================================================
//  CONSTANTES JWT
// =====================================================
const JWT_ISSUER = "control-presupuestal";
const JWT_AUDIENCE = "cp-frontend";
const JWT_EXPIRES_IN = "10m";

function isBcryptHash(str) {
  return typeof str === "string" && /^\$2[aby]?\$\d{2}\$/.test(str);
}

function getRequestIp(req) {
  const xf = req.headers["x-forwarded-for"];
  const s = Array.isArray(xf) ? xf[0] : String(xf || "");
  const first = s.split(",")[0]?.trim();
  return first || req.ip || null;
}

/**
 * Verifica un JWT firmado (issuer/audience estrictos).
 * Retorna { userId } si el token es válido y vigente, null si no.
 * Solo se acepta el formato JWT — el formato legacy "token-{id}-{ts}"
 * fue eliminado por hardening (C-6).
 */
function verifyAuthToken(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const rawToken = m[1].trim();
  if (!rawToken) return null;

  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  try {
    const decoded = jwt.verify(rawToken, secret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const userId = Number(decoded?.sub);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    return { token: rawToken, userId };
  } catch {
    return null;
  }
}

router.post("/login", async (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    await logAuditEvent(req, {
      tipo: "AUTH_LOGIN",
      entidad: "USUARIO",
      entidad_id: usuario ? String(usuario).trim() : null,
      estado: "FALLO",
      detalles: {
        ip: getRequestIp(req),
        auth_method: "PASSWORD",
        ok: false,
        motivo: "FALTAN_CREDENCIALES",
      },
    });
    return res.status(400).json({ error: "Usuario y contraseña son requeridos" });
  }

  try {
    const sql = `
      SELECT u.id,
             u.nombre_completo,
             u.usuario,
             u.correo,
             u.password,
             u.id_dgeneral,
             u.id_dauxiliar,
             u.activo,
             dg.clave AS dgeneral_clave,
             dg.dependencia AS dgeneral_nombre,
             da.clave AS dauxiliar_clave,
             da.dependencia AS dauxiliar_nombre,
             ARRAY(
               SELECT r.clave
               FROM usuario_rol ur
               JOIN roles r ON r.id = ur.id_rol
               WHERE ur.id_usuario = u.id
             ) AS roles
      FROM usuarios u
      LEFT JOIN dgeneral dg ON dg.id = u.id_dgeneral
      LEFT JOIN dauxiliar da ON da.id = u.id_dauxiliar
      WHERE LOWER(u.usuario) = LOWER($1)
      LIMIT 1;
    `;

    const result = await query(sql, [String(usuario).trim()]);

    if (result.rowCount === 0) {
      await logAuditEvent(req, {
        tipo: "AUTH_LOGIN",
        entidad: "USUARIO",
        entidad_id: String(usuario).trim(),
        estado: "FALLO",
        detalles: {
          ip: getRequestIp(req),
          auth_method: "PASSWORD",
          ok: false,
          motivo: "USUARIO_NO_EXISTE",
        },
      });
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const user = result.rows[0];

    if (!user.activo) {
      req.user = { id: user.id, id_dgeneral: user.id_dgeneral, id_dauxiliar: user.id_dauxiliar, roles: [] };
      await logAuditEvent(req, {
        tipo: "AUTH_LOGIN",
        entidad: "USUARIO",
        entidad_id: String(user.id),
        estado: "FALLO",
        detalles: {
          ip: getRequestIp(req),
          auth_method: "PASSWORD",
          ok: false,
          motivo: "USUARIO_INACTIVO",
          usuario: String(user.usuario || "").trim(),
        },
      });
      return res.status(403).json({ error: "Usuario inactivo" });
    }

    const stored = user.password || "";
    let ok = false;

    // ✅ Caso 1: password ya es bcrypt
    if (isBcryptHash(stored)) {
      ok = await bcrypt.compare(password, stored);
    } else {
      // ✅ Caso 2: password está plano (legacy)
      ok = stored === password;

      // 🔁 Si fue correcto, lo migramos a bcrypt automáticamente
      if (ok) {
        const client = await getClient();
        try {
          await client.query("BEGIN");
          const hash = await bcrypt.hash(password, 10);
          await client.query(
            "UPDATE usuarios SET password = $1, updated_at = NOW() WHERE id = $2",
            [hash, user.id]
          );
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          console.warn("[LOGIN] No se pudo migrar password a bcrypt:", e);
        } finally {
          client.release();
        }
      }
    }

    if (!ok) {
      req.user = { id: user.id, id_dgeneral: user.id_dgeneral, id_dauxiliar: user.id_dauxiliar, roles: [] };
      await logAuditEvent(req, {
        tipo: "AUTH_LOGIN",
        entidad: "USUARIO",
        entidad_id: String(user.id),
        estado: "FALLO",
        detalles: {
          ip: getRequestIp(req),
          auth_method: "PASSWORD",
          ok: false,
          motivo: "PASSWORD_INCORRECTO",
          usuario: String(user.usuario || "").trim(),
        },
      });
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    // ── Emisión de JWT firmado (C-6) ──────────────────────────
    // El token legacy `token-{id}-{ts}` fue eliminado por completo.
    // El frontend sigue leyendo el campo `token` del response sin
    // necesidad de cambios (es opaco para el cliente).
    const rolesArray = Array.isArray(user.roles)
      ? user.roles.map((r) => String(r).trim().toUpperCase()).filter(Boolean)
      : [];

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      // Defensa en profundidad. validateEnv() debió haber abortado el
      // arranque, pero si llegamos aquí en dev sin secreto, fallamos.
      console.error("[LOGIN] JWT_SECRET no configurado — no se puede emitir token.");
      return res.status(500).json({ error: "Error interno de autenticación" });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        roles: rolesArray,
      },
      jwtSecret,
      {
        algorithm: "HS256",
        expiresIn: JWT_EXPIRES_IN,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }
    );

    req.user = { id: user.id, id_dgeneral: user.id_dgeneral, id_dauxiliar: user.id_dauxiliar, roles: user.roles || [] };
    await logAuditEvent(req, {
      tipo: "AUTH_LOGIN",
      entidad: "USUARIO",
      entidad_id: String(user.id),
      estado: "EXITO",
      detalles: {
        ip: getRequestIp(req),
        auth_method: "PASSWORD",
        ok: true,
        usuario: String(user.usuario || "").trim(),
      },
    });

    return res.json({
      token,
      usuario: {
        id: user.id,
        nombre_completo: user.nombre_completo,
        usuario: user.usuario,
        correo: user.correo,
        roles: user.roles,
        id_dgeneral: user.id_dgeneral,
        id_dauxiliar: user.id_dauxiliar,
        dgeneral_clave: user.dgeneral_clave,
        dgeneral_nombre: user.dgeneral_nombre,
        dauxiliar_clave: user.dauxiliar_clave,
        dauxiliar_nombre: user.dauxiliar_nombre,
      },
    });
  } catch (err) {
    console.error("Error en /api/login:", err);
    await logAuditEvent(req, {
      tipo: "AUTH_LOGIN",
      entidad: "USUARIO",
      entidad_id: usuario ? String(usuario).trim() : null,
      estado: "FALLO",
      detalles: {
        ip: getRequestIp(req),
        auth_method: "PASSWORD",
        ok: false,
        motivo: "ERROR_INTERNO",
      },
    });
    return res.status(500).json({ error: "Error interno" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const parsed = verifyAuthToken(req);
    const ip = getRequestIp(req);

    if (!parsed) {
      await logAuditEvent(req, {
        tipo: "AUTH_LOGOUT",
        entidad: "USUARIO",
        entidad_id: null,
        estado: "FALLO",
        detalles: { ip, auth_method: "JWT", ok: false, motivo: "TOKEN_INVALIDO_O_EXPIRADO" },
      });
      return res.json({ ok: true });
    }

    const r = await query(
      `
      SELECT id, usuario, id_dgeneral, id_dauxiliar, activo
      FROM public.usuarios
      WHERE id = $1
      LIMIT 1
      `,
      [parsed.userId]
    );

    if (!r.rowCount) {
      await logAuditEvent(req, {
        tipo: "AUTH_LOGOUT",
        entidad: "USUARIO",
        entidad_id: String(parsed.userId),
        estado: "FALLO",
        detalles: { ip, auth_method: "JWT", ok: false, motivo: "USUARIO_NO_EXISTE" },
      });
      return res.json({ ok: true });
    }

    const u = r.rows[0];
    req.user = { id: u.id, id_dgeneral: u.id_dgeneral, id_dauxiliar: u.id_dauxiliar, roles: [] };
    await logAuditEvent(req, {
      tipo: "AUTH_LOGOUT",
      entidad: "USUARIO",
      entidad_id: String(u.id),
      estado: u.activo ? "EXITO" : "FALLO",
      detalles: {
        ip,
        auth_method: "JWT",
        ok: !!u.activo,
        usuario: String(u.usuario || "").trim(),
        motivo: u.activo ? null : "USUARIO_INACTIVO",
      },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error en /api/logout:", err);
    try {
      await logAuditEvent(req, {
        tipo: "AUTH_LOGOUT",
        entidad: "USUARIO",
        entidad_id: null,
        estado: "FALLO",
        detalles: { ip: getRequestIp(req), auth_method: "JWT", ok: false, motivo: "ERROR_INTERNO" },
      });
    } catch {}
    return res.json({ ok: true });
  }
});

export default router;
