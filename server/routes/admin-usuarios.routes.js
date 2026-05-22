/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: API — Administración de Usuarios
 *  Archivo: admin-usuarios.routes.js
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
import { Router } from "express";
import bcrypt from "bcryptjs";
import { query, getClient } from "../db.js";

const router = Router();

/**
 * H-4 (Fase 3B): se eliminó la lectura de `x-user-id` (header spoofable).
 * Ahora SOLO se confía en `req.user.id`, que es inyectado por `authRequired`
 * tras validar el token contra la BD.
 */
function getActorId(req) {
  const id = Number(req.user?.id || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

const SALT_ROUNDS = 12;

// =====================================================
//  H-5 (Fase 3B): VALIDACIÓN DE INPUTS PARA USUARIOS
// =====================================================

const ALLOWED_ROLES = ["GOD", "ADMIN", "AREA"];

/**
 * Valida el cuerpo de creación/edición de usuarios.
 * - nombre_completo: requerido, 1..120 caracteres.
 * - usuario: requerido, 1..64 caracteres.
 * - correo (opcional): si viene, debe ser string <=120 con formato email.
 * - password (opcional en PUT, requerido en POST): si viene, 1..200 caracteres.
 * - roles (opcional): array de strings dentro de ALLOWED_ROLES.
 * - id_dgeneral / id_dauxiliar (opcionales): enteros >= 0 o null.
 * Devuelve un array de errores (vacío si todo es válido).
 */
function validateUsuarioInput(body, { passwordRequired = false } = {}) {
  const errors = [];
  const isStr = (v, max) =>
    typeof v === "string" && v.length > 0 && v.length <= max;

  if (!isStr(body.nombre_completo, 120)) {
    errors.push("nombre_completo inválido (string 1..120)");
  }
  if (!isStr(body.usuario, 64)) {
    errors.push("usuario inválido (string 1..64)");
  }

  if (body.correo !== undefined && body.correo !== null && body.correo !== "") {
    if (
      typeof body.correo !== "string" ||
      body.correo.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.correo)
    ) {
      errors.push("correo inválido");
    }
  }

  if (passwordRequired) {
    if (!isStr(body.password, 200)) {
      errors.push("password inválido (string 1..200)");
    }
  } else if (body.password !== undefined && body.password !== null && body.password !== "") {
    if (!isStr(body.password, 200)) {
      errors.push("password inválido (string 1..200)");
    }
  }

  if (body.roles !== undefined && body.roles !== null) {
    if (!Array.isArray(body.roles)) {
      errors.push("roles debe ser array");
    } else {
      for (const r of body.roles) {
        if (typeof r !== "string" || !ALLOWED_ROLES.includes(r.toUpperCase())) {
          errors.push(`rol inválido: ${String(r)}`);
        }
      }
    }
  }

  const checkOptInt = (k) => {
    const v = body[k];
    if (v === undefined || v === null || v === "") return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) errors.push(`${k} inválido (entero >=0)`);
  };
  checkOptInt("id_dgeneral");
  checkOptInt("id_dauxiliar");

  if (body.activo !== undefined && typeof body.activo !== "boolean") {
    // tolerante: aceptar 0/1, "true"/"false"
    const s = String(body.activo).toLowerCase();
    if (!["true", "false", "1", "0"].includes(s)) {
      errors.push("activo inválido (boolean)");
    }
  }

  return errors;
}

/**
 * Defensa contra prototype pollution: rechaza el request si el body
 * trae llaves __proto__, constructor o prototype al nivel raíz.
 * Express ya parsea JSON con Object.create(null) en versiones recientes,
 * pero esto añade defensa en profundidad. El middleware extrae solo
 * los campos esperados antes de procesar.
 */
function hasUnsafeKeys(obj) {
  if (!obj || typeof obj !== "object") return false;
  const bad = ["__proto__", "constructor", "prototype"];
  for (const k of bad) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return true;
  }
  return false;
}

// =======================
// GET
// =======================
router.get("/", async (_req, res) => {
  try {
    const sql = `
      SELECT
        u.id,
        u.nombre_completo,
        u.usuario,
        u.correo,
        u.activo,
        u.fecha_creacion,

        u.id_dgeneral,
        dg.clave AS dgeneral_clave,
        dg.dependencia AS dgeneral_nombre,

        u.id_dauxiliar,
        da.clave AS dauxiliar_clave,
        da.dependencia AS dauxiliar_nombre,

        u.updated_by,
        u.updated_at,

        COALESCE(
          ARRAY_AGG(DISTINCT r.clave) FILTER (WHERE r.clave IS NOT NULL),
          '{}'::text[]
        ) AS roles

      FROM public.usuarios u
      LEFT JOIN public.dgeneral dg ON dg.id = u.id_dgeneral
      LEFT JOIN public.dauxiliar da ON da.id = u.id_dauxiliar
      LEFT JOIN public.usuario_rol ur ON ur.id_usuario = u.id
      LEFT JOIN public.roles r ON r.id = ur.id_rol

      GROUP BY
        u.id,
        dg.clave,
        dg.dependencia,
        da.clave,
        da.dependencia

      ORDER BY u.id;
    `;

    const result = await query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/admin/usuarios error:", err);
    res.status(500).json({ error: "Error obteniendo usuarios" });
  }
});

// =======================
// POST (crear)
// =======================
router.post("/", async (req, res) => {
  // H-5: rechazar prototype pollution antes de extraer campos
  if (hasUnsafeKeys(req.body)) {
    return res.status(400).json({
      error: "Cuerpo de petición contiene claves no permitidas",
      trace_id: req.cpTraceId,
    });
  }

  // H-5: extraer solo los campos esperados — nunca spread del body completo
  const {
    nombre_completo,
    usuario,
    correo,
    password,
    id_dgeneral,
    id_dauxiliar,
    activo = true,
    roles = [],
  } = req.body || {};

  // H-5: validación estricta (longitud, formato, allowlist)
  const errs = validateUsuarioInput(
    { nombre_completo, usuario, correo, password, id_dgeneral, id_dauxiliar, activo, roles },
    { passwordRequired: true }
  );
  if (errs.length > 0) {
    return res.status(400).json({
      error: "Validación fallida",
      detalles: errs,
      trace_id: req.cpTraceId,
    });
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const actorId = getActorId(req);

    // ✅ bcrypt hash
    const hash = await bcrypt.hash(String(password), SALT_ROUNDS);

    const ins = await client.query(
      `
      INSERT INTO usuarios (
        nombre_completo,
        usuario,
        correo,
        password,
        id_dgeneral,
        id_dauxiliar,
        activo,
        updated_by,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      RETURNING id;
      `,
      [
        nombre_completo,
        usuario,
        correo || null,
        hash,
        id_dgeneral || null,
        id_dauxiliar || null,
        !!activo,
        actorId,
      ]
    );

    const newId = ins.rows[0].id;

    // Roles
    await client.query("DELETE FROM usuario_rol WHERE id_usuario = $1", [newId]);

    if (Array.isArray(roles) && roles.length > 0) {
      for (const rClave of roles) {
        const r = String(rClave || "").trim().toUpperCase();
        if (!r) continue;

        const rolRow = await client.query(
          "SELECT id FROM roles WHERE UPPER(clave) = $1 LIMIT 1",
          [r]
        );

        if (rolRow.rowCount > 0) {
          const idRol = rolRow.rows[0].id;
          await client.query(
            `INSERT INTO usuario_rol (id_usuario, id_rol)
             VALUES ($1,$2)
             ON CONFLICT DO NOTHING;`,
            [newId, idRol]
          );
        }
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true, id: newId });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/usuarios ERROR:", e);

    if (e.code === "23505") {
      return res
        .status(400)
        .json({ error: "Usuario o correo ya existen en el sistema" });
    }
    res.status(500).json({ error: "Error creando usuario" });
  } finally {
    client.release();
  }
});

// =======================
// PUT (actualizar)
// =======================
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  // H-5: rechazar prototype pollution antes de extraer campos
  if (hasUnsafeKeys(req.body)) {
    return res.status(400).json({
      error: "Cuerpo de petición contiene claves no permitidas",
      trace_id: req.cpTraceId,
    });
  }

  // H-5: extraer solo los campos esperados — nunca spread del body completo
  const {
    nombre_completo,
    usuario,
    correo,
    password,
    id_dgeneral,
    id_dauxiliar,
    activo = true,
    roles = [],
  } = req.body || {};

  // H-5: validación estricta. Password es opcional en PUT.
  const errs = validateUsuarioInput(
    { nombre_completo, usuario, correo, password, id_dgeneral, id_dauxiliar, activo, roles },
    { passwordRequired: false }
  );
  if (errs.length > 0) {
    return res.status(400).json({
      error: "Validación fallida",
      detalles: errs,
      trace_id: req.cpTraceId,
    });
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const actorId = getActorId(req);

    // ✅ si viene password, lo hasheamos
    if (password && String(password).trim().length > 0) {
      const hash = await bcrypt.hash(String(password), SALT_ROUNDS);

      await client.query(
        `
        UPDATE usuarios
           SET nombre_completo = $1,
               usuario         = $2,
               correo          = $3,
               password        = $4,
               id_dgeneral     = $5,
               id_dauxiliar    = $6,
               activo          = $7,
               updated_by      = $8,
               updated_at      = NOW()
         WHERE id = $9;
        `,
        [
          nombre_completo,
          usuario,
          correo || null,
          hash,
          id_dgeneral || null,
          id_dauxiliar || null,
          !!activo,
          actorId,
          id,
        ]
      );
    } else {
      await client.query(
        `
        UPDATE usuarios
           SET nombre_completo = $1,
               usuario         = $2,
               correo          = $3,
               id_dgeneral     = $4,
               id_dauxiliar    = $5,
               activo          = $6,
               updated_by      = $7,
               updated_at      = NOW()
         WHERE id = $8;
        `,
        [
          nombre_completo,
          usuario,
          correo || null,
          id_dgeneral || null,
          id_dauxiliar || null,
          !!activo,
          actorId,
          id,
        ]
      );
    }

    // Roles
    await client.query("DELETE FROM usuario_rol WHERE id_usuario = $1", [id]);

    if (Array.isArray(roles) && roles.length > 0) {
      for (const rClave of roles) {
        const r = String(rClave || "").trim().toUpperCase();
        if (!r) continue;

        const rolRow = await client.query(
          "SELECT id FROM roles WHERE UPPER(clave) = $1 LIMIT 1",
          [r]
        );

        if (rolRow.rowCount > 0) {
          const idRol = rolRow.rows[0].id;
          await client.query(
            `INSERT INTO usuario_rol (id_usuario, id_rol)
             VALUES ($1,$2)
             ON CONFLICT DO NOTHING;`,
            [id, idRol]
          );
        }
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("PUT /api/admin/usuarios/:id ERROR:", e);

    if (e.code === "23505") {
      return res
        .status(400)
        .json({ error: "Usuario o correo ya existen en el sistema" });
    }
    res.status(500).json({ error: "Error actualizando usuario" });
  } finally {
    client.release();
  }
});

// =======================
// DELETE
// =======================
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const actorId = getActorId(req);

    await client.query(
      `UPDATE public.usuarios
          SET updated_by = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [actorId, id]
    );

    await client.query("DELETE FROM usuario_rol WHERE id_usuario = $1", [id]);
    await client.query("DELETE FROM usuarios WHERE id = $1", [id]);

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("DELETE /api/admin/usuarios/:id ERROR:", e);
    res.status(500).json({ error: "Error eliminando usuario" });
  } finally {
    client.release();
  }
});


export default router;
