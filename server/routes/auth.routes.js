// server/routes/auth.routes.js
import express from "express";
import bcrypt from "bcryptjs";
import { query, getClient } from "../db.js";
import { logAuditEvent } from "../utils/helpers.js";

const router = express.Router();

function isBcryptHash(str) {
  return typeof str === "string" && /^\$2[aby]?\$\d{2}\$/.test(str);
}

function getRequestIp(req) {
  const xf = req.headers["x-forwarded-for"];
  const s = Array.isArray(xf) ? xf[0] : String(xf || "");
  const first = s.split(",")[0]?.trim();
  return first || req.ip || null;
}

function parseFakeToken(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  const parts = token.split("-");
  if (parts.length < 3) return null;
  if (parts[0] !== "token") return null;
  const userId = Number(parts[1]);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const ts = Number(parts[2]);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const MAX_AGE_MS = 10 * 60 * 1000;
  if (Date.now() - ts > MAX_AGE_MS) return null;
  return { token, userId, ts };
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

    // token de mentiritas (tu mismo sistema)
    const token = `token-${user.id}-${Date.now()}`;

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
    const parsed = parseFakeToken(req);
    const ip = getRequestIp(req);

    if (!parsed) {
      await logAuditEvent(req, {
        tipo: "AUTH_LOGOUT",
        entidad: "USUARIO",
        entidad_id: null,
        estado: "FALLO",
        detalles: { ip, auth_method: "TOKEN_FAKE", ok: false, motivo: "TOKEN_INVALIDO_O_EXPIRADO" },
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
        detalles: { ip, auth_method: "TOKEN_FAKE", ok: false, motivo: "USUARIO_NO_EXISTE" },
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
        auth_method: "TOKEN_FAKE",
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
        detalles: { ip: getRequestIp(req), auth_method: "TOKEN_FAKE", ok: false, motivo: "ERROR_INTERNO" },
      });
    } catch {}
    return res.json({ ok: true });
  }
});

export default router;
