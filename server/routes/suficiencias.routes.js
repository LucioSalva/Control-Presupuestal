/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: API — Suficiencias Presupuestales
 *  Archivo: suficiencias.routes.js
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
import {
  canViewIepsPensionesByClaves,
  sanitizeFinancialFieldsForLimitedView,
} from "../utils/financial-fields-perm.js";

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

async function getUserDgDaClaves(req) {
  const dgId = Number(req.user?.id_dgeneral);
  const daId = Number(req.user?.id_dauxiliar);
  if (!Number.isFinite(dgId) || !Number.isFinite(daId)) return { dg: "", da: "" };

  const [rDg, rDa] = await Promise.all([
    query(`SELECT clave FROM dgeneral WHERE id = $1 LIMIT 1`, [dgId]),
    query(`SELECT clave FROM dauxiliar WHERE id = $1 LIMIT 1`, [daId]),
  ]);

  const dg = String(rDg.rows?.[0]?.clave || "").trim().toUpperCase();
  const da = String(rDa.rows?.[0]?.clave || "").trim().toUpperCase();
  return { dg, da };
}

async function canViewIepsPensiones(req) {
  const { dg, da } = await getUserDgDaClaves(req);
  return canViewIepsPensionesByClaves(dg, da);
}

function normalizeNumber(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

function parseDateSafe(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildExpiresAt(baseDate) {
  if (!baseDate) return null;
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    25,
    23,
    59,
    59,
    999,
  );
}

function computeRemaining(expiresAt) {
  if (!expiresAt) return { dias: null, horas: null };
  const diff = expiresAt.getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return { dias: 0, horas: 0 };
  const dias = Math.floor(diff / 86400000);
  const horas = Math.floor((diff % 86400000) / 3600000);
  return { dias, horas };
}

function normalizeSufRow(row) {
  if (!row) return row;
  const base =
    parseDateSafe(row.fecha) ||
    parseDateSafe(row.created_at) ||
    parseDateSafe(row.expires_at);
  const expiresAt = buildExpiresAt(base);
  if (!expiresAt) return row;
  const estadoRaw = String(row.estado || "").trim().toUpperCase();
  let estado = estadoRaw;
  if (estadoRaw !== "CANCELADO") {
    estado = Date.now() >= expiresAt.getTime() ? "CADUCADO" : "ACTIVO";
  }
  const remaining =
    estado === "CANCELADO" ? { dias: 0, horas: 0 } : computeRemaining(expiresAt);
  return {
    ...row,
    expires_at: expiresAt.toISOString(),
    estado,
    dias_restantes: remaining.dias,
    horas_restantes: remaining.horas,
  };
}

/* =====================================================
  GET /api/suficiencias/saldo-partida
  Consulta saldo disponible para una partida/mes específica.
  Usado por el frontend al llenar renglones de suficiencia.
   ===================================================== */
router.get("/saldo-partida", async (req, res) => {
  const { id_dgeneral, id_dauxiliar, id_fuente, id_proyecto, clave, mes_pago, ejercicio } = req.query;

  // Validar parámetros obligatorios
  if (!id_dgeneral || !id_dauxiliar || !id_fuente || !id_proyecto || !clave || !mes_pago) {
    return res.status(400).json({ error: "Faltan parámetros: id_dgeneral, id_dauxiliar, id_fuente, id_proyecto, clave, mes_pago" });
  }

  const mesesValidos = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO",
                        "JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
  if (!mesesValidos.includes(String(mes_pago).toUpperCase())) {
    return res.status(400).json({ error: "mes_pago inválido" });
  }

  const ejercicioNum = Number(ejercicio) || new Date().getFullYear();

  try {
    const r = await query(
      `SELECT presupuesto_base, reservado_suficiencias, comprometido_vigente, devengado_en_cerrados, saldo_disponible
       FROM public.fn_saldo_disponible_partida($1, $2, $3, $4, $5, $6, $7)`,
      [
        Number(id_dgeneral),
        Number(id_dauxiliar),
        Number(id_fuente),
        Number(id_proyecto),
        String(clave).trim().toUpperCase(),
        String(mes_pago).toUpperCase(),
        ejercicioNum,
      ]
    );

    if (r.rowCount === 0) {
      return res.json({ presupuesto_base: 0, reservado_suficiencias: 0, comprometido_vigente: 0, devengado_en_cerrados: 0, saldo_disponible: 0 });
    }

    const row = r.rows[0];
    return res.json({
      clave: String(clave).trim().toUpperCase(),
      mes_pago: String(mes_pago).toUpperCase(),
      presupuesto_base: Number(row.presupuesto_base || 0),
      reservado_suficiencias: Number(row.reservado_suficiencias || 0),
      comprometido_vigente: Number(row.comprometido_vigente || 0),
      devengado_en_cerrados: Number(row.devengado_en_cerrados || 0),
      saldo_disponible: Number(row.saldo_disponible || 0),
    });
  } catch (e) {
    console.error("[SUFICIENCIAS][GET saldo-partida] Error:", e);
    return res.status(500).json({ error: "Error al calcular saldo disponible" });
  }
});

/* =====================================================
  POST /api/suficiencias/lote  (BATCH - una por fuente)
   ===================================================== */
router.post("/lote", async (req, res) => {
  const client = await getClient();
  try {
    const b = req.body || {};
    const suficiencias = Array.isArray(b.suficiencias) ? b.suficiencias : [];

    if (!suficiencias.length) {
      return res.status(400).json({ error: "Se requiere al menos una suficiencia en el lote" });
    }
    if (suficiencias.length > 20) {
      return res.status(400).json({ error: "Máximo 20 suficiencias por lote" });
    }

    const allowIEPSPensiones = await canViewIepsPensiones(req);

    await client.query("BEGIN");
    await client.query("LOCK TABLE suficiencias IN EXCLUSIVE MODE");

    const creadas = [];

    for (const suf of suficiencias) {
      const fechaBaseRaw = suf.fecha ? new Date(suf.fecha) : new Date();
      const fechaBase = Number.isNaN(fechaBaseRaw.getTime()) ? new Date() : fechaBaseRaw;

      const anio = String(fechaBase.getFullYear());
      const mes = String(fechaBase.getMonth() + 1).padStart(2, "0");
      const tipo = "SP";
      const prefijo = `ECA-${anio}-${mes}-${tipo}-`;

      const rConsec = await client.query(
        `
        SELECT COALESCE(MAX(
          CASE WHEN no_suficiencia ~ '^ECA-\\d{4}-\\d{2}-SP-\\d+$'
               THEN RIGHT(no_suficiencia, 4)::int
               ELSE 0
          END
        ), 0) + 1 AS consecutivo
        FROM suficiencias
        WHERE no_suficiencia LIKE $1
          AND DATE_PART('year', fecha) = DATE_PART('year', $2::date)
        `,
        [`${prefijo}%`, fechaBase]
      );

      const consecutivo = Number(rConsec.rows?.[0]?.consecutivo || 1);
      const noSuficiencia = `${prefijo}${String(consecutivo).padStart(4, "0")}`;

      const departamento = suf.departamento ?? suf.dependencia_aux ?? null;

      // ================================
      // VALIDACIÓN DE SALDO POR PARTIDA (lote)
      // ================================
      const detalleLote = Array.isArray(suf.detalle) ? suf.detalle.filter(d => d.clave && Number(d.importe) > 0) : [];
      if (detalleLote.length > 0) {
        const ejercicioLote = new Date(suf.fecha || Date.now()).getFullYear();
        for (const renglon of detalleLote) {
          const clave = String(renglon.clave || "").trim().toUpperCase();
          const importe = Number(renglon.importe || 0);
          const rSaldo = await client.query(
            `SELECT saldo_disponible, presupuesto_base
             FROM public.fn_saldo_disponible_partida($1,$2,$3,$4,$5,$6,$7)`,
            [Number(suf.id_dgeneral), Number(suf.id_dauxiliar), Number(suf.id_fuente), Number(suf.id_proyecto),
             clave, String(suf.mes_pago || "").toUpperCase(), ejercicioLote]
          );
          const saldo = Number(rSaldo.rows?.[0]?.saldo_disponible ?? 0);
          if (importe > saldo) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              error: `Saldo insuficiente — Partida ${clave}: solicitado $${importe.toFixed(2)}, disponible $${saldo.toFixed(2)}`,
              errores_saldo: [{ clave, importe_solicitado: importe, saldo_disponible: saldo,
                                presupuesto_base: Number(rSaldo.rows?.[0]?.presupuesto_base ?? 0) }],
            });
          }
        }
      }

      let isr_tasa = suf.isr_tasa;
      let ieps_tasa = suf.ieps_tasa;
      let subtotal = normalizeNumber(suf.subtotal);
      let iva = normalizeNumber(suf.iva);
      let isr = normalizeNumber(suf.isr);
      let ieps = normalizeNumber(suf.ieps);
      let total = normalizeNumber(suf.total);

      if (!allowIEPSPensiones) {
        ieps_tasa = null;
        ieps = 0;
        const pension_total = normalizeNumber(suf.pension_total, 0);
        const correctedTotal = subtotal + iva + isr;
        total = Number.isFinite(correctedTotal) ? correctedTotal : total + ieps + pension_total;
      }

      const sqlHead = `
        INSERT INTO suficiencias (
          id_usuario, id_dgeneral, id_dauxiliar, id_proyecto, id_fuente,
          fecha, dependencia, departamento, fuente, mes_pago, clave_programatica,
          meta, impuesto_tipo, isr_tasa, ieps_tasa,
          subtotal, iva, isr, ieps, total, cantidad_con_letra,
          firma_enlace_label, firma_enlace_nombre, firma_area_label, firma_area_nombre, firma_direccion_nombre,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21,
          $22, $23, $24, $25, $26,
          NOW()
        )
        RETURNING id, folio_num, no_suficiencia;
      `;

      const headParams = [
        req.user.id,
        suf.id_dgeneral,
        suf.id_dauxiliar,
        suf.id_proyecto,
        suf.id_fuente,
        suf.fecha,
        suf.dependencia,
        departamento,
        suf.fuente,
        suf.mes_pago,
        suf.clave_programatica,
        suf.meta,
        suf.impuesto_tipo,
        isr_tasa,
        ieps_tasa,
        subtotal,
        iva,
        isr,
        ieps,
        total,
        suf.cantidad_con_letra,
        suf.firma_enlace_label ?? null,   // $22
        suf.firma_enlace_nombre ?? null,  // $23
        suf.firma_area_label ?? null,     // $24
        suf.firma_area_nombre ?? null,    // $25
        suf.firma_direccion_nombre ?? null, // $26
      ];

      const rHead = await client.query(sqlHead, headParams);
      const idSuf = rHead.rows[0].id;

      if (Array.isArray(suf.detalle) && suf.detalle.length > 0) {
        const values = [];
        const params = [];
        let idx = 1;
        for (const d of suf.detalle) {
          values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
          params.push(idSuf, d.renglon, d.clave, d.concepto_partida, d.justificacion, d.descripcion, d.importe);
        }
        const sqlDet = `
          INSERT INTO suficiencia_detalle
          (id_suficiencia, renglon, clave, concepto_partida, justificacion, descripcion, importe)
          VALUES ${values.join(",")}
        `;
        await client.query(sqlDet, params);
      }

      await logAuditEvent(req, {
        tipo: "SUFICIENCIA_LOTE",
        entidad: "SUFICIENCIAS",
        entidad_id: noSuficiencia,
        estado: "CREADA",
        detalles: {
          id_suficiencia: idSuf,
          no_suficiencia: noSuficiencia,
          id_dgeneral: suf.id_dgeneral ?? null,
          id_dauxiliar: suf.id_dauxiliar ?? null,
          id_proyecto: suf.id_proyecto ?? null,
          id_fuente: suf.id_fuente ?? null,
          fuente_clave: suf.fuente_clave ?? null,
          total,
          renglones: Array.isArray(suf.detalle) ? suf.detalle.length : 0,
          lote_total: suficiencias.length,
        },
      });

      creadas.push({
        id: idSuf,
        no_suficiencia: noSuficiencia,
        fuente_clave: suf.fuente_clave ?? null,
        fuente_nombre: suf.fuente ?? null,
        total,
      });
    }

    await client.query("COMMIT");
    return res.json({ ok: true, creadas });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[POST suficiencias/lote] error:", err);
    return res.status(500).json({ error: "Error al guardar lote de suficiencias", db: err.message });
  } finally {
    client.release();
  }
});

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
    const allowIEPSPensiones = await canViewIepsPensiones(req);

    const fechaBaseRaw = b.fecha ? new Date(b.fecha) : new Date();
    const fechaBase = Number.isNaN(fechaBaseRaw.getTime())
      ? new Date()
      : fechaBaseRaw;

    const anio = String(fechaBase.getFullYear());
    const mes = String(fechaBase.getMonth() + 1).padStart(2, "0");
    const tipo = "SP";
    const prefijo = `ECA-${anio}-${mes}-${tipo}-`;

    const departamento = b.departamento ?? b.dependencia_aux ?? null;

    // ================================
    // VALIDACIÓN DE SALDO POR PARTIDA
    // ================================
    const detalleValidar = Array.isArray(b.detalle) ? b.detalle.filter(d => d.clave && Number(d.importe) > 0) : [];
    if (detalleValidar.length > 0) {
      const ejercicioVal = new Date(b.fecha || Date.now()).getFullYear();
      const erroresSaldo = [];
      for (const renglon of detalleValidar) {
        const clave = String(renglon.clave || "").trim().toUpperCase();
        const importe = Number(renglon.importe || 0);
        const rSaldo = await query(
          `SELECT saldo_disponible, presupuesto_base, reservado_suficiencias
           FROM public.fn_saldo_disponible_partida($1,$2,$3,$4,$5,$6,$7)`,
          [Number(b.id_dgeneral), Number(b.id_dauxiliar), Number(b.id_fuente), Number(b.id_proyecto),
           clave, String(b.mes_pago || "").toUpperCase(), ejercicioVal]
        );
        const saldo = Number(rSaldo.rows?.[0]?.saldo_disponible ?? 0);
        if (importe > saldo) {
          erroresSaldo.push({
            clave,
            importe_solicitado: importe,
            saldo_disponible: saldo,
            presupuesto_base: Number(rSaldo.rows?.[0]?.presupuesto_base ?? 0),
          });
        }
      }
      if (erroresSaldo.length > 0) {
        const detalle = erroresSaldo.map(e =>
          `Partida ${e.clave}: solicitado $${e.importe_solicitado.toFixed(2)}, disponible $${e.saldo_disponible.toFixed(2)}`
        ).join("; ");
        return res.status(400).json({
          error: `Saldo insuficiente en partida(s): ${detalle}`,
          errores_saldo: erroresSaldo,
        });
      }
    }

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
    firma_enlace_label, firma_enlace_nombre, firma_area_label, firma_area_nombre, firma_direccion_nombre,
    created_at
  )
  VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9, $10, $11,
    $12, $13, $14, $15, $16, $17, $18, $19,
    $20, $21,
    $22, $23, $24, $25, $26,
    NOW()
  )
  RETURNING id, folio_num, no_suficiencia;
`;

    // Permisos IEPS/Pensiones: si no está permitido, se fuerzan valores seguros
    let isr_tasa = b.isr_tasa;
    let ieps_tasa = b.ieps_tasa;
    let subtotal = normalizeNumber(b.subtotal);
    let iva = normalizeNumber(b.iva);
    let isr = normalizeNumber(b.isr);
    let ieps = normalizeNumber(b.ieps);
    let total = normalizeNumber(b.total);

    if (!allowIEPSPensiones) {
      ieps_tasa = null;
      ieps = 0;
      const pension_total = normalizeNumber(b.pension_total, 0);
      const correctedTotal = subtotal + iva + isr + 0 - 0;
      // En caso de manipulación cliente, recalculamos un total sin pensiones/IEPS
      total = Number.isFinite(correctedTotal) ? correctedTotal : total + ieps + pension_total;
    }

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
      isr_tasa,
      ieps_tasa,
      subtotal,
      iva,
      isr,
      ieps,

      total,
      b.cantidad_con_letra,
      b.firma_enlace_label ?? null,   // $22
      b.firma_enlace_nombre ?? null,  // $23
      b.firma_area_label ?? null,     // $24
      b.firma_area_nombre ?? null,    // $25
      b.firma_direccion_nombre ?? null, // $26
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

    const rFull = await client.query(
      `
      SELECT
        id,
        folio_num,
        no_suficiencia,
        created_at,
        expires_at,
        estado,
        dias_restantes,
        horas_restantes
      FROM v_suficiencias_estado
      WHERE id = $1
      LIMIT 1
      `,
      [idSuf],
    );

    await client.query("COMMIT");
    const full = normalizeSufRow(rFull.rows?.[0] || null);

    await logAuditEvent(req, {
      tipo: "SUFICIENCIA",
      entidad: "SUFICIENCIAS",
      entidad_id: rHead.rows[0].no_suficiencia,
      estado: full?.estado ?? "CREADA",
      detalles: {
        id_suficiencia: idSuf,
        folio_num: rHead.rows[0].folio_num,
        no_suficiencia: rHead.rows[0].no_suficiencia,
        id_dgeneral: b.id_dgeneral ?? null,
        id_dauxiliar: b.id_dauxiliar ?? null,
        id_proyecto: b.id_proyecto ?? null,
        id_fuente: b.id_fuente ?? null,
        mes_pago: b.mes_pago ?? null,
        total: total,
        renglones: Array.isArray(b.detalle) ? b.detalle.length : 0,
      },
    });

    return res.json({
      ok: true,
      id: idSuf,
      folio_num: rHead.rows[0].folio_num,
      no_suficiencia: rHead.rows[0].no_suficiencia,
      created_at: full?.created_at ?? null,
      expires_at: full?.expires_at ?? null,
      estado: full?.estado ?? null,
      dias_restantes: full?.dias_restantes ?? null,
      horas_restantes: full?.horas_restantes ?? null,
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

/* =====================================================
  GET /api/suficiencias/perm-ieps-pensiones
   ===================================================== */
router.get("/perm-ieps-pensiones", async (req, res) => {
  try {
    const allowed = await canViewIepsPensiones(req);
    return res.json({ allowed: !!allowed });
  } catch (err) {
    console.error("[GET perm-ieps-pensiones] error:", err);
    return res.status(500).json({ error: "Error al evaluar permisos" });
  }
});

router.get("/dashboards-perm", async (req, res) => {
  try {
    const allowed = await canViewIepsPensiones(req);
    return res.json({ allowed: !!allowed });
  } catch (err) {
    console.error("[GET dashboards-perm] error:", err);
    return res.status(500).json({ error: "Error al evaluar permisos" });
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

    const userIsL00117 = await isUserL00117(req);
    if (role === "AREA" && !userIsL00117) {
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
      SELECT
        id,
        folio_num,
        no_suficiencia,
        fecha,
        id_dgeneral,
        id_dauxiliar,
        created_at,
        expires_at,
        estado,
        dias_restantes,
        horas_restantes
      FROM v_suficiencias_estado
      WHERE ${where.join(" AND ")}
      ORDER BY id DESC
      LIMIT 50
    `;

    const r = await query(sql, params);
    const data = (r.rows || []).map((row) => normalizeSufRow(row));
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("[GET buscar] error:", err);
    return res.status(500).json({
      error: "Error al buscar suficiencia",
      db: err.message,
    });
  }
});

router.post("/:id/cancelar", async (req, res) => {
  const client = await getClient();
  try {
    const role = getRole(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id inválido" });
    }

    const where = [`id = $1`];
    const params = [id];
    let i = 2;

    const userIsL00117 = await isUserL00117(req);
    if (role === "AREA" && !userIsL00117) {
      if (req.user?.id_dgeneral != null) {
        where.push(`id_dgeneral = $${i++}`);
        params.push(req.user.id_dgeneral);
      }
      if (req.user?.id_dauxiliar != null) {
        where.push(`id_dauxiliar = $${i++}`);
        params.push(req.user.id_dauxiliar);
      }
    }

    const cancelReasonRaw = String(req.body?.cancel_reason || "").trim();
    const cancelReason = cancelReasonRaw || null;
    const userId = Number(req.user?.id);
    const cancelUser = Number.isFinite(userId) ? userId : null;

    await client.query("BEGIN");

    const rCur = await client.query(
      `
      SELECT id, cancelled_at
      FROM suficiencias
      WHERE ${where.join(" AND ")}
      LIMIT 1
      FOR UPDATE
      `,
      params,
    );

    if (!rCur.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No encontrada" });
    }

    if (rCur.rows[0].cancelled_at) {
      const rView = await client.query(
        `SELECT * FROM v_suficiencias_estado WHERE id = $1 LIMIT 1`,
        [id],
      );
      await client.query("ROLLBACK");
      const viewRow = normalizeSufRow(rView.rows?.[0] || null);
      await logAuditEvent(req, {
        tipo: "SUFICIENCIA_CANCELAR",
        entidad: "SUFICIENCIAS",
        entidad_id: String(id),
        estado: "YA_CANCELADA",
        detalles: { id_suficiencia: id, cancel_reason: cancelReason },
      });
      return res.json({ ok: true, already: true, ...viewRow });
    }

    const whereUpdate = [`id = $1`];
    const paramsUpdate = [id, cancelUser, cancelReason];
    let j = 4;
    if (role === "AREA" && !userIsL00117) {
      if (req.user?.id_dgeneral != null) {
        whereUpdate.push(`id_dgeneral = $${j++}`);
        paramsUpdate.push(req.user.id_dgeneral);
      }
      if (req.user?.id_dauxiliar != null) {
        whereUpdate.push(`id_dauxiliar = $${j++}`);
        paramsUpdate.push(req.user.id_dauxiliar);
      }
    }

    await client.query(
      `
      UPDATE suficiencias
      SET cancelled_at = NOW(),
          cancelled_by = $2,
          cancel_reason = $3
      WHERE ${whereUpdate.join(" AND ")}
      `,
      paramsUpdate,
    );

    const rView = await client.query(
      `SELECT * FROM v_suficiencias_estado WHERE id = $1 LIMIT 1`,
      [id],
    );

    await client.query("COMMIT");
    const viewRow = normalizeSufRow(rView.rows?.[0] || null);
    await logAuditEvent(req, {
      tipo: "SUFICIENCIA_CANCELAR",
      entidad: "SUFICIENCIAS",
      entidad_id: String(id),
      estado: "CANCELADA",
      detalles: { id_suficiencia: id, cancel_reason: cancelReason },
    });
    return res.json({ ok: true, ...viewRow });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("[POST /api/suficiencias/:id/cancelar] error:", err);
    return res.status(500).json({
      error: "Error al cancelar suficiencia",
      db: err.message,
    });
  } finally {
    client.release();
  }
});

router.get("/historial", async (req, res) => {
  try {
    const role = getRole(req);
    const allowed = role === "GOD" || role === "ADMIN" || (await isUserL00117(req));
    if (!allowed) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const sql = `
      SELECT
        v.id,
        v.no_suficiencia,
        v.estado,
        v.created_at,
        v.expires_at,
        v.dias_restantes,
        v.horas_restantes,
        s.cancel_reason
      FROM v_suficiencias_estado v
      JOIN suficiencias s ON s.id = v.id
      ORDER BY v.created_at DESC
    `;

    const r = await query(sql);
    const data = (r.rows || []).map((row) => normalizeSufRow(row));
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("[GET /api/suficiencias/historial] error:", err);
    return res.status(500).json({
      error: "Error al obtener historial",
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

    const where = [`v.id = $1`];
    const params = [id];
    let i = 2;

    const userIsL00117 = await isUserL00117(req);
    if (role === "AREA" && !userIsL00117) {
      if (req.user?.id_dgeneral != null) {
        where.push(`v.id_dgeneral = $${i++}`);
        params.push(req.user.id_dgeneral);
      }
      if (req.user?.id_dauxiliar != null) {
        where.push(`v.id_dauxiliar = $${i++}`);
        params.push(req.user.id_dauxiliar);
      }
    }

    // 1) Cabecera — JOIN con suficiencias para traer todos los campos financieros y de texto
    const rHead = await query(
      `SELECT v.*,
         s.dependencia, s.departamento, s.fuente, s.mes_pago, s.clave_programatica,
         s.meta, s.impuesto_tipo, s.isr_tasa, s.ieps_tasa,
         s.subtotal, s.iva, s.isr, s.ieps, s.total, s.cantidad_con_letra,
         s.firma_enlace_label, s.firma_enlace_nombre, s.firma_area_label,
         s.firma_area_nombre, s.firma_direccion_nombre, s.cancel_reason,
         s.id_proyecto, s.id_fuente
       FROM v_suficiencias_estado v
       JOIN suficiencias s ON s.id = v.id
       WHERE ${where.join(" AND ")}
       LIMIT 1`,
      params,
    );

    if (!rHead.rows.length) {
      return res.status(404).json({ error: "No encontrada" });
    }

    const headRaw = normalizeSufRow(rHead.rows[0]);
    const allowIEPSPensiones = await canViewIepsPensiones(req);
    const head = allowIEPSPensiones
      ? headRaw
      : sanitizeFinancialFieldsForLimitedView(headRaw);

    // 2) Detalle
    const rDet = await query(
      `SELECT renglon, clave, concepto_partida, justificacion, descripcion, importe
       FROM suficiencia_detalle
       WHERE id_suficiencia = $1
       ORDER BY renglon ASC`,
      [id],
    );
    const detalleRows = Array.isArray(rDet.rows) ? rDet.rows : [];
    const allowedMil = await canViewIepsPensiones(req);
    const detalle = allowedMil
      ? detalleRows
      : detalleRows.filter((row) => !isPartidaMilKey(row?.clave));
    if (!allowedMil && detalle.length !== detalleRows.length) {
      await logUnauthorizedPartidasAccess(req, {
        motivo: "PARTIDAS_MIL_SUFI",
        data: { id },
      });
    }
    return res.json({
      ...head,
      detalle,
    });
  } catch (err) {
    console.error("[GET /api/suficiencias/:id] error:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener suficiencia", db: err.message });
  }
});

export default router;
