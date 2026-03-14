/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: API — Gastos Comprometidos
 *  Archivo: comprometido.routes.js
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
import {
  isPartidaMilKey,
  logAuditEvent,
  logUnauthorizedPartidasAccess,
} from "../utils/helpers.js";

const router = express.Router();

async function isUserL00117(req) {
  const dgId = Number(req.user?.id_dgeneral);
  const daId = Number(req.user?.id_dauxiliar);
  if (!Number.isFinite(dgId) || !Number.isFinite(daId)) return false;
  const [rDg, rDa] = await Promise.all([
    query(`SELECT clave FROM dgeneral WHERE id = $1 LIMIT 1`, [dgId]),
    query(`SELECT clave FROM dauxiliar WHERE id = $1 LIMIT 1`, [daId]),
  ]);
  const dgClave = String(rDg.rows?.[0]?.clave || "").trim().toUpperCase();
  const daClave = String(rDa.rows?.[0]?.clave || "").trim().toUpperCase();
  return dgClave === "L00" && daClave === "117";
}
async function isUserE00(req) {
  const dgId = Number(req.user?.id_dgeneral);
  if (!Number.isFinite(dgId)) return false;
  const rDg = await query(`SELECT clave FROM dgeneral WHERE id = $1 LIMIT 1`, [dgId]);
  const dgClave = String(rDg.rows?.[0]?.clave || "").trim().toUpperCase();
  return dgClave === "E00";
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

function getMonthCode(dateStr) {
  const s = String(dateStr || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split("-")[1];
  if (s.includes("T")) return s.split("T")[0].split("-")[1];
  const now = new Date();
  return String(now.getMonth() + 1).padStart(2, "0");
}

router.post("/", async (req, res) => {
  const client = await getClient();
  try {
    const b = req.body || {};
    const allowIEPSPensiones = (await isUserL00117(req)) || (await isUserE00(req));

    const idSuf = Number(b.id_suficiencia ?? b.id);
    if (!Number.isFinite(idSuf) || idSuf <= 0) {
      return res.status(400).json({ error: "Falta id_suficiencia válido" });
    }

    const exists = await client.query(
      `SELECT id, folio_num, no_comprometido
       FROM comprometidos
       WHERE id_suficiencia = $1
       LIMIT 1`,
      [idSuf]
    );

    if (exists.rows.length) {
      return res.json({
        ok: true,
        already_exists: true,
        id: exists.rows[0].id,
        folio_num: exists.rows[0].folio_num,
        no_comprometido: exists.rows[0].no_comprometido,
      });
    }

    const fechaBaseRaw = b.fecha ? new Date(b.fecha) : new Date();
    const fechaBase = Number.isNaN(fechaBaseRaw.getTime()) ? new Date() : fechaBaseRaw;

    const year = String(fechaBase.getFullYear());
    const mes = String(fechaBase.getMonth() + 1).padStart(2, "0");
    const tipo = "CP";
    const prefijo = `ECA-${year}-${mes}-${tipo}-`;

    const departamento = b.departamento ?? b.dependencia_aux ?? null;

    await client.query("BEGIN");
    await client.query("LOCK TABLE comprometidos IN EXCLUSIVE MODE");

    const rConsec = await client.query(
      `
        SELECT COALESCE(MAX(RIGHT(no_comprometido, 4)::int), 0) + 1 AS consecutivo
        FROM comprometidos
        WHERE no_comprometido LIKE $1
          AND DATE_PART('year', fecha) = DATE_PART('year', $2::date)
      `,
      [`${prefijo}%`, fechaBase]
    );

    const consecutivo = Number(rConsec.rows?.[0]?.consecutivo || 1);
    const noComprometido = `${prefijo}${String(consecutivo).padStart(4, "0")}`;

    // Obtener firmas de la suficiencia para propagarlas al comprometido
    const rSufFirmas = await client.query(
      `SELECT firma_enlace_label, firma_enlace_nombre, firma_area_label, firma_area_nombre, firma_direccion_nombre
       FROM suficiencias WHERE id = $1 LIMIT 1`,
      [idSuf]
    );
    const sufData = rSufFirmas.rows[0] ?? {};

    const sqlHead = `
      INSERT INTO comprometidos (
        id_suficiencia,
        id_usuario,

        id_dgeneral,
        id_dauxiliar,
        id_proyecto,
        id_fuente,

        no_comprometido,
        fecha,
        dependencia,
        departamento,
        fuente,
        mes_pago,
        meta,
        clave_programatica,

        impuesto_tipo,
        isr_tasa,
        ieps_tasa,
        subtotal,
        iva,
        isr,
        ieps,
        total,
        cantidad_con_letra,
        firma_enlace_label, firma_enlace_nombre, firma_area_label, firma_area_nombre, firma_direccion_nombre
      )
      VALUES (
        $1, $2,
        $3, $4, $5, $6,
        $7,
        $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23,
        $24, $25, $26, $27, $28
      )
      RETURNING id, folio_num, no_comprometido;
    `;

    // Normalizar montos y tasas
    let isr_tasa = toNumOrNull(b.isr_tasa);
    let ieps_tasa = toNumOrNull(b.ieps_tasa);
    let subtotal = toNumOrZero(b.subtotal);
    let iva = toNumOrZero(b.iva);
    let isr = toNumOrZero(b.isr);
    let ieps = toNumOrZero(b.ieps);
    let total = toNumOrZero(b.total);

    if (!allowIEPSPensiones) {
      ieps_tasa = null;
      ieps = 0;
      total = subtotal + iva + isr + 0;
    }

    const headParams = [
      idSuf, // $1
      req.user.id, // $2

      b.id_dgeneral, // $3
      b.id_dauxiliar, // $4
      b.id_proyecto, // $5
      b.id_fuente, // $6

      noComprometido, // $7
      fechaBase, // $8
      b.dependencia ?? null, // $9
      departamento, // $10
      b.fuente ?? null, // $11 (texto)
      b.mes_pago ?? null, // $12
      b.meta ?? null, // $13
      b.clave_programatica ?? null, // $14

      b.impuesto_tipo ?? "NONE", // $15
      isr_tasa, // $16
      ieps_tasa, // $17
      subtotal, // $18
      iva, // $19
      isr, // $20
      ieps, // $21
      total, // $22
      toNullIfEmpty(b.cantidad_con_letra), // $23
      sufData.firma_enlace_label ?? null,    // $24
      sufData.firma_enlace_nombre ?? null,   // $25
      sufData.firma_area_label ?? null,      // $26
      sufData.firma_area_nombre ?? null,     // $27
      sufData.firma_direccion_nombre ?? null, // $28
    ];

    const rHead = await client.query(sqlHead, headParams);
    const idComp = Number(rHead.rows[0].id);

    const detalle = Array.isArray(b.detalle) ? b.detalle : [];
    if (detalle.length > 0) {
      const values = [];
      const params = [];
      let idx = 1;

      for (let j = 0; j < detalle.length; j++) {
        const d = detalle[j] || {};
        values.push(
          `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
        );
        params.push(
          idComp,
          Number(d.renglon ?? j + 1),
          d.clave ?? null,
          d.concepto_partida ?? null,
          d.justificacion ?? null,
          d.descripcion ?? null,
          toNumOrZero(d.importe)
        );
      }

      const sqlDet = `
        INSERT INTO comprometido_detalle
        (id_comprometido, renglon, clave, concepto_partida, justificacion, descripcion, importe)
        VALUES ${values.join(",")}
      `;

      await client.query(sqlDet, params);
    }

    await client.query("COMMIT");

    await logAuditEvent(req, {
      tipo: "COMPROMETIDO",
      entidad: "COMPROMETIDOS",
      entidad_id: rHead.rows[0].no_comprometido,
      estado: "CREADO",
      detalles: {
        id_comprometido: idComp,
        id_suficiencia: idSuf,
        folio_num: rHead.rows[0].folio_num,
        no_comprometido: rHead.rows[0].no_comprometido,
        total: total,
        renglones: Array.isArray(detalle) ? detalle.length : 0,
      },
    });

    return res.json({
      ok: true,
      id: idComp,
      folio_num: rHead.rows[0].folio_num,
      no_comprometido: rHead.rows[0].no_comprometido,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[POST comprometido] error:", err);
    return res
      .status(500)
      .json({ error: "Error al guardar comprometido", db: err.message });
  } finally {
    client.release();
  }
});

router.get("/buscar", async (req, res) => {
  console.log("[GET /api/comprometido/buscar] hit", req.query.no);

  try {
    const no = String(req.query.no || "").trim();
    if (!no) return res.status(400).json({ error: "Falta parámetro ?no=" });

    const sql = `
      SELECT
        c.*,
        COALESCE(c.estatus,'ABIERTO') AS estatus
      FROM comprometidos c
      WHERE c.no_comprometido = $1
      LIMIT 1
    `;
    const r = await query(sql, [no]);

    if (!r.rowCount) return res.status(404).json({ error: "Comprometido no encontrado" });

    const rDet = await query(
      `
      SELECT renglon, clave, concepto_partida, justificacion, descripcion, importe
      FROM comprometido_detalle
      WHERE id_comprometido = $1
      ORDER BY renglon ASC
      `,
      [r.rows[0].id]
    );
    const detalleRows = Array.isArray(rDet.rows) ? rDet.rows : [];
    const allowedMil = (await isUserL00117(req)) || (await isUserE00(req));
    const detalle = allowedMil
      ? detalleRows
      : detalleRows.filter((row) => !isPartidaMilKey(row?.clave));
    if (!allowedMil && detalle.length !== detalleRows.length) {
      await logUnauthorizedPartidasAccess(req, {
        motivo: "PARTIDAS_MIL_COMPROMETIDO",
        data: { id_comprometido: r.rows[0].id, no: r.rows[0].no_comprometido },
      });
    }
    return res.json({
      ok: true,
      ...r.rows[0],
      detalle,
    });
  } catch (e) {
    console.error("[GET comprometido buscar]", e);
    return res.status(500).json({ error: "Error buscando comprometido", db: e.message });
  }
});

router.get("/por-suficiencia/:id", async (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT
      c.id,
      c.id_suficiencia,
      c.clave_programatica,

      c.id_proyecto,
      p.clave        AS proyecto_clave,
      p.descripcion  AS proyecto_text,

      dg.dependencia AS dependencia_general,
      da.dependencia AS dependencia_auxiliar,

      c.id_fuente,
      f.fuente       AS fuente_text,

      c.fecha,
      c.mes_pago,
      c.subtotal,
      c.iva,
      c.isr,
      c.total,
      COALESCE(c.estatus,'ABIERTO') AS estatus

    FROM comprometidos c
    LEFT JOIN proyectos p   ON p.id = c.id_proyecto
    LEFT JOIN dgeneral dg   ON dg.id = c.id_dgeneral
    LEFT JOIN dauxiliar da  ON da.id = c.id_dauxiliar
    LEFT JOIN fuentes f     ON f.id = c.id_fuente
    WHERE c.id_suficiencia = $1
    LIMIT 1
  `;

  try {
    const { rows } = await query(sql, [id]);
    if (!rows.length) {
      return res.status(404).json({ message: "Comprometido no encontrado" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Comprometido por suficiencia:", err);
    res.status(500).json({ message: "Error al consultar comprometido" });
  }
});

router.get("/:id/resumen", async (req, res) => {
  const idComp = Number(req.params.id || 0);
  if (!Number.isFinite(idComp) || idComp <= 0) {
    return res.status(400).json({ error: "ID de comprometido inválido" });
  }

  try {
    const rComp = await query(
      `
      SELECT
        id,
        id_suficiencia,
        total,
        COALESCE(estatus,'ABIERTO') AS estatus,
        fecha_cierre,
        COALESCE(monto_liberado, 0) AS monto_liberado
      FROM comprometidos
      WHERE id = $1
      LIMIT 1
      `,
      [idComp]
    );

    if (!rComp.rowCount) {
      return res.status(404).json({ error: "Comprometido no encontrado" });
    }

    const totalComp = toNumOrZero(rComp.rows[0].total);

    const rSum = await query(
      `
      SELECT COALESCE(SUM(total), 0) AS dev_acum
      FROM devengados
      WHERE id_comprometido = $1
        AND COALESCE(estatus,'ACTIVO') <> 'CANCELADO'
      `,
      [idComp]
    );

    const devAcum = Number(rSum.rows[0]?.dev_acum || 0);
    const saldo = totalComp - devAcum;

    return res.json({
      ok: true,
      id: rComp.rows[0].id,
      id_suficiencia: rComp.rows[0].id_suficiencia,
      estatus: rComp.rows[0].estatus,
      total_comprometido: totalComp,
      devengado_acumulado: devAcum,
      saldo_restante: saldo,
      fecha_cierre: rComp.rows[0].fecha_cierre ?? null,
      monto_liberado: Number(rComp.rows[0].monto_liberado || 0),
    });
  } catch (err) {
    console.error("[GET comprometido resumen] error:", err);
    return res.status(500).json({ error: "Error consultando resumen", db: err.message });
  }
});

router.post("/:id/cerrar", async (req, res) => {
  const client = await getClient();
  try {
    const idComp = Number(req.params.id || 0);
    if (!Number.isFinite(idComp) || idComp <= 0) {
      return res.status(400).json({ error: "ID de comprometido inválido" });
    }

    await client.query("BEGIN");

    const rComp = await client.query(
      `
      SELECT
        id,
        total,
        COALESCE(estatus,'ABIERTO') AS estatus
      FROM comprometidos
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [idComp]
    );

    if (!rComp.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Comprometido no encontrado" });
    }

    const comp = rComp.rows[0];
    const estatus = String(comp.estatus || "ABIERTO").toUpperCase();

    if (estatus === "CERRADO") {
      await client.query("ROLLBACK");
      return res.json({ ok: true, already_closed: true, id: idComp });
    }

    const totalComp = toNumOrZero(comp.total);

    const rSum = await client.query(
      `
      SELECT COALESCE(SUM(total), 0) AS dev_acum
      FROM devengados
      WHERE id_comprometido = $1
        AND COALESCE(estatus,'ACTIVO') <> 'CANCELADO'
      `,
      [idComp]
    );

    const devAcum = Number(rSum.rows[0]?.dev_acum || 0);
    const saldo = totalComp - devAcum;

    if (saldo < 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Inconsistencia: devengado acumulado excede el total comprometido",
        total_comprometido: totalComp,
        devengado_acumulado: devAcum,
        saldo_restante: saldo,
      });
    }

    await client.query(
      `
      UPDATE comprometidos
      SET
        estatus = 'CERRADO',
        fecha_cierre = NOW(),
        monto_liberado = $2
      WHERE id = $1
      `,
      [idComp, saldo]
    );

    await client.query("COMMIT");

    await logAuditEvent(req, {
      tipo: "COMPROMETIDO_CERRAR",
      entidad: "COMPROMETIDOS",
      entidad_id: String(idComp),
      estado: "CERRADO",
      detalles: {
        id_comprometido: idComp,
        total_comprometido: totalComp,
        devengado_acumulado: devAcum,
        monto_liberado: saldo,
      },
    });

    return res.json({
      ok: true,
      id: idComp,
      estatus: "CERRADO",
      total_comprometido: totalComp,
      devengado_acumulado: devAcum,
      monto_liberado: saldo,
      saldo_restante: 0,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_e) {}
    console.error("[POST comprometido cerrar] error:", err);
    return res.status(500).json({ error: "Error al cerrar comprometido", db: err.message });
  } finally {
    client.release();
  }
});

export default router;
