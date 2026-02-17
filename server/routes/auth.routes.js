// server/routes/auth.routes.js
import express from "express";
import bcrypt from "bcryptjs";
import { query, getClient } from "../db.js";

const router = express.Router();

function isBcryptHash(str) {
  return typeof str === "string" && /^\$2[aby]?\$\d{2}\$/.test(str);
}

router.post("/login", async (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
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
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const user = result.rows[0];

    if (!user.activo) {
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
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    // token de mentiritas (tu mismo sistema)
    const token = `token-${user.id}-${Date.now()}`;

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
    return res.status(500).json({ error: "Error interno" });
  }
});

export default router;
