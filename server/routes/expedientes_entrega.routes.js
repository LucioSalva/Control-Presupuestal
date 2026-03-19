/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: API — Expedientes de Entrega
 *  Archivo: expedientes_entrega.routes.js
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
import express from "express";
import { query, getClient } from "../db.js";
import { getActorId, logAuditEvent } from "../utils/helpers.js";

const router = express.Router();

function getRole(req) {
  const roles = (req.user?.roles || []).map((r) => String(r).toUpperCase());
  if (roles.includes("GOD")) return "GOD";
  if (roles.includes("ADMIN")) return "ADMIN";
  return "AREA";
}

function normalizeTipo(v) {
  const t = String(v || "").trim().toUpperCase();
  if (t === "SUF" || t === "COMP" || t === "DEV") return t;
  return "";
}

function toNullIfEmpty(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : v;
}

function toNumOrNull(v) {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toNumOrZero(v) {
  const s = String(v ?? "").trim();
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

function normalizeEstatus(v) {
  const s = String(v || "").trim().toUpperCase();
  return s === "CANCELADO" ? "CANCELADO" : "ENTREGADO";
}

function parseFolioString(folio) {
  const s = String(folio || "").trim().toUpperCase();
  const m = s.match(/^(\d{2})-(\d+)(?:\s+D-(\d{2}))?$/);
  if (!m) return null;
  return {
    mes: m[1],
    consecutivo: Number(m[2]),
    base: `${m[1]}-${m[2]}`,
    diferido: m[3] ? Number(m[3]) : null,
  };
}

function validateFolioForMes(folio, mes) {
  const parsed = parseFolioString(folio);
  if (!parsed) return false;
  const mm = String(mes || "").padStart(2, "0");
  return parsed.mes === mm;
}

function getSearchRegex(tipo) {
  if (tipo === "SUF") return /^ECA-\d{4}-\d{2}-SP-\d{4}$/;
  if (tipo === "COMP") return /^ECA-\d{4}-\d{2}-CP-\d{4}$/;
  if (tipo === "DEV") return /^ECA-\d{6}-DG-\d{4}$/;
  return null;
}

router.get("/next-folio", async (req, res) => {
  try {
    const anio = Number(req.query.anio || 0);
    const mes = Number(req.query.mes || 0);
    if (!Number.isFinite(anio) || anio <= 0) {
      return res.status(400).json({ error: "Año inválido" });
    }
    if (!Number.isFinite(mes) || mes < 1 || mes > 12) {
      return res.status(400).json({ error: "Mes inválido" });
    }
    const baseQuery = String(req.query.base || "").trim().toUpperCase();
    const mm = String(mes).padStart(2, "0");

    const r = await query(
      "SELECT folio FROM expedientes_entrega WHERE anio = $1 AND mes = $2",
      [anio, mes]
    );

    let maxConsec = 0;
    let maxDiferido = 0;

    for (const row of r.rows || []) {
      const parsed = parseFolioString(row.folio);
      if (!parsed || parsed.mes !== mm) continue;
      if (Number.isFinite(parsed.consecutivo) && parsed.consecutivo > maxConsec) {
        maxConsec = parsed.consecutivo;
      }
      if (baseQuery && parsed.base === baseQuery && parsed.diferido != null) {
        if (parsed.diferido > maxDiferido) maxDiferido = parsed.diferido;
      }
    }

    const nextConsecutivo = maxConsec + 1;
    const base = `${mm}-${String(nextConsecutivo).padStart(2, "0")}`;
    const resp = { base, next_consecutivo: nextConsecutivo };
    if (baseQuery) {
      resp.next_diferido = String(maxDiferido + 1).padStart(2, "0");
    }
    return res.json(resp);
  } catch (err) {
    console.error("[GET expedientes-entrega/next-folio] error:", err);
    return res.status(500).json({ error: "Error generando folio" });
  }
});

router.get("/origen", async (req, res) => {
  try {
    const tipo = normalizeTipo(req.query.tipo);
    if (!tipo) {
      return res.status(400).json({ error: "Tipo inválido (SUF|COMP|DEV)" });
    }

    const search = String(req.query.search || "").trim();
    const folio = String(req.query.folio || "").trim();
    const role = getRole(req);
    const where = [];
    const params = [];
    let i = 1;

    if (search) {
      const rx = getSearchRegex(tipo);
      if (rx && !rx.test(search)) {
        return res.status(400).json({
          error:
            tipo === "SUF"
              ? "Formato inválido. Usa ECA-AAAA-MM-SP-0001"
              : tipo === "COMP"
                ? "Formato inválido. Usa ECA-AAAA-MM-CP-0001"
                : "Formato inválido. Usa ECA-AAAAMM-DG-0001",
        });
      }
    }

    let sql = "";
    let folioColumn = "";
    let alias = "";

    if (tipo === "SUF") {
      alias = "s";
      folioColumn = "no_suficiencia";
      sql = `
        SELECT
          s.id AS id_origen,
          s.id AS id_suficiencia,
          NULL::bigint AS id_comprometido,
          NULL::bigint AS id_devengado,
          s.no_suficiencia AS folio,
          s.id_dgeneral,
          s.id_dauxiliar,
          COALESCE(sd.clave, '') AS partida_clave,
          s.dependencia,
          COALESCE(s.meta, s.clave_programatica, s.dependencia) AS concepto,
          s.total AS importe,
          'SUF' AS tipo
        FROM suficiencias s
        LEFT JOIN LATERAL (
          SELECT clave
          FROM suficiencia_detalle
          WHERE id_suficiencia = s.id
          ORDER BY renglon ASC
          LIMIT 1
        ) sd ON true
      `;
    }

    if (tipo === "COMP") {
      alias = "c";
      folioColumn = "no_comprometido";
      sql = `
        SELECT
          c.id AS id_origen,
          c.id_suficiencia AS id_suficiencia,
          c.id AS id_comprometido,
          NULL::bigint AS id_devengado,
          c.no_comprometido AS folio,
          c.id_dgeneral,
          c.id_dauxiliar,
          COALESCE(cd.clave, '') AS partida_clave,
          c.dependencia,
          COALESCE(c.meta, c.clave_programatica, c.dependencia) AS concepto,
          c.total AS importe,
          'COMP' AS tipo
        FROM comprometidos c
        LEFT JOIN LATERAL (
          SELECT clave
          FROM comprometido_detalle
          WHERE id_comprometido = c.id
          ORDER BY renglon ASC
          LIMIT 1
        ) cd ON true
      `;
    }

    if (tipo === "DEV") {
      alias = "d";
      folioColumn = "no_devengado";
      sql = `
        SELECT
          d.id AS id_origen,
          d.id_suficiencia AS id_suficiencia,
          d.id_comprometido AS id_comprometido,
          d.id AS id_devengado,
          d.no_devengado AS folio,
          d.id_dgeneral,
          d.id_dauxiliar,
          COALESCE(dd.clave, '') AS partida_clave,
          d.dependencia,
          COALESCE(d.meta, d.clave_programatica, d.dependencia) AS concepto,
          d.total AS importe,
          'DEV' AS tipo
        FROM devengados d
        LEFT JOIN LATERAL (
          SELECT clave
          FROM devengado_detalle
          WHERE id_devengado = d.id
          ORDER BY renglon ASC
          LIMIT 1
        ) dd ON true
      `;
    }

    if (search) {
      where.push(`${alias}.${folioColumn} = $${i++}`);
      params.push(search);
    }

    if (role === "AREA") {
      if (req.user?.id_dgeneral != null) {
        where.push(`${alias}.id_dgeneral = $${i++}`);
        params.push(req.user.id_dgeneral);
      }
      if (req.user?.id_dauxiliar != null) {
        where.push(`${alias}.id_dauxiliar = $${i++}`);
        params.push(req.user.id_dauxiliar);
      }
    }

    if (where.length) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }

    sql += " ORDER BY id_origen DESC LIMIT 50";

    const r = await query(sql, params);
    return res.json({ ok: true, rows: r.rows });
  } catch (err) {
    console.error("[GET expedientes-entrega origen] error:", err);
    return res.status(500).json({ error: "Error consultando origen", db: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const anio = Number(req.query.anio || 0);
    const mes = Number(req.query.mes || 0);
    const search = String(req.query.search || "").trim();
    const folio = String(req.query.folio || "").trim();
    const role = getRole(req);

    const where = [];
    const params = [];
    let i = 1;

    if (Number.isFinite(anio) && anio > 0) {
      where.push(`ee.anio = $${i++}`);
      params.push(anio);
    }
    if (Number.isFinite(mes) && mes > 0) {
      where.push(`ee.mes = $${i++}`);
      params.push(mes);
    }
    if (folio) {
      where.push(`ee.folio ILIKE $${i++}`);
      params.push(folio);
    }
    if (search) {
      where.push(
        `(
          ee.folio ILIKE $${i}
          OR COALESCE(NULLIF(ee.dependencia, ''), s.dependencia, c.dependencia, d.dependencia) ILIKE $${i}
          OR COALESCE(
            NULLIF(ee.concepto, ''),
            s.meta, s.clave_programatica, s.dependencia,
            c.meta, c.clave_programatica, c.dependencia,
            d.meta, d.clave_programatica, d.dependencia
          ) ILIKE $${i}
        )`
      );
      params.push(`%${search}%`);
      i++;
    }

    if (role === "AREA") {
      if (req.user?.id_dgeneral != null) {
        where.push(
          `COALESCE(ee.id_dgeneral, s.id_dgeneral, c.id_dgeneral, d.id_dgeneral) = $${i++}`
        );
        params.push(req.user.id_dgeneral);
      }
      if (req.user?.id_dauxiliar != null) {
        where.push(
          `(COALESCE(ee.id_dauxiliar, s.id_dauxiliar, c.id_dauxiliar, d.id_dauxiliar) = $${i++}
            OR COALESCE(ee.id_dauxiliar, s.id_dauxiliar, c.id_dauxiliar, d.id_dauxiliar) IS NULL)`
        );
        params.push(req.user.id_dauxiliar);
      }
    }

    let sql = `
      SELECT
        ee.id,
        ee.anio,
        ee.mes,
        ee.id_suficiencia,
        ee.id_comprometido,
        ee.id_devengado,
        ee.id_dgeneral,
        ee.id_dauxiliar,
        ee.partida_clave,
        ee.folio,
        COALESCE(NULLIF(ee.dependencia, ''), s.dependencia, c.dependencia, d.dependencia) AS dependencia,
        COALESCE(
          NULLIF(ee.concepto, ''),
          s.meta, s.clave_programatica, s.dependencia,
          c.meta, c.clave_programatica, c.dependencia,
          d.meta, d.clave_programatica, d.dependencia
        ) AS concepto,
        ee.importe,
        ee.entrego_comprometido,
        ee.entrego_devengado,
        ee.fecha_entrega_tesoreria,
        ee.fecha_recibido_presupuesto,
        ee.estatus,
        ee.observaciones,
        ee.creado_por,
        ee.creado_en,
        ee.actualizado_en
      FROM expedientes_entrega ee
      LEFT JOIN suficiencias s ON ee.id_suficiencia = s.id
      LEFT JOIN comprometidos c ON ee.id_comprometido = c.id
      LEFT JOIN devengados d ON ee.id_devengado = d.id
    `;

    if (where.length) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }

    sql += " ORDER BY ee.creado_en DESC, ee.id DESC LIMIT 200";

    const r = await query(sql, params);
    return res.json({ ok: true, rows: r.rows });
  } catch (err) {
    console.error("[GET expedientes-entrega] error:", err);
    return res.status(500).json({ error: "Error consultando entregas", db: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const r = await query(
      `
      SELECT
        ee.id,
        ee.anio,
        ee.mes,
        ee.id_suficiencia,
        ee.id_comprometido,
        ee.id_devengado,
        ee.id_dgeneral,
        ee.id_dauxiliar,
        ee.partida_clave,
        ee.folio,
        COALESCE(NULLIF(ee.dependencia, ''), s.dependencia, c.dependencia, d.dependencia) AS dependencia,
        COALESCE(
          NULLIF(ee.concepto, ''),
          s.meta, s.clave_programatica, s.dependencia,
          c.meta, c.clave_programatica, c.dependencia,
          d.meta, d.clave_programatica, d.dependencia
        ) AS concepto,
        ee.importe,
        ee.entrego_comprometido,
        ee.entrego_devengado,
        ee.fecha_entrega_tesoreria,
        ee.fecha_recibido_presupuesto,
        ee.estatus,
        ee.observaciones,
        ee.creado_por,
        ee.creado_en,
        ee.actualizado_en
      FROM expedientes_entrega ee
      LEFT JOIN suficiencias s ON ee.id_suficiencia = s.id
      LEFT JOIN comprometidos c ON ee.id_comprometido = c.id
      LEFT JOIN devengados d ON ee.id_devengado = d.id
      WHERE ee.id = $1
      LIMIT 1
      `,
      [id]
    );

    if (!r.rowCount) return res.status(404).json({ error: "Entrega no encontrada" });
    return res.json({ ok: true, row: r.rows[0] });
  } catch (err) {
    console.error("[GET expedientes-entrega/:id] error:", err);
    return res.status(500).json({ error: "Error consultando entrega", db: err.message });
  }
});

router.post("/", async (req, res) => {
  const client = await getClient();
  try {
    const b = req.body || {};
    const anio = Number(b.anio || 0);
    const mes = Number(b.mes || 0);

    if (!Number.isFinite(anio) || anio <= 0) {
      return res.status(400).json({ error: "Año inválido" });
    }
    if (!Number.isFinite(mes) || mes < 1 || mes > 12) {
      return res.status(400).json({ error: "Mes inválido" });
    }

    const folio = String(b.folio || "").trim();
    const dependencia = String(b.dependencia ?? "").trim();
    const concepto = String(b.concepto ?? "").trim();
    const importe = toNumOrZero(b.importe);

    if (!folio || !validateFolioForMes(folio, mes)) {
      return res.status(400).json({ error: "Folio inválido para el periodo" });
    }

    const id_suficiencia = toNumOrNull(b.id_suficiencia);
    const id_comprometido = toNumOrNull(b.id_comprometido);
    const id_devengado = toNumOrNull(b.id_devengado);

    const payload = {
      anio,
      mes,
      id_suficiencia,
      id_comprometido,
      id_devengado,
      id_dgeneral: toNumOrNull(b.id_dgeneral),
      id_dauxiliar: toNumOrNull(b.id_dauxiliar),
      partida_clave: toNullIfEmpty(b.partida_clave),
      folio,
      dependencia,
      concepto,
      importe,
      entrego_comprometido: toBool(b.entrego_comprometido),
      entrego_devengado: toBool(b.entrego_devengado),
      fecha_entrega_tesoreria: toNullIfEmpty(b.fecha_entrega_tesoreria),
      fecha_recibido_presupuesto: toNullIfEmpty(b.fecha_recibido_presupuesto),
      estatus: normalizeEstatus(b.estatus),
      observaciones: toNullIfEmpty(b.observaciones),
      creado_por: req.user?.id ?? null,
    };

    const sql = `
      INSERT INTO expedientes_entrega (
        anio,
        mes,
        id_suficiencia,
        id_comprometido,
        id_devengado,
        id_dgeneral,
        id_dauxiliar,
        partida_clave,
        folio,
        dependencia,
        concepto,
        importe,
        entrego_comprometido,
        entrego_devengado,
        fecha_entrega_tesoreria,
        fecha_recibido_presupuesto,
        estatus,
        observaciones,
        creado_por
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
      )
      RETURNING id
    `;

    const params = [
      payload.anio,
      payload.mes,
      payload.id_suficiencia,
      payload.id_comprometido,
      payload.id_devengado,
      payload.id_dgeneral,
      payload.id_dauxiliar,
      payload.partida_clave,
      payload.folio,
      payload.dependencia,
      payload.concepto,
      payload.importe,
      payload.entrego_comprometido,
      payload.entrego_devengado,
      payload.fecha_entrega_tesoreria,
      payload.fecha_recibido_presupuesto,
      payload.estatus,
      payload.observaciones,
      payload.creado_por,
    ];

    await client.query("BEGIN");
    const r = await client.query(sql, params);
    await client.query("COMMIT");

    await logAuditEvent(req, {
      tipo: "EXPEDIENTE_ENTREGA",
      entidad: "EXPEDIENTES_ENTREGA",
      entidad_id: String(r.rows[0].id),
      estado: payload.estatus || "GUARDADO",
      detalles: {
        id_expediente_entrega: r.rows[0].id,
        folio,
        anio,
        mes,
        id_suficiencia,
        id_comprometido,
        id_devengado,
        estatus: payload.estatus || null,
        actor_id: getActorId(req) || req.user?.id || null,
      },
    });

    return res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Entrega ya registrada para este folio y periodo" });
    }
    console.error("[POST expedientes-entrega] error:", err);
    return res.status(500).json({ error: "Error guardando entrega", db: err.message });
  } finally {
    client.release();
  }
});

router.patch("/:id", async (req, res) => {
  const client = await getClient();
  try {
    const id = Number(req.params.id || 0);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const b = req.body || {};
    const anio = Number(b.anio || 0);
    const mes = Number(b.mes || 0);

    if (!Number.isFinite(anio) || anio <= 0) {
      return res.status(400).json({ error: "Año inválido" });
    }
    if (!Number.isFinite(mes) || mes < 1 || mes > 12) {
      return res.status(400).json({ error: "Mes inválido" });
    }

    const folio = String(b.folio || "").trim();
    const dependencia = String(b.dependencia ?? "").trim();
    const concepto = String(b.concepto ?? "").trim();
    const importe = toNumOrZero(b.importe);

    if (!folio || !validateFolioForMes(folio, mes)) {
      return res.status(400).json({ error: "Folio inválido para el periodo" });
    }

    const id_suficiencia = toNumOrNull(b.id_suficiencia);
    const id_comprometido = toNumOrNull(b.id_comprometido);
    const id_devengado = toNumOrNull(b.id_devengado);

    const payload = [
      anio,
      mes,
      id_suficiencia,
      id_comprometido,
      id_devengado,
      toNumOrNull(b.id_dgeneral),
      toNumOrNull(b.id_dauxiliar),
      toNullIfEmpty(b.partida_clave),
      folio,
      dependencia,
      concepto,
      importe,
      toBool(b.entrego_comprometido),
      toBool(b.entrego_devengado),
      toNullIfEmpty(b.fecha_entrega_tesoreria),
      toNullIfEmpty(b.fecha_recibido_presupuesto),
      normalizeEstatus(b.estatus),
      toNullIfEmpty(b.observaciones),
      id,
    ];

    await client.query("BEGIN");
    const r = await client.query(
      `
      UPDATE expedientes_entrega
      SET
        anio = $1,
        mes = $2,
        id_suficiencia = $3,
        id_comprometido = $4,
        id_devengado = $5,
        id_dgeneral = $6,
        id_dauxiliar = $7,
        partida_clave = $8,
        folio = $9,
        dependencia = $10,
        concepto = $11,
        importe = $12,
        entrego_comprometido = $13,
        entrego_devengado = $14,
        fecha_entrega_tesoreria = $15,
        fecha_recibido_presupuesto = $16,
        estatus = $17,
        observaciones = $18
      WHERE id = $19
      RETURNING id
      `,
      payload
    );
    await client.query("COMMIT");

    if (!r.rowCount) return res.status(404).json({ error: "Entrega no encontrada" });

    await logAuditEvent(req, {
      tipo: "EXPEDIENTE_ENTREGA_ACTUALIZAR",
      entidad: "EXPEDIENTES_ENTREGA",
      entidad_id: String(r.rows[0].id),
      estado: payload[16] || "ACTUALIZADO",
      detalles: {
        id_expediente_entrega: r.rows[0].id,
        folio,
        anio,
        mes,
        id_suficiencia,
        id_comprometido,
        id_devengado,
        estatus: payload[16] || null,
        actor_id: getActorId(req) || req.user?.id || null,
      },
    });

    return res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Entrega ya registrada para este folio y periodo" });
    }
    console.error("[PATCH expedientes-entrega] error:", err);
    return res.status(500).json({ error: "Error actualizando entrega", db: err.message });
  } finally {
    client.release();
  }
});

export default router;
