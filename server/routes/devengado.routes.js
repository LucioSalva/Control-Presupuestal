// server/routes/devengado.routes.js
import express from "express";
import { getClient } from "../db.js";

const router = express.Router();

// ---------------------------
// Helpers (blindaje contra "" en numeric)
// ---------------------------
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

function monthCode(dateStr) {
  const s = String(dateStr || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split("-")[1];
  if (s.includes("T")) return s.split("T")[0].split("-")[1];
  const now = new Date();
  return String(now.getMonth() + 1).padStart(2, "0");
}

// =====================================================
// GET /api/devengado/por-comprometido/:id
// Lista parcialidades (devengados) de ese comprometido
// =====================================================
router.get("/por-comprometido/:id", async (req, res) => {
  const client = await getClient();
  try {
    const idComp = Number(req.params.id || 0);
    if (!Number.isFinite(idComp) || idComp <= 0) {
      return res.status(400).json({ error: "ID comprometido inválido" });
    }

    const r = await client.query(
      `
      SELECT id, no_devengado, fecha, total, COALESCE(estatus,'ACTIVO') AS estatus
      FROM devengados
      WHERE id_comprometido = $1
      ORDER BY fecha ASC, id ASC
      `,
      [idComp]
    );

    return res.json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error("[GET devengados por comprometido]", e);
    return res.status(500).json({ error: "Error consultando devengados", db: e.message });
  } finally {
    client.release();
  }
});

// =====================================================
// POST /api/devengado
// Crea UN devengado (parcialidad) ligado a un comprometido
// - devengados (cabecera)
// - devengado_detalle (detalle)
// =====================================================
router.post("/", async (req, res) => {
  const client = await getClient();

  try {
    const b = req.body || {};

    // ✅ ID suficiencia (en tu flujo, es el que SIEMPRE tienes)
    const idSuf = Number(b.id_suficiencia ?? b.id ?? 0);
    if (!Number.isFinite(idSuf) || idSuf <= 0) {
      return res.status(400).json({ error: "Falta id_suficiencia válido" });
    }

    // ✅ id_comprometido: si no viene, lo resolvemos por id_suficiencia
    let idComp = Number(b.id_comprometido ?? 0);
    if (!Number.isFinite(idComp) || idComp <= 0) {
      const rFind = await client.query(
        `
        SELECT id
        FROM comprometidos
        WHERE id_suficiencia = $1
        ORDER BY id DESC
        LIMIT 1
        `,
        [idSuf]
      );

      if (!rFind.rowCount) {
        return res.status(400).json({
          error:
            "No existe comprometido para esta suficiencia. Genera primero el Comprometido.",
        });
      }

      idComp = Number(rFind.rows[0].id);
    }

    // ✅ Folio: ECA-<mes>-DV-0001 (global por mes)
    const fechaBase =
      toNullIfEmpty(b.fecha_devengado ?? b.fecha) ||
      new Date().toISOString().slice(0, 10);

    const mes = monthCode(fechaBase);
    const prefijo = `ECA-${mes}-DV-`;

    // ✅ total de este devengado (parcialidad)
    const totalDev = toNumOrZero(b.total ?? b.monto_devengado);
    if (!(totalDev > 0)) {
      return res.status(400).json({ error: "El total del devengado debe ser mayor a 0" });
    }

    await client.query("BEGIN");

    // -----------------------------------------
    // 1) Bloqueo para saldo: bloquea el comprometido
    //    (evita que 2 usuarios devenguen el mismo saldo)
    // -----------------------------------------
    const rComp = await client.query(
      `
      SELECT
        c.id,
        c.id_suficiencia,
        c.id_dgeneral,
        c.id_dauxiliar,
        c.id_proyecto,
        c.id_fuente,
        c.dependencia,
        c.departamento,
        c.fuente,
        c.mes_pago,
        c.meta,
        c.clave_programatica,
        c.impuesto_tipo,
        c.isr_tasa,
        c.ieps_tasa,
        c.subtotal,
        c.iva,
        c.isr,
        c.ieps,
        c.total,
        c.cantidad_con_letra,
        COALESCE(c.estatus, 'ABIERTO') AS estatus
      FROM comprometidos c
      WHERE c.id = $1
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

    // ✅ Seguridad: que el comprometido corresponda a la misma suficiencia
    if (Number(comp.id_suficiencia) !== Number(idSuf)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "El id_suficiencia no corresponde al comprometido encontrado. Revisa el flujo.",
      });
    }

    // ✅ No permitir si está cerrado
    if (String(comp.estatus || "").toUpperCase() === "CERRADO") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Este comprometido está CERRADO. Ya no admite nuevos devengados.",
      });
    }

    // -----------------------------------------
    // 2) Validación correcta: NO exceder saldo del comprometido
    //    (solo suma devengados ACTIVO)
    // -----------------------------------------
    const totalComp = toNumOrZero(comp.total);

    const rSum = await client.query(
      `
      SELECT COALESCE(SUM(total), 0) AS dev_acum
      FROM devengados
      WHERE id_comprometido = $1
        AND COALESCE(estatus, 'ACTIVO') <> 'CANCELADO'
      `,
      [idComp]
    );

    const devAcum = Number(rSum.rows[0]?.dev_acum || 0);
    const saldo = totalComp - devAcum;

    if (totalDev > saldo) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `El monto (${totalDev}) excede el saldo del comprometido (${saldo}).`,
        saldo,
        devengado_acumulado: devAcum,
        comprometido_total: totalComp,
      });
    }

    // -----------------------------------------
    // 3) Folio consecutivo (bloqueo SOLO para generar folio)
    //    Si prefieres, se puede optimizar con una secuencia.
    // -----------------------------------------
    await client.query("LOCK TABLE devengados IN EXCLUSIVE MODE");

    const rConsec = await client.query(
      `
      SELECT COALESCE(MAX(RIGHT(no_devengado, 4)::int), 0) + 1 AS consecutivo
      FROM devengados
      WHERE no_devengado LIKE $1
        AND DATE_PART('year', fecha) = DATE_PART('year', $2::date)
      `,
      [`${prefijo}%`, fechaBase]
    );

    const consecutivo = Number(rConsec.rows?.[0]?.consecutivo || 1);
    const noDevengado = `${prefijo}${String(consecutivo).padStart(4, "0")}`;

    // ✅ Inserta CABECERA
    const sqlHead = `
      INSERT INTO devengados (
        id_comprometido,
        id_suficiencia,
        id_usuario,

        id_dgeneral,
        id_dauxiliar,
        id_proyecto,
        id_fuente,

        no_devengado,
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

        estatus
      )
      VALUES (
        $1,$2,$3,
        $4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,
        'ACTIVO'
      )
      RETURNING id, folio_num, no_devengado;
    `;

    const headParams = [
      idComp, // $1
      idSuf, // $2
      req.user.id, // $3

      comp.id_dgeneral, // $4
      comp.id_dauxiliar, // $5
      comp.id_proyecto, // $6
      comp.id_fuente, // $7

      noDevengado, // $8
      fechaBase, // $9
      comp.dependencia, // $10
      comp.departamento, // $11
      comp.fuente, // $12
      comp.mes_pago, // $13
      comp.meta, // $14
      comp.clave_programatica, // $15

      comp.impuesto_tipo ?? "NONE", // $16

      // ✅ blindaje numeric
      toNumOrNull(b.isr_tasa ?? comp.isr_tasa), // $17
      toNumOrNull(b.ieps_tasa ?? comp.ieps_tasa), // $18

      toNumOrZero(b.subtotal ?? comp.subtotal), // $19
      toNumOrZero(b.iva ?? comp.iva), // $20
      toNumOrZero(b.isr ?? comp.isr), // $21
      toNumOrZero(b.ieps ?? comp.ieps), // $22

      totalDev, // $23
      toNullIfEmpty(b.cantidad_con_letra ?? comp.cantidad_con_letra), // $24
    ];

    const rHead = await client.query(sqlHead, headParams);
    const idDev = Number(rHead.rows[0].id);

    // ✅ Inserta DETALLE (importe editable)
    const detalle = Array.isArray(b.detalle) ? b.detalle : [];
    if (detalle.length) {
      const values = [];
      const params = [];
      let i = 1;

      for (let idx = 0; idx < detalle.length; idx++) {
        const d = detalle[idx] || {};
        const renglon = Number(d.renglon ?? d.no ?? (idx + 1));

        values.push(
          `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`
        );

        params.push(
          idDev,
          renglon,
          toNullIfEmpty(d.clave),
          toNullIfEmpty(d.concepto_partida),
          toNullIfEmpty(d.justificacion),
          toNullIfEmpty(d.descripcion),
          toNumOrZero(d.importe)
        );
      }

      await client.query(
        `
        INSERT INTO devengado_detalle
          (id_devengado, renglon, clave, concepto_partida, justificacion, descripcion, importe)
        VALUES ${values.join(",")}
        `,
        params
      );
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      id: idDev,
      folio_num: rHead.rows[0].folio_num,
      no_devengado: rHead.rows[0].no_devengado,
      id_comprometido: idComp,
      id_suficiencia: idSuf,
      comprometido_total: totalComp,
      devengado_acumulado: devAcum + totalDev,
      saldo_restante: saldo - totalDev,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_e) {}
    console.error("[POST devengado] error:", err);
    return res
      .status(500)
      .json({ error: "Error al guardar devengado", db: err.message });
  } finally {
    client.release();
  }
});

// =====================================================
// PATCH /api/devengado/:id/cancelar
// Cancela un devengado (no borra)
// =====================================================
router.patch("/:id/cancelar", async (req, res) => {
  const client = await getClient();
  try {
    const idDev = Number(req.params.id || 0);
    if (!Number.isFinite(idDev) || idDev <= 0) {
      return res.status(400).json({ error: "ID de devengado inválido" });
    }

    await client.query("BEGIN");

    // Traer el devengado y bloquearlo
    const r = await client.query(
      `
      SELECT id, id_comprometido, COALESCE(estatus,'ACTIVO') AS estatus
      FROM devengados
      WHERE id = $1
      FOR UPDATE
      `,
      [idDev]
    );

    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Devengado no encontrado" });
    }

    const cur = r.rows[0];
    if (String(cur.estatus).toUpperCase() === "CANCELADO") {
      await client.query("ROLLBACK");
      return res.json({ ok: true, already: true, id: idDev });
    }

    // (Opcional) bloquear comprometido por consistencia
    await client.query(
      `
      SELECT id
      FROM comprometidos
      WHERE id = $1
      FOR UPDATE
      `,
      [cur.id_comprometido]
    );

    await client.query(
      `
      UPDATE devengados
      SET estatus = 'CANCELADO'
      WHERE id = $1
      `,
      [idDev]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, id: idDev });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_e) {}
    console.error("[PATCH devengado cancelar] error:", err);
    return res.status(500).json({ error: "Error al cancelar devengado", db: err.message });
  } finally {
    client.release();
  }
});

export default router;
