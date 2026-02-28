import { Router } from "express";
import { query } from "../db.js";

const router = Router();
const ALLOWED_DG = "L00";
const ALLOWED_DA = "117";

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
}

function hasAccess(dg, da) {
  return normalizeKey(dg) === ALLOWED_DG && normalizeKey(da) === ALLOWED_DA;
}

async function getUserDGDA(req) {
  const idDg = Number(req.user?.id_dgeneral);
  const idDa = Number(req.user?.id_dauxiliar);

  const k = await query(
    `
    SELECT
      (SELECT TRIM(clave) FROM public.dgeneral WHERE id = $1) AS dg,
      (SELECT TRIM(clave) FROM public.dauxiliar WHERE id = $2) AS da
    `,
    [idDg, idDa],
  );

  return {
    dg: String(k.rows?.[0]?.dg || "").trim(),
    da: String(k.rows?.[0]?.da || "").trim(),
  };
}

function parseIntParam(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

function normalizePartida(value) {
  const raw = String(value ?? "").trim();
  const clean = raw.replace(/[^\d]/g, "");
  return clean || null;
}

function endOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function buildPeriodConfig(periodoRaw, anioRaw, segmentoRaw) {
  const now = new Date();
  const periodoNorm = normalizeKey(periodoRaw || "ANUAL");
  const periodoAllowed = [
    "ANUAL",
    "MENSUAL",
    "BIMESTRAL",
    "TRIMESTRAL",
    "SEMESTRAL",
  ];
  const periodo = periodoAllowed.includes(periodoNorm) ? periodoNorm : "ANUAL";

  const anio =
    Number.isFinite(parseIntParam(anioRaw)) && parseIntParam(anioRaw) >= 2000
      ? parseIntParam(anioRaw)
      : now.getFullYear();

  const maxSegmento = {
    ANUAL: 1,
    MENSUAL: 12,
    BIMESTRAL: 6,
    TRIMESTRAL: 4,
    SEMESTRAL: 2,
  };
  const defSegmento = periodo === "MENSUAL" ? now.getMonth() + 1 : 1;
  let segmento = parseIntParam(segmentoRaw) || defSegmento;
  const max = maxSegmento[periodo] || 1;
  if (segmento < 1) segmento = 1;
  if (segmento > max) segmento = max;

  let months = [];
  if (periodo === "ANUAL") {
    months = Array.from({ length: 12 }, (_, i) => i + 1);
  } else if (periodo === "MENSUAL") {
    months = [segmento];
  } else if (periodo === "BIMESTRAL") {
    const start = (segmento - 1) * 2 + 1;
    months = [start, start + 1];
  } else if (periodo === "TRIMESTRAL") {
    const start = (segmento - 1) * 3 + 1;
    months = [start, start + 1, start + 2];
  } else if (periodo === "SEMESTRAL") {
    const start = (segmento - 1) * 6 + 1;
    months = [start, start + 1, start + 2, start + 3, start + 4, start + 5];
  }

  const startMonth = months[0] || 1;
  const endMonth = months[months.length - 1] || 12;
  const startDate = `${anio}-${String(startMonth).padStart(2, "0")}-01`;
  const lastDay = endOfMonth(anio, endMonth);
  const endDate = `${anio}-${String(endMonth).padStart(2, "0")}-${String(
    lastDay,
  ).padStart(2, "0")}`;

  return { periodo, anio, segmento, months, startDate, endDate };
}

function buildMonthSumExpr(months) {
  const map = {
    1: "ene",
    2: "feb",
    3: "mar",
    4: "abr",
    5: "may",
    6: "jun",
    7: "jul",
    8: "ago",
    9: "sep",
    10: "oct",
    11: "nov",
    12: "dic",
  };
  const parts = months
    .map((m) => map[m])
    .filter(Boolean)
    .map((col) => `COALESCE(pbp.${col}, 0)`);
  if (!parts.length) return "0";
  return parts.join(" + ");
}

function capituloExpr(field) {
  const clean = `NULLIF(regexp_replace(${field}, '\\\\D', '', 'g'), '')`;
  return `CASE WHEN ${clean} IS NULL THEN NULL ELSE FLOOR((${clean}::int) / 1000) * 1000 END`;
}

router.get("/partidas-resumen", async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const { dg, da } = await getUserDGDA(req);
    if (!hasAccess(dg, da)) {
      return res.status(403).json({
        error: "Acceso denegado. Solo DG L00 con DA 117 puede acceder.",
      });
    }

    const { periodo, anio, segmento, months, startDate, endDate } =
      buildPeriodConfig(req.query?.periodo, req.query?.anio, req.query?.segmento);

    const idDgeneral = parseIntParam(req.query?.id_dgeneral);
    const dgClave = normalizeKey(req.query?.dg_clave);
    const idDauxiliar = parseIntParam(req.query?.id_dauxiliar);
    const partida = normalizePartida(req.query?.partida);
    const capitulo = parseIntParam(req.query?.capitulo);

    const params = [];
    let idx = 1;
    const addParam = (v) => {
      params.push(v);
      return `$${idx++}`;
    };

    const startParam = addParam(startDate);
    const endParam = addParam(endDate);
    const anioParam = addParam(anio);
    const dgParam = Number.isFinite(idDgeneral) && !dgClave ? addParam(idDgeneral) : null;
    const dgClaveParam = dgClave ? addParam(dgClave) : null;
    const daParam = Number.isFinite(idDauxiliar) ? addParam(idDauxiliar) : null;
    const partidaParam = partida ? addParam(partida) : null;
    const capParam = Number.isFinite(capitulo) ? addParam(capitulo) : null;

    const pbpWhere = [
      `pbp.ejercicio = ${anioParam}`,
      dgParam ? `pbp.id_dgeneral = ${dgParam}` : null,
      dgClaveParam
        ? `pbp.id_dgeneral IN (SELECT id FROM public.dgeneral WHERE TRIM(clave) = ${dgClaveParam})`
        : null,
      daParam ? `pbp.id_dauxiliar = ${daParam}` : null,
      partidaParam ? `TRIM(pa.clave) = ${partidaParam}` : null,
    ].filter(Boolean);

    const dateFilter = (alias) =>
      `COALESCE(${alias}.fecha, ${alias}.created_at)::date BETWEEN ${startParam} AND ${endParam}`;
    const dgFilter = (alias) => {
      if (dgParam) return `AND ${alias}.id_dgeneral = ${dgParam}`;
      if (dgClaveParam) {
        return `AND ${alias}.id_dgeneral IN (SELECT id FROM public.dgeneral WHERE TRIM(clave) = ${dgClaveParam})`;
      }
      return "";
    };
    const daFilter = (alias) =>
      daParam ? `AND ${alias}.id_dauxiliar = ${daParam}` : "";
    const partidaFilter = (alias, field) =>
      partidaParam ? `AND TRIM(${alias}.${field}) = ${partidaParam}` : "";

    const monthSumExpr = buildMonthSumExpr(months);
    const capituloPartida = capituloExpr("pa.clave");
    const capituloSuf = capituloExpr("sd.clave");
    const capituloComp = capituloExpr("cd.clave");
    const capituloDev = capituloExpr("dd.clave");
    const capituloRecon = capituloExpr("pa.clave");

    const sql = `
      WITH presupuesto AS (
        SELECT
          COALESCE(${capituloPartida}, 0) AS capitulo,
          SUM(${monthSumExpr}) AS presupuesto
        FROM public.presupuesto_base_partidas pbp
        JOIN public.partidas pa ON pa.id = pbp.id_partida
        ${pbpWhere.length ? `WHERE ${pbpWhere.join(" AND ")}` : ""}
        GROUP BY COALESCE(${capituloPartida}, 0)
      ),
      suficiencia AS (
        SELECT
          COALESCE(${capituloSuf}, 0) AS capitulo,
          SUM(sd.importe) AS suficiencia
        FROM public.suficiencia_detalle sd
        JOIN public.suficiencias s ON s.id = sd.id_suficiencia
        JOIN public.v_suficiencias_estado vs ON vs.id = s.id
        WHERE vs.estado = 'ACTIVO'
          AND ${dateFilter("s")}
          ${dgFilter("s")}
          ${daFilter("s")}
          ${partidaFilter("sd", "clave")}
        GROUP BY COALESCE(${capituloSuf}, 0)
      ),
      comprometido AS (
        SELECT
          COALESCE(${capituloComp}, 0) AS capitulo,
          SUM(cd.importe) AS comprometido
        FROM public.comprometido_detalle cd
        JOIN public.comprometidos c ON c.id = cd.id_comprometido
        WHERE COALESCE(c.estatus, 'ACTIVO') <> 'CANCELADO'
          AND ${dateFilter("c")}
          ${dgFilter("c")}
          ${daFilter("c")}
          ${partidaFilter("cd", "clave")}
        GROUP BY COALESCE(${capituloComp}, 0)
      ),
      devengado AS (
        SELECT
          COALESCE(${capituloDev}, 0) AS capitulo,
          SUM(dd.importe) AS devengado
        FROM public.devengado_detalle dd
        JOIN public.devengados d ON d.id = dd.id_devengado
        WHERE COALESCE(d.estatus, 'ACTIVO') <> 'CANCELADO'
          AND ${dateFilter("d")}
          ${dgFilter("d")}
          ${daFilter("d")}
          ${partidaFilter("dd", "clave")}
        GROUP BY COALESCE(${capituloDev}, 0)
      ),
      reconducciones AS (
        SELECT
          COALESCE(${capituloRecon}, 0) AS capitulo,
          SUM(rm.monto) AS reconducciones
        FROM public.reconducciones_movimientos rm
        JOIN public.reconducciones r ON r.id = rm.id_reconduccion
        LEFT JOIN public.partidas pa ON pa.id = rm.id_partida
        WHERE r.estatus = 'APLICADO'
          AND COALESCE(rm.mes_pago_date, r.aplicado_at, r.created_at)::date BETWEEN ${startParam} AND ${endParam}
          ${dgFilter("rm")}
          ${daFilter("rm")}
          ${partidaFilter("pa", "clave")}
        GROUP BY COALESCE(${capituloRecon}, 0)
      ),
      base AS (
        SELECT capitulo FROM presupuesto
        UNION
        SELECT capitulo FROM suficiencia
        UNION
        SELECT capitulo FROM comprometido
        UNION
        SELECT capitulo FROM devengado
        UNION
        SELECT capitulo FROM reconducciones
      )
      SELECT
        b.capitulo,
        COALESCE(p.presupuesto, 0) AS presupuesto,
        COALESCE(s.suficiencia, 0) AS suficiencia,
        COALESCE(c.comprometido, 0) AS comprometido,
        COALESCE(d.devengado, 0) AS devengado,
        COALESCE(rm.reconducciones, 0) AS reconducciones,
        COALESCE(p.presupuesto, 0) - COALESCE(c.comprometido, 0) - COALESCE(d.devengado, 0) AS saldo_disponible,
        CASE
          WHEN COALESCE(p.presupuesto, 0) > 0
            THEN COALESCE(d.devengado, 0) / COALESCE(p.presupuesto, 0)
          ELSE 0
        END AS porcentaje_ejercido
      FROM base b
      LEFT JOIN presupuesto p ON p.capitulo = b.capitulo
      LEFT JOIN suficiencia s ON s.capitulo = b.capitulo
      LEFT JOIN comprometido c ON c.capitulo = b.capitulo
      LEFT JOIN devengado d ON d.capitulo = b.capitulo
      LEFT JOIN reconducciones rm ON rm.capitulo = b.capitulo
      ${capParam ? `WHERE b.capitulo = ${capParam}` : ""}
      ORDER BY b.capitulo;
    `;

    const result = await query(sql, params);

    const totals = result.rows.reduce(
      (acc, row) => {
        acc.presupuesto += Number(row.presupuesto || 0);
        acc.suficiencia += Number(row.suficiencia || 0);
        acc.comprometido += Number(row.comprometido || 0);
        acc.devengado += Number(row.devengado || 0);
        acc.reconducciones += Number(row.reconducciones || 0);
        return acc;
      },
      {
        presupuesto: 0,
        suficiencia: 0,
        comprometido: 0,
        devengado: 0,
        reconducciones: 0,
      },
    );
    const saldoDisponible =
      totals.presupuesto - totals.comprometido - totals.devengado;

    return res.json({
      filtros: { periodo, anio, segmento, startDate, endDate },
      kpis: {
        presupuesto: totals.presupuesto,
        suficiencia: totals.suficiencia,
        comprometido: totals.comprometido,
        devengado: totals.devengado,
        reconducciones: totals.reconducciones,
        saldo_disponible: saldoDisponible,
      },
      rows: result.rows,
    });
  } catch (error) {
    console.error("[DASHBOARD_PARTIDAS][RESUMEN]", error);
    return res.status(500).json({ error: "Error al obtener resumen" });
  }
});

router.get("/partidas-detalle", async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const { dg, da } = await getUserDGDA(req);
    if (!hasAccess(dg, da)) {
      return res.status(403).json({
        error: "Acceso denegado. Solo DG L00 con DA 117 puede acceder.",
      });
    }

    const capitulo = parseIntParam(req.query?.capitulo);
    if (!Number.isFinite(capitulo)) {
      return res.status(400).json({ error: "Capitulo requerido" });
    }

    const { periodo, anio, segmento, months, startDate, endDate } =
      buildPeriodConfig(req.query?.periodo, req.query?.anio, req.query?.segmento);

    const idDgeneral = parseIntParam(req.query?.id_dgeneral);
    const dgClave = normalizeKey(req.query?.dg_clave);
    const idDauxiliar = parseIntParam(req.query?.id_dauxiliar);
    const partida = normalizePartida(req.query?.partida);

    const params = [];
    let idx = 1;
    const addParam = (v) => {
      params.push(v);
      return `$${idx++}`;
    };

    const startParam = addParam(startDate);
    const endParam = addParam(endDate);
    const anioParam = addParam(anio);
    const capParam = addParam(capitulo);
    const dgParam = Number.isFinite(idDgeneral) && !dgClave ? addParam(idDgeneral) : null;
    const dgClaveParam = dgClave ? addParam(dgClave) : null;
    const daParam = Number.isFinite(idDauxiliar) ? addParam(idDauxiliar) : null;
    const partidaParam = partida ? addParam(partida) : null;

    const pbpWhere = [
      `pbp.ejercicio = ${anioParam}`,
      dgParam ? `pbp.id_dgeneral = ${dgParam}` : null,
      dgClaveParam
        ? `pbp.id_dgeneral IN (SELECT id FROM public.dgeneral WHERE TRIM(clave) = ${dgClaveParam})`
        : null,
      daParam ? `pbp.id_dauxiliar = ${daParam}` : null,
      partidaParam ? `TRIM(pa.clave) = ${partidaParam}` : null,
    ].filter(Boolean);

    const dateFilter = (alias) =>
      `COALESCE(${alias}.fecha, ${alias}.created_at)::date BETWEEN ${startParam} AND ${endParam}`;
    const dgFilter = (alias) => {
      if (dgParam) return `AND ${alias}.id_dgeneral = ${dgParam}`;
      if (dgClaveParam) {
        return `AND ${alias}.id_dgeneral IN (SELECT id FROM public.dgeneral WHERE TRIM(clave) = ${dgClaveParam})`;
      }
      return "";
    };
    const daFilter = (alias) =>
      daParam ? `AND ${alias}.id_dauxiliar = ${daParam}` : "";
    const partidaFilter = (alias, field) =>
      partidaParam ? `AND TRIM(${alias}.${field}) = ${partidaParam}` : "";

    const monthSumExpr = buildMonthSumExpr(months);
    const capituloField = capituloExpr("b.clave");

    const sql = `
      WITH presupuesto AS (
        SELECT
          TRIM(pa.clave) AS clave,
          COALESCE(pa.descripcion, 'SIN DESCRIPCION') AS descripcion,
          SUM(${monthSumExpr}) AS presupuesto
        FROM public.presupuesto_base_partidas pbp
        JOIN public.partidas pa ON pa.id = pbp.id_partida
        ${pbpWhere.length ? `WHERE ${pbpWhere.join(" AND ")}` : ""}
        GROUP BY TRIM(pa.clave), COALESCE(pa.descripcion, 'SIN DESCRIPCION')
      ),
      suficiencia AS (
        SELECT
          TRIM(sd.clave) AS clave,
          SUM(sd.importe) AS suficiencia
        FROM public.suficiencia_detalle sd
        JOIN public.suficiencias s ON s.id = sd.id_suficiencia
        JOIN public.v_suficiencias_estado vs ON vs.id = s.id
        WHERE vs.estado = 'ACTIVO'
          AND ${dateFilter("s")}
          ${dgFilter("s")}
          ${daFilter("s")}
          ${partidaFilter("sd", "clave")}
        GROUP BY TRIM(sd.clave)
      ),
      comprometido AS (
        SELECT
          TRIM(cd.clave) AS clave,
          SUM(cd.importe) AS comprometido
        FROM public.comprometido_detalle cd
        JOIN public.comprometidos c ON c.id = cd.id_comprometido
        WHERE COALESCE(c.estatus, 'ACTIVO') <> 'CANCELADO'
          AND ${dateFilter("c")}
          ${dgFilter("c")}
          ${daFilter("c")}
          ${partidaFilter("cd", "clave")}
        GROUP BY TRIM(cd.clave)
      ),
      devengado AS (
        SELECT
          TRIM(dd.clave) AS clave,
          SUM(dd.importe) AS devengado
        FROM public.devengado_detalle dd
        JOIN public.devengados d ON d.id = dd.id_devengado
        WHERE COALESCE(d.estatus, 'ACTIVO') <> 'CANCELADO'
          AND ${dateFilter("d")}
          ${dgFilter("d")}
          ${daFilter("d")}
          ${partidaFilter("dd", "clave")}
        GROUP BY TRIM(dd.clave)
      ),
      reconducciones AS (
        SELECT
          TRIM(pa.clave) AS clave,
          SUM(rm.monto) AS reconducciones
        FROM public.reconducciones_movimientos rm
        JOIN public.reconducciones r ON r.id = rm.id_reconduccion
        LEFT JOIN public.partidas pa ON pa.id = rm.id_partida
        WHERE r.estatus = 'APLICADO'
          AND COALESCE(rm.mes_pago_date, r.aplicado_at, r.created_at)::date BETWEEN ${startParam} AND ${endParam}
          ${dgFilter("rm")}
          ${daFilter("rm")}
          ${partidaFilter("pa", "clave")}
        GROUP BY TRIM(pa.clave)
      ),
      base AS (
        SELECT clave FROM presupuesto
        UNION
        SELECT clave FROM suficiencia
        UNION
        SELECT clave FROM comprometido
        UNION
        SELECT clave FROM devengado
        UNION
        SELECT clave FROM reconducciones
      )
      SELECT
        b.clave,
        COALESCE(p.descripcion, 'SIN DESCRIPCION') AS descripcion,
        COALESCE(p.presupuesto, 0) AS presupuesto,
        COALESCE(s.suficiencia, 0) AS suficiencia,
        COALESCE(c.comprometido, 0) AS comprometido,
        COALESCE(d.devengado, 0) AS devengado,
        COALESCE(rm.reconducciones, 0) AS reconducciones,
        COALESCE(p.presupuesto, 0) - COALESCE(c.comprometido, 0) - COALESCE(d.devengado, 0) AS saldo_disponible,
        CASE
          WHEN COALESCE(p.presupuesto, 0) > 0
            THEN COALESCE(d.devengado, 0) / COALESCE(p.presupuesto, 0)
          ELSE 0
        END AS porcentaje_ejercido,
        COALESCE(${capituloField}, 0) AS capitulo
      FROM base b
      LEFT JOIN presupuesto p ON p.clave = b.clave
      LEFT JOIN suficiencia s ON s.clave = b.clave
      LEFT JOIN comprometido c ON c.clave = b.clave
      LEFT JOIN devengado d ON d.clave = b.clave
      LEFT JOIN reconducciones rm ON rm.clave = b.clave
      WHERE COALESCE(${capituloField}, 0) = ${capParam}
      ORDER BY b.clave::text;
    `;

    const result = await query(sql, params);
    return res.json({
      filtros: { periodo, anio, segmento, startDate, endDate, capitulo },
      rows: result.rows,
    });
  } catch (error) {
    console.error("[DASHBOARD_PARTIDAS][DETALLE]", error);
    return res.status(500).json({ error: "Error al obtener detalle" });
  }
});

export default router;
