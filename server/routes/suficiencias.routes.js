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
  computeTotal,
  validateMesPago,
  checkIsUserL00117,
  checkIsUserE00,
  canUseManualTaxes,
  canUsePreviousMonths,
  canViewIepsPensionesByRole,
  canSeeAllAreas,
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
  // Migración 2026-03-24: usar roles en lugar de DG/DA hardcodeado
  return canViewIepsPensionesByRole(req.user);
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

    // ================================
    // PERMISOS POR ROL: validación única antes del loop
    // ADMIN y GOD pueden usar impuestos por cantidad directa y meses anteriores
    // Migración 2026-03-24: reemplaza checkIsUserL00117
    // ================================
    const isL00117ForLote = canUseManualTaxes(req.user);

    // PERMISO DE FECHA MANUAL: solo ADMIN/GOD pueden indicar una fecha personalizada.
    // Para AREA la fecha siempre es la del servidor (se pasa null y el INSERT usa COALESCE con CURRENT_DATE).
    const tienePermisoFechaLote = isL00117ForLote; // misma guardia de rol

    const MESES_LOTE = [
      "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
      "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
    ];
    const mesActualIdxLote = new Date().getMonth(); // 0-based

    await client.query("BEGIN");

    const creadas = [];

    for (const suf of suficiencias) {
      // Determinar fecha efectiva respetando permisos
      const fechaFinalLote = tienePermisoFechaLote && suf.fecha ? suf.fecha : null;
      const fechaBaseRaw = fechaFinalLote ? new Date(fechaFinalLote) : new Date();
      const fechaBase = Number.isNaN(fechaBaseRaw.getTime()) ? new Date() : fechaBaseRaw;

      const anio = String(fechaBase.getFullYear());
      const mes = String(fechaBase.getMonth() + 1).padStart(2, "0");
      const tipo = "SP";
      const prefijo = `ECA-${anio}-${mes}-${tipo}-`;

      // B-3 followup: folios mensuales atómicos vía fn_next_folio.
      // Reemplaza la sequence global fn_next_folio_suficiencia(), que
      // saltaba entre meses al mezclar todos los registros.
      const rConsec = await client.query(
        `SELECT public.fn_next_folio($1, $2, $3) AS next_num`,
        ["SP", fechaBase.getFullYear(), fechaBase.getMonth() + 1]
      );
      const nextNum = String(rConsec.rows[0].next_num).padStart(4, "0");
      const noSuficiencia = `${prefijo}${nextNum}`;

      const departamento = suf.departamento ?? suf.dependencia_aux ?? null;

      // Validación de mes_pago — usa helper centralizado (validateMesPago)
      if (suf.mes_pago && !validateMesPago(suf.mes_pago)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "mes_pago inválido" });
      }

      // Bloqueo de IEPS por cantidad para usuarios sin permiso (lote)
      const iepsEnviadoLote = Number(suf.ieps || 0);
      const iepsTasaEnviadaLote = suf.ieps_tasa != null && String(suf.ieps_tasa).trim() !== "";
      if (!isL00117ForLote && (iepsEnviadoLote > 0 || iepsTasaEnviadaLote)) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          error: "Sin permisos para capturar IEPS (impuestos por cantidad directa). Se requiere rol ADMIN o GOD.",
        });
      }

      // Bloqueo de ISR por cantidad directa para usuarios sin permiso (lote)
      const isrEnviadoLote = Number(suf.isr || 0);
      const isrTasaEnviadaLote = suf.isr_tasa != null && String(suf.isr_tasa).trim() !== "";
      if (!isL00117ForLote && isrEnviadoLote > 0 && !isrTasaEnviadaLote) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          error: "Sin permisos para capturar ISR como monto directo. Se requiere rol ADMIN o GOD.",
        });
      }

      // Bloqueo de Pensión por cantidad directa para usuarios sin permiso (lote)
      const pensionTotalEnviadoLote = Number(suf.pension_total || 0);
      const hayTasasPensionLote = [suf.pension1_tasa, suf.pension2_tasa, suf.pension3_tasa, suf.pension4_tasa, suf.pension5_tasa]
        .some((t) => t != null && String(t).trim() !== "");
      if (!isL00117ForLote && pensionTotalEnviadoLote > 0 && !hayTasasPensionLote) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          error: "Sin permisos para capturar Pensión como monto directo. Se requiere rol ADMIN o GOD.",
        });
      }

      // Bloqueo de meses anteriores para usuarios sin permiso (lote)
      // canUsePreviousMonths === canUseManualTaxes (mismo guard de rol) — se evalúa por separado para mensajes claros
      if (!canUsePreviousMonths(req.user) && suf.mes_pago) {
        const mesSolicitadoIdxLote = MESES_LOTE.indexOf(String(suf.mes_pago).trim().toUpperCase());
        if (mesSolicitadoIdxLote >= 0 && mesSolicitadoIdxLote < mesActualIdxLote) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            error: "Sin permisos para capturar suficiencias con mes de pago de meses anteriores. Se requiere rol ADMIN o GOD.",
          });
        }
      }

      // ================================
      // C-2: VALIDACIÓN DE SALDO POR PARTIDA (lote)
      // ================================
      // Ya estamos dentro del BEGIN del lote. Tomamos lock pesimista
      // sobre cada partida única ANTES de leer saldo, para evitar race
      // condition con otros writes concurrentes.
      const detalleLote = Array.isArray(suf.detalle) ? suf.detalle.filter(d => d.clave && Number(d.importe) > 0) : [];
      if (detalleLote.length > 0) {
        const ejercicioLote = new Date(suf.fecha || Date.now()).getFullYear();
        // Deduplicar partidas para no tomar el mismo lock dos veces en esta iter.
        const partidasLote = [];
        const vistasLote = new Set();
        for (const renglon of detalleLote) {
          const k = String(renglon.clave || "").trim().toUpperCase();
          if (!vistasLote.has(k)) {
            vistasLote.add(k);
            partidasLote.push(k);
          }
        }
        for (const clave of partidasLote) {
          await client.query(
            `SELECT public.fn_lock_partida_para_saldo($1,$2,$3,$4,$5,$6)`,
            [
              Number(suf.id_dgeneral),
              Number(suf.id_dauxiliar),
              Number(suf.id_fuente),
              Number(suf.id_proyecto),
              clave,
              ejercicioLote,
            ]
          );
        }
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
            try { await client.query("ROLLBACK"); } catch {}
            return res.status(400).json({
              error: `Saldo insuficiente — Partida ${clave}: solicitado $${importe.toFixed(2)}, disponible $${saldo.toFixed(2)}`,
              errores_saldo: [{ clave, importe_solicitado: importe, saldo_disponible: saldo,
                                presupuesto_base: Number(rSaldo.rows?.[0]?.presupuesto_base ?? 0) }],
            });
          }
        }
      }

      // BUG-001: cálculo de total centralizado via computeTotal
      let isr_tasa = suf.isr_tasa;
      let ieps_tasa = suf.ieps_tasa;
      let subtotal = normalizeNumber(suf.subtotal);
      let isr = normalizeNumber(suf.isr);
      let ieps = normalizeNumber(suf.ieps);

      if (!allowIEPSPensiones) {
        ieps_tasa = null;
        ieps = 0;
      }

      // BUG-003: partidas mil no aplican IVA — se fuerza a 0
      const esPartidaMilLote = isPartidaMilKey(String(suf.clave_programatica || "").trim());
      const iva = esPartidaMilLote ? 0 : normalizeNumber(suf.iva);

      // Pensiones del lote: normalizar tasas e importes individuales
      const pension_total_lote = allowIEPSPensiones ? normalizeNumber(suf.pension_total) : 0;
      const pension1_tasa_lote = allowIEPSPensiones ? (suf.pension1_tasa ?? null) : null;
      const pension1_lote      = allowIEPSPensiones ? normalizeNumber(suf.pension1) : 0;
      const pension2_tasa_lote = allowIEPSPensiones ? (suf.pension2_tasa ?? null) : null;
      const pension2_lote      = allowIEPSPensiones ? normalizeNumber(suf.pension2) : 0;
      const pension3_tasa_lote = allowIEPSPensiones ? (suf.pension3_tasa ?? null) : null;
      const pension3_lote      = allowIEPSPensiones ? normalizeNumber(suf.pension3) : 0;
      const pension4_tasa_lote = allowIEPSPensiones ? (suf.pension4_tasa ?? null) : null;
      const pension4_lote      = allowIEPSPensiones ? normalizeNumber(suf.pension4) : 0;
      const pension5_tasa_lote = allowIEPSPensiones ? (suf.pension5_tasa ?? null) : null;
      const pension5_lote      = allowIEPSPensiones ? normalizeNumber(suf.pension5) : 0;

      const total = computeTotal(
        { subtotal, iva, isr, ieps, pension_total: pension_total_lote },
        allowIEPSPensiones
      );

      const sqlHead = `
        INSERT INTO suficiencias (
          id_usuario, id_dgeneral, id_dauxiliar, id_proyecto, id_fuente,
          fecha, dependencia, departamento, fuente, mes_pago, clave_programatica,
          meta, impuesto_tipo, isr_tasa, ieps_tasa,
          subtotal, iva, isr, ieps,
          pension_total,
          pension1_tasa, pension1, pension2_tasa, pension2, pension3_tasa, pension3,
          pension4_tasa, pension4, pension5_tasa, pension5,
          total, cantidad_con_letra,
          firma_enlace_label, firma_enlace_nombre, firma_area_label, firma_area_nombre, firma_direccion_nombre,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          COALESCE($6::date, CURRENT_DATE), $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, $19,
          $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32,
          $33, $34, $35, $36, $37,
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
        fechaFinalLote,   // $6 — null para AREA (COALESCE con CURRENT_DATE), fecha manual para ADMIN/GOD
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
        pension_total_lote,                           // $20
        pension1_tasa_lote, pension1_lote,            // $21, $22
        pension2_tasa_lote, pension2_lote,            // $23, $24
        pension3_tasa_lote, pension3_lote,            // $25, $26
        pension4_tasa_lote, pension4_lote,            // $27, $28
        pension5_tasa_lote, pension5_lote,            // $29, $30
        total,                                        // $31
        suf.cantidad_con_letra,                       // $32
        suf.firma_enlace_label ?? null,               // $33
        suf.firma_enlace_nombre ?? null,              // $34
        suf.firma_area_label ?? null,                 // $35
        suf.firma_area_nombre ?? null,                // $36
        suf.firma_direccion_nombre ?? null,           // $37
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
        no_suficiencia: rHead.rows[0].no_suficiencia || noSuficiencia,
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
    return res.status(500).json({ error: "Error al guardar lote de suficiencias" });
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

    // ================================
    // PERMISO DE FECHA MANUAL (ADMIN/GOD únicamente)
    // Si el usuario no es ADMIN ni GOD, se ignora cualquier fecha enviada
    // y se usa la fecha actual del servidor.
    // ================================
    const tienePermisoFecha = canUseManualTaxes(req.user); // misma guardia de rol: ADMIN o GOD

    const fechaBaseRaw = tienePermisoFecha && b.fecha ? new Date(b.fecha) : new Date();
    const fechaBase = Number.isNaN(fechaBaseRaw.getTime())
      ? new Date()
      : fechaBaseRaw;

    // Sobreescribir b.fecha con el valor seguro (AREA no puede imponer fecha)
    const fechaFinal = tienePermisoFecha && b.fecha ? b.fecha : null; // null = NOW() en el INSERT

    const anio = String(fechaBase.getFullYear());
    const mes = String(fechaBase.getMonth() + 1).padStart(2, "0");
    const tipo = "SP";
    const prefijo = `ECA-${anio}-${mes}-${tipo}-`;

    const departamento = b.departamento ?? b.dependencia_aux ?? null;

    // Validación de mes_pago — usa helper centralizado (validateMesPago)
    if (b.mes_pago && !validateMesPago(b.mes_pago)) {
      return res.status(400).json({ error: "mes_pago inválido" });
    }

    // ================================
    // PERMISOS POR ROL: IEPS, ISR, PENSIÓN (por cantidad) y MESES ANTERIORES
    // ADMIN y GOD pueden usar impuestos por cantidad directa y meses anteriores
    // Migración 2026-03-24: reemplaza checkIsUserL00117
    // ================================
    const tienePermisoImpuestos = canUseManualTaxes(req.user);

    // Bloqueo de IEPS por cantidad para usuarios sin permiso
    const iepsEnviado = Number(b.ieps || 0);
    const iepsTasaEnviada = b.ieps_tasa != null && String(b.ieps_tasa).trim() !== "";
    if (!tienePermisoImpuestos && (iepsEnviado > 0 || iepsTasaEnviada)) {
      return res.status(403).json({
        error: "Sin permisos para capturar IEPS (impuestos por cantidad directa). Se requiere rol ADMIN o GOD.",
      });
    }

    // Bloqueo de ISR por cantidad directa para usuarios sin permiso
    // (ISR por tasa de porcentaje sí está permitida para todos; solo bloqueamos
    //  cuando isr_tasa es null/vacío pero isr > 0, lo que indica captura por monto directo)
    const isrEnviado = Number(b.isr || 0);
    const isrTasaEnviada = b.isr_tasa != null && String(b.isr_tasa).trim() !== "";
    if (!tienePermisoImpuestos && isrEnviado > 0 && !isrTasaEnviada) {
      return res.status(403).json({
        error: "Sin permisos para capturar ISR como monto directo. Se requiere rol ADMIN o GOD.",
      });
    }

    // Bloqueo de Pensión por cantidad directa para usuarios sin permiso
    const pensionTotalEnviado = Number(b.pension_total || 0);
    const hayTasasPension = [b.pension1_tasa, b.pension2_tasa, b.pension3_tasa, b.pension4_tasa, b.pension5_tasa]
      .some((t) => t != null && String(t).trim() !== "");
    if (!tienePermisoImpuestos && pensionTotalEnviado > 0 && !hayTasasPension) {
      return res.status(403).json({
        error: "Sin permisos para capturar Pensión como monto directo. Se requiere rol ADMIN o GOD.",
      });
    }

    // Bloqueo de meses anteriores para usuarios sin permiso
    if (!canUsePreviousMonths(req.user) && b.mes_pago) {
      const MESES = [
        "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
        "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
      ];
      const mesSolicitadoIdx = MESES.indexOf(String(b.mes_pago).trim().toUpperCase());
      const mesActualIdx = new Date().getMonth(); // 0-based
      if (mesSolicitadoIdx >= 0 && mesSolicitadoIdx < mesActualIdx) {
        return res.status(403).json({
          error: "Sin permisos para capturar suficiencias con mes de pago de meses anteriores. Se requiere rol ADMIN o GOD.",
        });
      }
    }

    // ================================
    // C-2: la validación de saldo se hace DENTRO de la transacción
    // tras adquirir el lock pesimista por partida (fn_lock_partida_para_saldo).
    // Esto cierra la race condition donde dos requests concurrentes leían
    // el mismo saldo antes de insertar.
    // ================================

    await client.query("BEGIN");

    const detalleValidar = Array.isArray(b.detalle) ? b.detalle.filter(d => d.clave && Number(d.importe) > 0) : [];
    if (detalleValidar.length > 0) {
      const ejercicioVal = new Date(b.fecha || Date.now()).getFullYear();
      const erroresSaldo = [];
      // Deduplicar partidas para no tomar el mismo lock dos veces.
      const partidasUnicas = [];
      const vistas = new Set();
      for (const renglon of detalleValidar) {
        const k = String(renglon.clave || "").trim().toUpperCase();
        if (!vistas.has(k)) {
          vistas.add(k);
          partidasUnicas.push(k);
        }
      }
      // 1) Lock pesimista por cada partida única ANTES de leer saldo.
      for (const clave of partidasUnicas) {
        await client.query(
          `SELECT public.fn_lock_partida_para_saldo($1,$2,$3,$4,$5,$6)`,
          [
            Number(b.id_dgeneral),
            Number(b.id_dauxiliar),
            Number(b.id_fuente),
            Number(b.id_proyecto),
            clave,
            ejercicioVal,
          ]
        );
      }
      // 2) Validar saldo de cada renglón dentro de la misma tx.
      for (const renglon of detalleValidar) {
        const clave = String(renglon.clave || "").trim().toUpperCase();
        const importe = Number(renglon.importe || 0);
        const rSaldo = await client.query(
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
        try { await client.query("ROLLBACK"); } catch {}
        const detalleErr = erroresSaldo.map(e =>
          `Partida ${e.clave}: solicitado $${e.importe_solicitado.toFixed(2)}, disponible $${e.saldo_disponible.toFixed(2)}`
        ).join("; ");
        return res.status(400).json({
          error: `Saldo insuficiente en partida(s): ${detalleErr}`,
          errores_saldo: erroresSaldo,
        });
      }
    }

    // B-3 followup: folios mensuales atómicos vía fn_next_folio.
    // Sustituye fn_next_folio_suficiencia() (sequence global). El prefijo
    // string del folio sigue siendo "SP" y el formato ECA-YYYY-MM-SP-NNNN.
    const anioFolio = fechaBase.getFullYear();
    const mesFolio = fechaBase.getMonth() + 1;
    const rConsec = await client.query(
      `SELECT public.fn_next_folio($1, $2, $3) AS next_num`,
      ["SP", anioFolio, mesFolio]
    );
    const nextNum = String(rConsec.rows[0].next_num).padStart(4, "0");
    const noSuficiencia = `${prefijo}${nextNum}`;

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

    pension_total,
    pension1_tasa, pension1,
    pension2_tasa, pension2,
    pension3_tasa, pension3,
    pension4_tasa, pension4,
    pension5_tasa, pension5,

    total,
    cantidad_con_letra,
    firma_enlace_label, firma_enlace_nombre, firma_area_label, firma_area_nombre, firma_direccion_nombre,
    created_at
  )
  VALUES (
    $1, $2, $3, $4, $5,
    COALESCE($6::date, CURRENT_DATE), $7, $8, $9, $10, $11,
    $12, $13, $14, $15, $16, $17, $18, $19,
    $20,
    $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
    $31, $32,
    $33, $34, $35, $36, $37,
    NOW()
  )
  RETURNING id, folio_num, no_suficiencia;
`;

    // Permisos IEPS/Pensiones: si no está permitido, se fuerzan valores seguros
    // BUG-001: cálculo de total centralizado via computeTotal
    let isr_tasa = b.isr_tasa;
    let ieps_tasa = b.ieps_tasa;
    let subtotal = normalizeNumber(b.subtotal);
    let isr = normalizeNumber(b.isr);
    let ieps = normalizeNumber(b.ieps);

    if (!allowIEPSPensiones) {
      ieps_tasa = null;
      ieps = 0;
    }

    // BUG-003: partidas mil no aplican IVA — se fuerza a 0
    const esPartidaMil = isPartidaMilKey(String(b.clave_programatica || "").trim());
    const iva = esPartidaMil ? 0 : normalizeNumber(b.iva);

    // Pensiones: normalizar tasas e importes individuales
    const pension_total = allowIEPSPensiones ? normalizeNumber(b.pension_total) : 0;
    const pension1_tasa = allowIEPSPensiones ? (b.pension1_tasa ?? null) : null;
    const pension1     = allowIEPSPensiones ? normalizeNumber(b.pension1) : 0;
    const pension2_tasa = allowIEPSPensiones ? (b.pension2_tasa ?? null) : null;
    const pension2     = allowIEPSPensiones ? normalizeNumber(b.pension2) : 0;
    const pension3_tasa = allowIEPSPensiones ? (b.pension3_tasa ?? null) : null;
    const pension3     = allowIEPSPensiones ? normalizeNumber(b.pension3) : 0;
    const pension4_tasa = allowIEPSPensiones ? (b.pension4_tasa ?? null) : null;
    const pension4     = allowIEPSPensiones ? normalizeNumber(b.pension4) : 0;
    const pension5_tasa = allowIEPSPensiones ? (b.pension5_tasa ?? null) : null;
    const pension5     = allowIEPSPensiones ? normalizeNumber(b.pension5) : 0;

    const total = computeTotal(
      { subtotal, iva, isr, ieps, pension_total },
      allowIEPSPensiones
    );

    const headParams = [
      req.user.id,
      b.id_dgeneral,
      b.id_dauxiliar,
      b.id_proyecto,
      b.id_fuente,

      fechaFinal,   // $6 — null para AREA (usará CURRENT_DATE por COALESCE), fecha manual para ADMIN/GOD
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

      pension_total,                            // $20
      pension1_tasa, pension1,                  // $21, $22
      pension2_tasa, pension2,                  // $23, $24
      pension3_tasa, pension3,                  // $25, $26
      pension4_tasa, pension4,                  // $27, $28
      pension5_tasa, pension5,                  // $29, $30

      total,                                    // $31
      b.cantidad_con_letra,                     // $32
      b.firma_enlace_label ?? null,             // $33
      b.firma_enlace_nombre ?? null,            // $34
      b.firma_area_label ?? null,               // $35
      b.firma_area_nombre ?? null,              // $36
      b.firma_direccion_nombre ?? null,         // $37
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
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[POST suficiencias] error:", err);
    return res.status(500).json({
      error: "Error al guardar suficiencia",
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

    // Migración 2026-03-24: ADMIN y GOD pueden ver todas las áreas
    if (role === "AREA" && !canSeeAllAreas(req.user)) {
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

    // =====================================================
    //  Hallazgo B-2: userIsL00117 estaba undefined.
    // =====================================================
    // En el bloque whereUpdate (más abajo) se referenciaba a una
    // variable que nunca se inicializaba. Calculamos aquí el flag
    // y alineamos con el patrón del resto del handler (canSeeAllAreas
    // como guard primario; userIsL00117 como salvaguarda para los
    // usuarios legítimamente L00/117 que aún no estén marcados
    // ADMIN/GOD).
    const userIsL00117 = await checkIsUserL00117(req);

    const where = [`id = $1`];
    const params = [id];
    let i = 2;

    // Migración 2026-03-24: ADMIN y GOD pueden cancelar suficiencias de cualquier área.
    // Si por algún motivo el flag canSeeAllAreas dice false pero el usuario
    // pertenece a L00/117, también se le permite (compatibilidad histórica).
    if (role === "AREA" && !canSeeAllAreas(req.user) && !userIsL00117) {
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
    // Mismo guard que la query SELECT de arriba (B-2 fix).
    if (role === "AREA" && !canSeeAllAreas(req.user) && !userIsL00117) {
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
    });
  } finally {
    client.release();
  }
});

router.get("/historial", async (req, res) => {
  try {
    // Migración 2026-03-24: ADMIN y GOD pueden acceder al historial completo
    const allowed = canSeeAllAreas(req.user);
    if (!allowed) {
      return res.status(403).json({ error: "No autorizado. Se requiere rol ADMIN o GOD para acceder al historial." });
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

    // Migración 2026-03-24: ADMIN y GOD pueden ver suficiencias de cualquier área
    if (role === "AREA" && !canSeeAllAreas(req.user)) {
      if (req.user?.id_dgeneral != null) {
        where.push(`v.id_dgeneral = $${i++}`);
        params.push(req.user.id_dgeneral);
      }
      if (req.user?.id_dauxiliar != null) {
        where.push(`v.id_dauxiliar = $${i++}`);
        params.push(req.user.id_dauxiliar);
      }
    }

    // 1) Cabecera — JOIN solo para agregar firma_* que no están en la vista
    const rHead = await query(
      `SELECT v.*,
         s.firma_enlace_label, s.firma_enlace_nombre, s.firma_area_label,
         s.firma_area_nombre, s.firma_direccion_nombre
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
      .json({ error: "Error al obtener suficiencia" });
  }
});

export default router;
