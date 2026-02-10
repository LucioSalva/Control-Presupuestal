import express from "express";
import { query, getClient } from "../db.js";

const router = express.Router();

/* =====================================================
   Helpers roles
   ===================================================== */
function getRole(req) {
  const roles = (req.user?.roles || []).map((r) => String(r).toUpperCase());
  if (roles.includes("GOD")) return "GOD";
  if (roles.includes("ADMIN")) return "ADMIN";
  return "AREA";
}

function pad6(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return s.padStart(6, "0");
  return s;
}

/* =====================================================
  GET /api/suficiencias/next-folio
   ===================================================== */
router.get("/next-folio", async (req, res) => {
  try {
    const r = await query(
      `SELECT COALESCE(MAX(folio_num),0) + 1 AS folio_num FROM suficiencias`,
    );
    return res.json({ folio_num: Number(r.rows?.[0]?.folio_num || 1) });
  } catch (err) {
    console.error("[next-folio] error:", err);
    return res.status(500).json({ error: "Error al obtener folio" });
  }
});

/* =====================================================
  POST /api/suficiencias  (CABECERA + DETALLE)
   ===================================================== */
router.post("/", async (req, res) => {
  const client = await getClient();
  try {
    const b = req.body || {};

    const fechaBaseRaw = b.fecha ? new Date(b.fecha) : new Date();
    const fechaBase = Number.isNaN(fechaBaseRaw.getTime())
      ? new Date()
      : fechaBaseRaw;

    const mes = String(fechaBase.getMonth() + 1).padStart(2, "0");
    const tipo = "SP";
    const prefijo = `ECA-${mes}-${tipo}-`;

    const departamento = b.departamento ?? b.dependencia_aux ?? null;

    await client.query("BEGIN");
    await client.query("LOCK TABLE suficiencias IN EXCLUSIVE MODE");

    const rConsec = await client.query(
      `
        SELECT COALESCE(MAX(RIGHT(no_suficiencia, 4)::int), 0) + 1 AS consecutivo
        FROM suficiencias
        WHERE no_suficiencia LIKE $1
          AND DATE_PART('year', fecha) = DATE_PART('year', $2::date)
      `,
      [`${prefijo}%`, fechaBase],
    );

    const consecutivo = Number(rConsec.rows?.[0]?.consecutivo || 1);
    const noSuficiencia = `${prefijo}${String(consecutivo).padStart(4, "0")}`;

    // ================================
    // INSERT CABECERA
    // ================================
    const sqlHead = `
  INSERT INTO suficiencias (
    id_usuario,
    id_dgeneral,
    id_dauxiliar,
    id_proyecto,
    id_fuente,

    fecha,
    dependencia,
    departamento,
    fuente,
    mes_pago,
    clave_programatica,

    meta,
    impuesto_tipo,
    isr_tasa,
    ieps_tasa,
    subtotal,
    iva,
    isr,
    ieps,

    total,
    cantidad_con_letra,
    created_at
  )
  VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9, $10, $11,
    $12, $13, $14, $15, $16, $17, $18, $19,
    $20, $21, NOW()
  )
  RETURNING id, folio_num, no_suficiencia;
`;

    const headParams = [
  req.user.id,
  b.id_dgeneral,
  b.id_dauxiliar,
  b.id_proyecto,
  b.id_fuente,

  b.fecha,
  b.dependencia,
  departamento,
  b.fuente,
  b.mes_pago,
  b.clave_programatica,

  b.meta,
  b.impuesto_tipo,
  b.isr_tasa,
  b.ieps_tasa,
  b.subtotal,
  b.iva,
  b.isr,
  b.ieps,

  b.total,
  b.cantidad_con_letra,
];

    const rHead = await client.query(sqlHead, headParams);
    const idSuf = rHead.rows[0].id;

    // ================================
    // INSERT DETALLE
    // ================================
    if (Array.isArray(b.detalle) && b.detalle.length > 0) {
      const values = [];
      const params = [];
      let idx = 1;

      for (const d of b.detalle) {
        values.push(
          `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
        );
        params.push(
          idSuf,
          d.renglon,
          d.clave,
          d.concepto_partida,
          d.justificacion,
          d.descripcion,
          d.importe,
        );
      }

      const sqlDet = `
        INSERT INTO suficiencia_detalle
        (id_suficiencia, renglon, clave, concepto_partida, justificacion, descripcion, importe)
        VALUES ${values.join(",")}
      `;

      await client.query(sqlDet, params);
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      id: idSuf,
      folio_num: rHead.rows[0].folio_num,
      no_suficiencia: rHead.rows[0].no_suficiencia,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[POST suficiencias] error:", err);
    return res.status(500).json({
      error: "Error al guardar suficiencia",
      db: err.message,
    });
  } finally {
    client.release();
  }
});

router.get("/buscar", async (req, res) => {
  try {
    const role = getRole(req);

    const numeroRaw = String(req.query.numero || "").trim();
    if (!numeroRaw) {
      return res.status(400).json({ error: "Falta parametro numero" });
    }

    const where = [];
    const params = [];
    let i = 1;

    if (/^\d{1,6}$/.test(numeroRaw)) {
      where.push(`folio_num = $${i++}`);
      params.push(Number(numeroRaw));
    } else {
      where.push(`no_suficiencia ILIKE $${i++}`);
      params.push(`%${numeroRaw}%`);
    }

    if (role === "AREA") {
      if (req.user?.id_dgeneral != null) {
        where.push(`id_dgeneral = $${i++}`);
        params.push(req.user.id_dgeneral);
      }
      if (req.user?.id_dauxiliar != null) {
        where.push(`id_dauxiliar = $${i++}`);
        params.push(req.user.id_dauxiliar);
      }
    }

    const sql = `
      SELECT id, folio_num, no_suficiencia, fecha, id_dgeneral, id_dauxiliar
      FROM suficiencias
      WHERE ${where.join(" AND ")}
      ORDER BY id DESC
      LIMIT 50
    `;

    const r = await query(sql, params);
    return res.json({ ok: true, data: r.rows });
  } catch (err) {
    console.error("[GET buscar] error:", err);
    return res.status(500).json({
      error: "Error al buscar suficiencia",
      db: err.message,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const role = getRole(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id inválido" });
    }

    const where = [`id = $1`];
    const params = [id];
    let i = 2;

    if (role === "AREA") {
      if (req.user?.id_dgeneral != null) {
        where.push(`id_dgeneral = $${i++}`);
        params.push(req.user.id_dgeneral);
      }
      if (req.user?.id_dauxiliar != null) {
        where.push(`id_dauxiliar = $${i++}`);
        params.push(req.user.id_dauxiliar);
      }
    }

    // 1) Cabecera
    const rHead = await query(
      `SELECT *
       FROM suficiencias
       WHERE ${where.join(" AND ")}
       LIMIT 1`,
      params,
    );

    if (!rHead.rows.length) {
      return res.status(404).json({ error: "No encontrada" });
    }

    const head = rHead.rows[0];

    // 2) Detalle
    const rDet = await query(
      `SELECT renglon, clave, concepto_partida, justificacion, descripcion, importe
       FROM suficiencia_detalle
       WHERE id_suficiencia = $1
       ORDER BY renglon ASC`,
      [id],
    );

    return res.json({
      ...head,
      detalle: rDet.rows || [],
    });
  } catch (err) {
    console.error("[GET /api/suficiencias/:id] error:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener suficiencia", db: err.message });
  }
});

export default router;
