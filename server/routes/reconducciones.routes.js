import express from "express";
import crypto from "crypto";
import { query, getClient } from "../db.js";
import { computeSaldo, getActorId, logAuditEvent } from "../utils/helpers.js";

const router = express.Router();

function getRole(req) {
  const roles = (req.user?.roles || []).map((r) => String(r).toUpperCase());
  if (roles.includes("GOD")) return "GOD";
  if (roles.includes("ADMIN")) return "ADMIN";
  return "AREA";
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

function canSeeAllAreas(role, isL00117) {
  return role !== "AREA" || isL00117;
}

function normalizeClave(input) {
  return String(input ?? "").trim().toUpperCase();
}

async function getUserAreaClaves(req) {
  const ids = getAreaIds(req);
  if (!ids) return null;
  const [rDg, rDa] = await Promise.all([
    query(`SELECT clave FROM dgeneral WHERE id = $1 LIMIT 1`, [ids.idDg]),
    query(`SELECT clave FROM dauxiliar WHERE id = $1 LIMIT 1`, [ids.idDa]),
  ]);
  const dg = normalizeClave(rDg.rows?.[0]?.clave || "");
  const da = normalizeClave(rDa.rows?.[0]?.clave || "");
  if (!dg || !da) return null;
  return { dg, da };
}

function buildClave() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function ensureReconClaveTable(client = null) {
  const q = `
    CREATE TABLE IF NOT EXISTS public.reconducciones_claves (
      id serial PRIMARY KEY,
      clave varchar(6) NOT NULL,
      dg_clave varchar(3) NOT NULL,
      da_clave varchar(3) NOT NULL,
      created_at timestamp without time zone NOT NULL DEFAULT NOW(),
      created_by integer,
      status varchar(10) NOT NULL DEFAULT 'ACTIVA',
      used_at timestamp without time zone,
      used_by integer
    )
  `;
  if (client) {
    await client.query(q);
    await client.query(
      `ALTER TABLE public.reconducciones_claves ADD COLUMN IF NOT EXISTS dg_clave varchar(3) NOT NULL DEFAULT ''`
    );
    await client.query(
      `ALTER TABLE public.reconducciones_claves ADD COLUMN IF NOT EXISTS da_clave varchar(3) NOT NULL DEFAULT ''`
    );
    await client.query(
      `ALTER TABLE public.reconducciones_claves ADD COLUMN IF NOT EXISTS status varchar(10) NOT NULL DEFAULT 'ACTIVA'`
    );
    await client.query(
      `ALTER TABLE public.reconducciones_claves ADD COLUMN IF NOT EXISTS used_at timestamp without time zone`
    );
    await client.query(
      `ALTER TABLE public.reconducciones_claves ADD COLUMN IF NOT EXISTS used_by integer`
    );
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS reconducciones_claves_clave_key ON public.reconducciones_claves (clave)`
    );
    return;
  }
  await query(q);
  await query(
    `ALTER TABLE public.reconducciones_claves ADD COLUMN IF NOT EXISTS dg_clave varchar(3) NOT NULL DEFAULT ''`
  );
  await query(
    `ALTER TABLE public.reconducciones_claves ADD COLUMN IF NOT EXISTS da_clave varchar(3) NOT NULL DEFAULT ''`
  );
  await query(
    `ALTER TABLE public.reconducciones_claves ADD COLUMN IF NOT EXISTS status varchar(10) NOT NULL DEFAULT 'ACTIVA'`
  );
  await query(
    `ALTER TABLE public.reconducciones_claves ADD COLUMN IF NOT EXISTS used_at timestamp without time zone`
  );
  await query(
    `ALTER TABLE public.reconducciones_claves ADD COLUMN IF NOT EXISTS used_by integer`
  );
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS reconducciones_claves_clave_key ON public.reconducciones_claves (clave)`
  );
}

async function ensureReconSessionTable(client = null) {
  const q = `
    CREATE TABLE IF NOT EXISTS public.reconducciones_sesiones (
      token varchar(64) PRIMARY KEY,
      id_dgeneral integer NOT NULL,
      id_dauxiliar integer NOT NULL,
      created_at timestamp without time zone NOT NULL DEFAULT NOW(),
      created_by integer,
      activo boolean NOT NULL DEFAULT true
    )
  `;
  if (client) {
    await client.query(q);
    return;
  }
  await query(q);
}

function buildSessionToken() {
  return crypto.randomBytes(24).toString("hex").toUpperCase();
}

async function generateReconClaveForArea(actorId, dgClave, daClave) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await ensureReconClaveTable(client);
    let clave = "";
    for (let i = 0; i < 5; i += 1) {
      const next = buildClave();
      const r = await client.query(
        `INSERT INTO public.reconducciones_claves (clave, dg_clave, da_clave, created_by, status)
         VALUES ($1, $2, $3, $4, 'ACTIVA')
         ON CONFLICT (clave) DO NOTHING
         RETURNING clave`,
        [next, dgClave, daClave, actorId || null]
      );
      if (r.rowCount > 0) {
        clave = next;
        break;
      }
    }
    if (!clave) throw new Error("No se pudo generar clave");
    await client.query("COMMIT");
    return clave;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function requireL00117(req, res, next) {
  const ok = await isUserL00117(req);
  if (!ok) {
    return res.status(403).json({ error: "Solo L00 117 puede acceder." });
  }
  next();
}

async function requireReconSession(req, res, next) {
  const isL00117 = await isUserL00117(req);
  if (isL00117) {
    return next();
  }
  const provided = String(req.headers["x-recon-session"] || "").trim();
  if (!provided) {
    return res.status(403).json({ error: "Sesión requerida." });
  }
  const areaIds = getAreaIds(req);
  if (!areaIds) {
    return res.status(403).json({ error: "Área inválida." });
  }
  await ensureReconSessionTable();
  const r = await query(
    `SELECT token
       FROM public.reconducciones_sesiones
      WHERE token = $1
        AND activo = true
        AND id_dgeneral = $2
        AND id_dauxiliar = $3
      LIMIT 1`,
    [provided, areaIds.idDg, areaIds.idDa]
  );
  if (r.rowCount === 0) {
    return res.status(403).json({ error: "Sesión inválida." });
  }
  next();
}

function getAreaIds(req) {
  const idDg = Number(req.user?.id_dgeneral);
  const idDa = Number(req.user?.id_dauxiliar);
  if (!Number.isFinite(idDg) || !Number.isFinite(idDa)) return null;
  return { idDg, idDa };
}

function validateLadosArea(lados, areaIds) {
  if (!areaIds) return false;
  return (lados || []).every(
    (l) =>
      Number(l?.id_dgeneral) === Number(areaIds.idDg) &&
      Number(l?.id_dauxiliar) === Number(areaIds.idDa)
  );
}

function toNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toTextOrNull(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function normalizeLado(v) {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "ORIGEN" || s === "DESTINO" ? s : null;
}

function normalizeTipo(v) {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "" ? "RECONDUCCION" : s;
}

function normalizeEstatus(v) {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "" ? "BORRADOR" : s;
}

function getMesNombreDesdeFecha(dateValue) {
  if (!dateValue) return null;
  const dt = new Date(dateValue);
  if (Number.isNaN(dt.getTime())) return null;
  const nombres = [
    "ENERO",
    "FEBRERO",
    "MARZO",
    "ABRIL",
    "MAYO",
    "JUNIO",
    "JULIO",
    "AGOSTO",
    "SEPTIEMBRE",
    "OCTUBRE",
    "NOVIEMBRE",
    "DICIEMBRE",
  ];
  return nombres[dt.getMonth()] || null;
}

function normalizeYearMonth(inputYear, inputMonth) {
  const now = new Date();
  let year = Number(inputYear);
  let month = Number(inputMonth);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    year = now.getFullYear();
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    month = now.getMonth() + 1;
  }
  return {
    year: String(year),
    month: String(month).padStart(2, "0"),
  };
}

function getYearMonthFromFecha(fecha) {
  const raw = String(fecha || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { year: raw.slice(0, 4), month: raw.slice(5, 7) };
  }
  return { year: null, month: null };
}

router.post("/clave/generar-area", requireL00117, async (req, res) => {
  try {
    const dg = normalizeClave(req.body?.dg);
    const da = normalizeClave(req.body?.da);
    if (!dg || !da) {
      return res.status(400).json({ error: "Área requerida." });
    }
    const actorId = getActorId(req) || req.user?.id || null;
    const clave = await generateReconClaveForArea(actorId, dg, da);
    return res.json({ clave, dg, da });
  } catch (err) {
    console.error("POST /api/reconducciones/clave/generar", err);
    return res.status(500).json({ error: "Error generando clave" });
  }
});

router.post("/clave/generar", requireL00117, async (req, res) => {
  try {
    const dg = normalizeClave(req.body?.dg);
    const da = normalizeClave(req.body?.da);
    if (!dg || !da) {
      return res.status(400).json({ error: "Área requerida." });
    }
    const actorId = getActorId(req) || req.user?.id || null;
    const clave = await generateReconClaveForArea(actorId, dg, da);
    return res.json({ clave, dg, da });
  } catch (err) {
    console.error("POST /api/reconducciones/clave/generar", err);
    return res.status(500).json({ error: "Error generando clave" });
  }
});

router.get("/clave/listar", requireL00117, async (req, res) => {
  try {
    await ensureReconClaveTable();
    const r = await query(
      `SELECT clave, dg_clave, da_clave, status, created_at, used_at
         FROM public.reconducciones_claves
        ORDER BY id DESC
        LIMIT 100`
    );
    return res.json(r.rows);
  } catch (err) {
    console.error("GET /api/reconducciones/clave/listar", err);
    return res.status(500).json({ error: "Error listando claves" });
  }
});

router.post("/clave/validar", async (req, res) => {
  try {
    const provided = normalizeClave(req.body?.clave);
    if (!provided) return res.status(400).json({ error: "Clave requerida." });
    const area = await getUserAreaClaves(req);
    if (!area) {
      return res.status(403).json({ ok: false, error: "Área inválida." });
    }
    await ensureReconClaveTable();
    await ensureReconSessionTable();
    const actorId = getActorId(req) || req.user?.id || null;
    const r = await query(
      `UPDATE public.reconducciones_claves
          SET status = 'USADA',
              used_at = now(),
              used_by = $2
        WHERE clave = $1
          AND status = 'ACTIVA'
          AND dg_clave = $3
          AND da_clave = $4
        RETURNING clave, dg_clave, da_clave`,
      [provided, actorId, area.dg, area.da]
    );
    if (r.rowCount === 0) {
      const chk = await query(
        `SELECT clave, dg_clave, da_clave, status
           FROM public.reconducciones_claves
          WHERE clave = $1
          LIMIT 1`,
        [provided]
      );
      if (chk.rowCount === 0) {
        return res.status(403).json({ ok: false, error: "Clave inválida." });
      }
      const row = chk.rows[0];
      if (
        normalizeClave(row.dg_clave) !== area.dg ||
        normalizeClave(row.da_clave) !== area.da
      ) {
        return res.status(403).json({ ok: false, error: "Clave no corresponde a tu área." });
      }
      return res.status(403).json({ ok: false, error: "Clave ya fue usada." });
    }
    const sessionToken = buildSessionToken();
    const ids = getAreaIds(req);
    await query(
      `INSERT INTO public.reconducciones_sesiones
        (token, id_dgeneral, id_dauxiliar, created_by, activo)
       VALUES ($1, $2, $3, $4, true)`,
      [sessionToken, ids.idDg, ids.idDa, actorId]
    );
    return res.json({ ok: true, token: sessionToken });
  } catch (err) {
    console.error("POST /api/reconducciones/clave/validar", err);
    return res.status(500).json({ error: "Error validando clave" });
  }
});

router.use(requireReconSession);

router.get("/next-oficio", async (req, res) => {
  try {
    const { year, month } = normalizeYearMonth(req.query?.year, req.query?.month);
    const prefix = `ECA-${year}-${month}-RCP-`;
    const like = `${prefix}%`;
    const r = await query(
      `
      SELECT COALESCE(MAX(
        CASE
          WHEN oficio ~ '^ECA-\\d{4}-\\d{2}-RCP-\\d{4}$' THEN RIGHT(oficio, 4)::int
          ELSE NULL
        END
      ), 0) AS max_num
      FROM public.reconducciones
      WHERE oficio LIKE $1
      `,
      [like]
    );
    const nextNum = Number(r.rows?.[0]?.max_num || 0) + 1;
    const oficio = `${prefix}${String(nextNum).padStart(4, "0")}`;
    return res.json({ next_num: nextNum, next_oficio: oficio, year, month });
  } catch (err) {
    console.error("GET /api/reconducciones/next-oficio", err);
    return res.status(500).json({ error: "Error obteniendo folio de oficio" });
  }
});

router.get("/", async (req, res) => {
  try {
    const role = getRole(req);
    const isL00117 = await isUserL00117(req);
    const allowAll = canSeeAllAreas(role, isL00117);
    const areaIds = getAreaIds(req);

    const params = [];
    const where = [];
    const add = (v) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (!allowAll) {
      if (!areaIds) return res.json([]);
      const p1 = add(areaIds.idDg);
      const p2 = add(areaIds.idDa);
      where.push(
        `EXISTS (SELECT 1 FROM public.reconducciones_lados l WHERE l.id_reconduccion = r.id AND l.id_dgeneral = ${p1} AND l.id_dauxiliar = ${p2})`
      );
    }

    const r = await query(
      `
      SELECT r.*,
             v.origen_total,
             v.destino_total,
             v.diferencia
        FROM public.reconducciones r
        LEFT JOIN public.v_reconducciones_resumen v
          ON v.id_reconduccion = r.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY r.id DESC
      `,
      params
    );
    return res.json(r.rows);
  } catch (err) {
    console.error("GET /api/reconducciones", err);
    return res.status(500).json({ error: "Error obteniendo reconducciones" });
  }
});

router.get("/saldos", async (req, res) => {
  try {
    const role = getRole(req);
    const isL00117 = await isUserL00117(req);
    const allowAll = canSeeAllAreas(role, isL00117);
    const areaIds = getAreaIds(req);

    const params = [];
    const where = [];
    const add = (v) => {
      params.push(v);
      return `$${params.length}`;
    };

    let id_dgeneral = toNumOrNull(req.query.id_dgeneral);
    let id_dauxiliar = toNumOrNull(req.query.id_dauxiliar);
    const id_fuente = toNumOrNull(req.query.id_fuente);
    const id_proyecto = toTextOrNull(req.query.id_proyecto);
    const id_partida = toNumOrNull(req.query.id_partida);
    const mes = toTextOrNull(req.query.mes);

    if (!allowAll && areaIds) {
      id_dgeneral = areaIds.idDg;
      id_dauxiliar = areaIds.idDa;
    }

    if (Number.isFinite(id_dgeneral)) where.push(`pd.id_dgeneral = ${add(id_dgeneral)}`);
    if (Number.isFinite(id_dauxiliar)) where.push(`pd.id_dauxiliar = ${add(id_dauxiliar)}`);
    if (Number.isFinite(id_fuente)) where.push(`pd.id_fuente = ${add(id_fuente)}`);
    if (id_proyecto) where.push(`pd.id_proyecto = ${add(id_proyecto)}`);
    if (mes) where.push(`pd.mes = ${add(mes)}`);
    if (Number.isFinite(id_partida)) where.push(`p.id = ${add(id_partida)}`);

    const sql = `
      SELECT
        p.id AS id_partida,
        p.clave,
        p.descripcion,
        COALESCE(SUM(pd.saldo_disponible),0) AS saldo_disponible
      FROM public.presupuesto_detalle pd
      JOIN public.partidas p
        ON TRIM(p.clave) = TRIM(pd.partida)
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY p.id, p.clave, p.descripcion
      ORDER BY p.clave
    `;

    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    console.error("GET /api/reconducciones/saldos", err);
    return res.status(500).json({ error: "Error obteniendo saldos" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const role = getRole(req);
    const isL00117 = await isUserL00117(req);
    const allowAll = canSeeAllAreas(role, isL00117);
    const areaIds = getAreaIds(req);

    const cabParams = [id];
    let cabWhere = "r.id = $1";
    if (!allowAll) {
      if (!areaIds) return res.status(404).json({ error: "Reconducción no encontrada" });
      cabParams.push(areaIds.idDg, areaIds.idDa);
      cabWhere += ` AND EXISTS (
        SELECT 1 FROM public.reconducciones_lados l
        WHERE l.id_reconduccion = r.id
          AND l.id_dgeneral = $2
          AND l.id_dauxiliar = $3
      )`;
    }

    const cab = await query(
      `SELECT r.*,
              v.origen_total,
              v.destino_total,
              v.diferencia
         FROM public.reconducciones r
         LEFT JOIN public.v_reconducciones_resumen v
           ON v.id_reconduccion = r.id
        WHERE ${cabWhere}`,
      cabParams
    );

    if (cab.rowCount === 0) {
      return res.status(404).json({ error: "Reconducción no encontrada" });
    }

    const [lados, recursos, metas, movimientos] = await Promise.all([
      query(
        `SELECT *
           FROM public.reconducciones_lados
          WHERE id_reconduccion = $1
          ORDER BY lado`,
        [id]
      ),
      query(
        `SELECT *
           FROM public.reconducciones_recursos
          WHERE id_reconduccion = $1
          ORDER BY lado, id_partida`,
        [id]
      ),
      query(
        `SELECT *
           FROM public.reconducciones_metas
          WHERE id_reconduccion = $1
          ORDER BY lado, codigo`,
        [id]
      ),
      query(
        `SELECT *
           FROM public.reconducciones_movimientos
          WHERE id_reconduccion = $1
          ORDER BY id`,
        [id]
      ),
    ]);

    return res.json({
      cabecera: cab.rows[0],
      lados: lados.rows,
      recursos: recursos.rows,
      metas: metas.rows,
      movimientos: movimientos.rows,
    });
  } catch (err) {
    console.error("GET /api/reconducciones/:id", err);
    return res.status(500).json({ error: "Error obteniendo reconducción" });
  }
});

router.post("/", async (req, res) => {
  const client = await getClient();
  try {
    const b = req.body || {};
    const actorId = getActorId(req) || req.user?.id || null;
    const role = getRole(req);
    const isL00117 = await isUserL00117(req);
    const allowAll = canSeeAllAreas(role, isL00117);
    const areaIds = getAreaIds(req);

    let oficio = toTextOrNull(b.oficio);
    const fecha_elaboracion = toTextOrNull(b.fecha_elaboracion);
    const tipo_movimiento = normalizeTipo(b.tipo_movimiento);
    const justificacion = toTextOrNull(b.justificacion);
    const ejercicio = toNumOrNull(b.ejercicio);
    const mes_pago_date = toTextOrNull(b.mes_pago_date);
    const lados = Array.isArray(b.lados) ? b.lados : [];

    if (!allowAll && !validateLadosArea(lados, areaIds)) {
      return res.status(403).json({ error: "Sin permisos para esta área" });
    }

    await client.query("BEGIN");

    if (!oficio) {
      const ym = getYearMonthFromFecha(fecha_elaboracion);
      const { year, month } = normalizeYearMonth(ym.year, ym.month);
      const prefix = `ECA-${year}-${month}-RCP-`;
      const like = `${prefix}%`;
      await client.query("LOCK TABLE public.reconducciones IN EXCLUSIVE MODE");
      const r = await client.query(
        `
        SELECT COALESCE(MAX(
          CASE
            WHEN oficio ~ '^ECA-\\d{4}-\\d{2}-RCP-\\d{4}$' THEN RIGHT(oficio, 4)::int
            ELSE NULL
          END
        ), 0) AS max_num
        FROM public.reconducciones
        WHERE oficio LIKE $1
        `,
        [like]
      );
      const nextNum = Number(r.rows?.[0]?.max_num || 0) + 1;
      oficio = `${prefix}${String(nextNum).padStart(4, "0")}`;
    }

    const cab = await client.query(
      `INSERT INTO public.reconducciones
        (oficio, fecha_elaboracion, tipo_movimiento, justificacion, estatus, ejercicio, mes_pago_date, created_by)
       VALUES ($1,$2,$3,$4,'BORRADOR',$5,$6,$7)
       RETURNING *`,
      [oficio, fecha_elaboracion, tipo_movimiento, justificacion, ejercicio, mes_pago_date, actorId]
    );

    const reconId = cab.rows[0].id;

    for (const l of lados) {
      const lado = normalizeLado(l.lado);
      if (!lado) continue;
      await client.query(
        `INSERT INTO public.reconducciones_lados
          (id_reconduccion, lado, id_dgeneral, id_dauxiliar, id_programa, objetivo, id_fuente, id_proyecto, clave_proyecto, denominacion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          reconId,
          lado,
          toNumOrNull(l.id_dgeneral),
          toNumOrNull(l.id_dauxiliar),
          toNumOrNull(l.id_programa),
          toTextOrNull(l.objetivo),
          toNumOrNull(l.id_fuente),
          toNumOrNull(l.id_proyecto),
          toTextOrNull(l.clave_proyecto),
          toTextOrNull(l.denominacion),
        ]
      );
    }

    const recursos = Array.isArray(b.recursos) ? b.recursos : [];
    for (const r of recursos) {
      const lado = normalizeLado(r.lado);
      if (!lado) continue;
      await client.query(
        `INSERT INTO public.reconducciones_recursos
          (id_reconduccion, lado, id_partida, concepto_partida, autorizado, por_ejercer, monto_movimiento, autorizado_modificado, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          reconId,
          lado,
          toNumOrNull(r.id_partida),
          toTextOrNull(r.concepto_partida),
          toNumOrNull(r.autorizado),
          toNumOrNull(r.por_ejercer),
          Number(r.monto_movimiento || 0),
          toNumOrNull(r.autorizado_modificado),
          actorId,
        ]
      );
    }

    const metas = Array.isArray(b.metas) ? b.metas : [];
    for (const m of metas) {
      const lado = normalizeLado(m.lado);
      if (!lado) continue;
      await client.query(
        `INSERT INTO public.reconducciones_metas
          (id_reconduccion, lado, codigo, descripcion, unidad_medida, inicial, avance, modificada, t1, t2, t3, t4, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          reconId,
          lado,
          toTextOrNull(m.codigo),
          toTextOrNull(m.descripcion),
          toTextOrNull(m.unidad_medida),
          toNumOrNull(m.inicial),
          toNumOrNull(m.avance),
          toNumOrNull(m.modificada),
          toNumOrNull(m.t1),
          toNumOrNull(m.t2),
          toNumOrNull(m.t3),
          toNumOrNull(m.t4),
          actorId,
        ]
      );
    }

    await client.query("COMMIT");
    await logAuditEvent(req, {
      tipo: "RECONDUCCION",
      entidad: "RECONDUCCIONES",
      entidad_id: cab.rows[0].oficio,
      estado: "BORRADOR",
      detalles: {
        id_reconduccion: reconId,
        oficio: cab.rows[0].oficio,
        tipo_movimiento: cab.rows[0].tipo_movimiento,
        estatus: cab.rows[0].estatus,
        ejercicio: cab.rows[0].ejercicio ?? null,
        mes_pago_date: cab.rows[0].mes_pago_date ?? null,
        lados: Array.isArray(lados) ? lados.length : 0,
        recursos: Array.isArray(b.recursos) ? b.recursos.length : 0,
        metas: Array.isArray(b.metas) ? b.metas.length : 0,
      },
    });
    return res.json({ ok: true, cabecera: cab.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/reconducciones", err);
    return res.status(500).json({ error: err.message || "Error creando reconducción" });
  } finally {
    client.release();
  }
});

router.put("/:id", async (req, res) => {
  const client = await getClient();
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const b = req.body || {};
    const actorId = getActorId(req) || req.user?.id || null;
    const role = getRole(req);
    const isL00117 = await isUserL00117(req);
    const allowAll = canSeeAllAreas(role, isL00117);
    const areaIds = getAreaIds(req);

    await client.query("BEGIN");

    if (!allowAll) {
      if (!areaIds) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Sin permisos para esta área" });
      }
      const perm = await client.query(
        `SELECT 1
           FROM public.reconducciones_lados l
          WHERE l.id_reconduccion = $1
            AND l.id_dgeneral = $2
            AND l.id_dauxiliar = $3
          LIMIT 1`,
        [id, areaIds.idDg, areaIds.idDa]
      );
      if (!perm.rowCount) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Sin permisos para esta área" });
      }
    }

    const current = await client.query(
      "SELECT id, estatus FROM public.reconducciones WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reconducción no encontrada" });
    }
    if (normalizeEstatus(current.rows[0].estatus) !== "BORRADOR") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Solo se puede editar en BORRADOR" });
    }

    const oficio = toTextOrNull(b.oficio);
    const fecha_elaboracion = toTextOrNull(b.fecha_elaboracion);
    const tipo_movimiento = normalizeTipo(b.tipo_movimiento);
    const justificacion = toTextOrNull(b.justificacion);
    const ejercicio = toNumOrNull(b.ejercicio);
    const mes_pago_date = toTextOrNull(b.mes_pago_date);

    await client.query(
      `UPDATE public.reconducciones
          SET oficio = $2,
              fecha_elaboracion = $3,
              tipo_movimiento = $4,
              justificacion = $5,
              ejercicio = $6,
              mes_pago_date = $7,
              updated_at = now(),
              updated_by = $8
        WHERE id = $1`,
      [id, oficio, fecha_elaboracion, tipo_movimiento, justificacion, ejercicio, mes_pago_date, actorId]
    );

    await Promise.all([
      client.query("DELETE FROM public.reconducciones_lados WHERE id_reconduccion = $1", [id]),
      client.query("DELETE FROM public.reconducciones_recursos WHERE id_reconduccion = $1", [id]),
      client.query("DELETE FROM public.reconducciones_metas WHERE id_reconduccion = $1", [id]),
    ]);

    const lados = Array.isArray(b.lados) ? b.lados : [];
    if (!allowAll && !validateLadosArea(lados, areaIds)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Sin permisos para esta área" });
    }
    for (const l of lados) {
      const lado = normalizeLado(l.lado);
      if (!lado) continue;
      await client.query(
        `INSERT INTO public.reconducciones_lados
          (id_reconduccion, lado, id_dgeneral, id_dauxiliar, id_programa, objetivo, id_fuente, id_proyecto, clave_proyecto, denominacion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          lado,
          toNumOrNull(l.id_dgeneral),
          toNumOrNull(l.id_dauxiliar),
          toNumOrNull(l.id_programa),
          toTextOrNull(l.objetivo),
          toNumOrNull(l.id_fuente),
          toNumOrNull(l.id_proyecto),
          toTextOrNull(l.clave_proyecto),
          toTextOrNull(l.denominacion),
        ]
      );
    }

    const recursos = Array.isArray(b.recursos) ? b.recursos : [];
    for (const r of recursos) {
      const lado = normalizeLado(r.lado);
      if (!lado) continue;
      await client.query(
        `INSERT INTO public.reconducciones_recursos
          (id_reconduccion, lado, id_partida, concepto_partida, autorizado, por_ejercer, monto_movimiento, autorizado_modificado, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          lado,
          toNumOrNull(r.id_partida),
          toTextOrNull(r.concepto_partida),
          toNumOrNull(r.autorizado),
          toNumOrNull(r.por_ejercer),
          Number(r.monto_movimiento || 0),
          toNumOrNull(r.autorizado_modificado),
          actorId,
        ]
      );
    }

    const metas = Array.isArray(b.metas) ? b.metas : [];
    for (const m of metas) {
      const lado = normalizeLado(m.lado);
      if (!lado) continue;
      await client.query(
        `INSERT INTO public.reconducciones_metas
          (id_reconduccion, lado, codigo, descripcion, unidad_medida, inicial, avance, modificada, t1, t2, t3, t4, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id,
          lado,
          toTextOrNull(m.codigo),
          toTextOrNull(m.descripcion),
          toTextOrNull(m.unidad_medida),
          toNumOrNull(m.inicial),
          toNumOrNull(m.avance),
          toNumOrNull(m.modificada),
          toNumOrNull(m.t1),
          toNumOrNull(m.t2),
          toNumOrNull(m.t3),
          toNumOrNull(m.t4),
          actorId,
        ]
      );
    }

    await client.query("COMMIT");
    await logAuditEvent(req, {
      tipo: "RECONDUCCION_EDITAR",
      entidad: "RECONDUCCIONES",
      entidad_id: String(id),
      estado: "ACTUALIZADA",
      detalles: { id_reconduccion: id },
    });
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PUT /api/reconducciones/:id", err);
    return res.status(500).json({ error: err.message || "Error actualizando reconducción" });
  } finally {
    client.release();
  }
});

router.post("/:id/enviar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const actorId = getActorId(req) || req.user?.id || null;

    const r = await query(
      `UPDATE public.reconducciones
          SET estatus = 'ENVIADO',
              enviado_at = now(),
              updated_at = now(),
              updated_by = $2
        WHERE id = $1
          AND estatus = 'BORRADOR'
      RETURNING *`,
      [id, actorId]
    );

    if (r.rowCount === 0) {
      return res.status(400).json({ error: "Solo se puede enviar desde BORRADOR" });
    }

    await logAuditEvent(req, {
      tipo: "RECONDUCCION_ENVIAR",
      entidad: "RECONDUCCIONES",
      entidad_id: r.rows[0].oficio ?? String(id),
      estado: "ENVIADO",
      detalles: { id_reconduccion: id, oficio: r.rows[0].oficio ?? null },
    });
    return res.json({ ok: true, cabecera: r.rows[0] });
  } catch (err) {
    console.error("POST /api/reconducciones/:id/enviar", err);
    return res.status(500).json({ error: "Error enviando reconducción" });
  }
});

router.post("/:id/aplicar", async (req, res) => {
  const client = await getClient();
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const actorId = getActorId(req) || req.user?.id || null;
    const ejercicio = toNumOrNull(req.body?.ejercicio);
    const mes_pago_date = toTextOrNull(req.body?.mes_pago_date);

    await client.query("BEGIN");

    const cab = await client.query(
      "SELECT * FROM public.reconducciones WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (cab.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reconducción no encontrada" });
    }

    const estatus = normalizeEstatus(cab.rows[0].estatus);
    if (!(estatus === "ENVIADO" || estatus === "AUTORIZADO")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Solo se puede aplicar ENVIADO o AUTORIZADO" });
    }

    if (ejercicio || mes_pago_date) {
      await client.query(
        `UPDATE public.reconducciones
            SET ejercicio = COALESCE($2, ejercicio),
                mes_pago_date = COALESCE($3, mes_pago_date),
                updated_at = now(),
                updated_by = $4
          WHERE id = $1`,
        [id, ejercicio, mes_pago_date, actorId]
      );
    }

    const ejercicioFinal = ejercicio ?? cab.rows[0].ejercicio;
    const mesPagoFinal = mes_pago_date ?? cab.rows[0].mes_pago_date;
    // Se usa el mes en texto para alinear con presupuesto_detalle.mes
    const mesNombre = getMesNombreDesdeFecha(mesPagoFinal);
    if (!mesNombre) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "mes_pago_date inválido o vacío" });
    }

    const totals = await client.query(
      `SELECT lado, COALESCE(SUM(monto_movimiento),0) AS total
         FROM public.reconducciones_recursos
        WHERE id_reconduccion = $1
        GROUP BY lado`,
      [id]
    );

    let totalOrigen = 0;
    let totalDestino = 0;
    for (const row of totals.rows) {
      if (row.lado === "ORIGEN") totalOrigen = Number(row.total || 0);
      if (row.lado === "DESTINO") totalDestino = Number(row.total || 0);
    }

    if (totalOrigen <= 0 || totalDestino <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Totales ORIGEN/DESTINO inválidos" });
    }

    const tipo = normalizeTipo(cab.rows[0].tipo_movimiento);
    if (tipo === "TRASPASO" || tipo === "RECONDUCCION") {
      if (Math.abs(totalOrigen - totalDestino) > 0.01) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Total ORIGEN debe igualar Total DESTINO" });
      }
    }

    // Validación de saldo ORIGEN contra presupuesto_detalle (por mes)
    const saldoCheck = await client.query(
      `
      WITH origen AS (
        SELECT
          rr.id_partida,
          l.id_dgeneral,
          l.id_dauxiliar,
          l.id_fuente,
          COALESCE(l.clave_proyecto, l.id_proyecto::text) AS clave_proyecto,
          SUM(rr.monto_movimiento) AS monto
        FROM public.reconducciones_recursos rr
        JOIN public.reconducciones_lados l
          ON l.id_reconduccion = rr.id_reconduccion
         AND l.lado = rr.lado
        WHERE rr.id_reconduccion = $1
          AND rr.lado = 'ORIGEN'
        GROUP BY rr.id_partida, l.id_dgeneral, l.id_dauxiliar, l.id_fuente, l.clave_proyecto
      ),
      saldo AS (
        SELECT
          p.id AS id_partida,
          pd.id_dgeneral,
          pd.id_dauxiliar,
          pd.id_fuente,
          pd.id_proyecto AS clave_proyecto,
          COALESCE(SUM(pd.saldo_disponible),0) AS saldo
        FROM public.presupuesto_detalle pd
        JOIN public.partidas p
          ON TRIM(p.clave) = TRIM(pd.partida)
        WHERE pd.mes = $2
        GROUP BY p.id, pd.id_dgeneral, pd.id_dauxiliar, pd.id_fuente, pd.id_proyecto
      )
      SELECT o.*, COALESCE(s.saldo,0) AS saldo
        FROM origen o
        LEFT JOIN saldo s
          ON s.id_partida = o.id_partida
         AND s.id_dgeneral = o.id_dgeneral
         AND s.id_dauxiliar = o.id_dauxiliar
         AND s.id_fuente = o.id_fuente
         AND s.clave_proyecto = o.clave_proyecto
      `,
      [id, mesNombre]
    );

    const insuficientes = saldoCheck.rows.filter((r) => Number(r.monto || 0) > Number(r.saldo || 0));
    if (insuficientes.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Saldo insuficiente en ORIGEN",
        detalles: insuficientes,
      });
    }

    // Ledger de movimientos: ORIGEN negativo, DESTINO positivo
    await client.query(
      `
      INSERT INTO public.reconducciones_movimientos
        (id_reconduccion, lado, id_dgeneral, id_dauxiliar, id_fuente, id_proyecto, id_partida, ejercicio, mes_pago_date, monto, created_at, created_by)
      SELECT
        rr.id_reconduccion,
        rr.lado,
        l.id_dgeneral,
        l.id_dauxiliar,
        l.id_fuente,
        l.id_proyecto,
        rr.id_partida,
        $3,
        $4,
        CASE WHEN rr.lado = 'ORIGEN' THEN -ABS(rr.monto_movimiento) ELSE ABS(rr.monto_movimiento) END,
        now(),
        $2
      FROM public.reconducciones_recursos rr
      JOIN public.reconducciones_lados l
        ON l.id_reconduccion = rr.id_reconduccion
       AND l.lado = rr.lado
      JOIN public.reconducciones r
        ON r.id = rr.id_reconduccion
      WHERE rr.id_reconduccion = $1
      `,
      [id, actorId, ejercicioFinal, mesPagoFinal]
    );

    // Aplicación a presupuesto_detalle por cada renglón
    const recursos = await client.query(
      `
      SELECT
        rr.lado,
        rr.id_partida,
        rr.monto_movimiento,
        l.id_dgeneral,
        l.id_dauxiliar,
        l.id_fuente,
        COALESCE(l.clave_proyecto, l.id_proyecto::text) AS id_proyecto,
        p.clave AS partida_clave
      FROM public.reconducciones_recursos rr
      JOIN public.reconducciones_lados l
        ON l.id_reconduccion = rr.id_reconduccion
       AND l.lado = rr.lado
      JOIN public.partidas p
        ON p.id = rr.id_partida
      WHERE rr.id_reconduccion = $1
      `,
      [id]
    );

    for (const row of recursos.rows) {
      const monto = Number(row.monto_movimiento || 0);
      if (!Number.isFinite(monto) || monto <= 0) continue;
      const projectKey = toTextOrNull(row.id_proyecto);
      if (!projectKey || !row.partida_clave) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Llaves presupuestales incompletas" });
      }

      const baseParams = [
        row.id_dgeneral,
        row.id_dauxiliar,
        row.id_fuente,
        projectKey,
        row.partida_clave,
        mesNombre,
      ];

      let pres = await client.query(
        `SELECT presupuesto, total_gastado, total_reconducido
           FROM public.presupuesto_detalle
          WHERE id_dgeneral = $1
            AND id_dauxiliar = $2
            AND id_fuente = $3
            AND id_proyecto = $4
            AND partida = $5
            AND mes = $6
          FOR UPDATE`,
        baseParams
      );

      if (pres.rowCount === 0) {
        if (row.lado === "ORIGEN") {
          await client.query("ROLLBACK");
          return res
            .status(400)
            .json({ error: "No existe presupuesto ORIGEN para aplicar" });
        }
        await client.query(
          `INSERT INTO public.presupuesto_detalle
            (fecha_registro, id_dgeneral, id_dauxiliar, id_fuente, id_proyecto, partida, mes,
             presupuesto, total_gastado, total_reconducido, saldo_disponible)
           VALUES (NOW(), $1,$2,$3,$4,$5,$6, 0,0,0,0)`,
          baseParams
        );
        pres = await client.query(
          `SELECT presupuesto, total_gastado, total_reconducido
             FROM public.presupuesto_detalle
            WHERE id_dgeneral = $1
              AND id_dauxiliar = $2
              AND id_fuente = $3
              AND id_proyecto = $4
              AND partida = $5
              AND mes = $6
            FOR UPDATE`,
          baseParams
        );
      }

      const current = pres.rows[0];
      const nuevoRecon =
        Number(current.total_reconducido || 0) +
        (row.lado === "ORIGEN" ? -monto : monto);
      const saldoNuevo = computeSaldo({
        presupuesto: current.presupuesto,
        total_gastado: current.total_gastado,
        total_reconducido: nuevoRecon,
      });

      await client.query(
        `UPDATE public.presupuesto_detalle
            SET total_reconducido = $1,
                saldo_disponible = $2,
                fecha_reconduccion = COALESCE(fecha_reconduccion, now()),
                motivo_reconduccion = COALESCE(motivo_reconduccion, $3)
          WHERE id_dgeneral = $4
            AND id_dauxiliar = $5
            AND id_fuente = $6
            AND id_proyecto = $7
            AND partida = $8
            AND mes = $9`,
        [
          nuevoRecon,
          saldoNuevo,
          `RECONDUCCION ${cab.rows[0].oficio || id}`,
          row.id_dgeneral,
          row.id_dauxiliar,
          row.id_fuente,
          projectKey,
          row.partida_clave,
          mesNombre,
        ]
      );
    }

    const upd = await client.query(
      `UPDATE public.reconducciones
          SET estatus = 'APLICADO',
              aplicado_at = now(),
              updated_at = now(),
              updated_by = $2
        WHERE id = $1
      RETURNING *`,
      [id, actorId]
    );

    await client.query("COMMIT");
    await logAuditEvent(req, {
      tipo: "RECONDUCCION_APLICAR",
      entidad: "RECONDUCCIONES",
      entidad_id: upd.rows[0].oficio ?? String(id),
      estado: "APLICADO",
      detalles: {
        id_reconduccion: id,
        oficio: upd.rows[0].oficio ?? null,
        ejercicio: ejercicioFinal ?? null,
        mes_pago_date: mesPagoFinal ?? null,
        mes_pago: mesNombre ?? null,
      },
    });
    return res.json({ ok: true, cabecera: upd.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/reconducciones/:id/aplicar", err);
    return res.status(500).json({ error: err.message || "Error aplicando reconducción" });
  } finally {
    client.release();
  }
});

router.post("/:id/cancelar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const actorId = getActorId(req) || req.user?.id || null;
    const motivo = toTextOrNull(req.body?.cancel_reason);

    const r = await query(
      `UPDATE public.reconducciones
          SET estatus = 'CANCELADO',
              cancel_at = now(),
              cancel_by = $2,
              cancel_reason = $3,
              updated_at = now(),
              updated_by = $2
        WHERE id = $1
          AND estatus <> 'APLICADO'
      RETURNING *`,
      [id, actorId, motivo]
    );

    if (r.rowCount === 0) {
      return res.status(400).json({ error: "No se puede cancelar una reconducción aplicada" });
    }

    await logAuditEvent(req, {
      tipo: "RECONDUCCION_CANCELAR",
      entidad: "RECONDUCCIONES",
      entidad_id: r.rows[0].oficio ?? String(id),
      estado: "CANCELADO",
      detalles: { id_reconduccion: id, oficio: r.rows[0].oficio ?? null, motivo },
    });
    return res.json({ ok: true, cabecera: r.rows[0] });
  } catch (err) {
    console.error("POST /api/reconducciones/:id/cancelar", err);
    return res.status(500).json({ error: "Error cancelando reconducción" });
  }
});

export default router;
