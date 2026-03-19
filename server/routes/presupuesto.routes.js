/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: API — Presupuesto General
 *  Archivo: presupuesto.routes.js
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
import { query, getClient } from "../db.js";
import {
  computeSaldo,
  getProjectKeys,
  buildHttpError,
  isPartidaMilKey,
  logUnauthorizedPartidasAccess,
  checkIsUserL00117,
  checkIsUserE00,
} from "../utils/helpers.js";

const router = Router();

function getRole(req) {
  const roles = (req.user?.roles || []).map((r) => String(r).toUpperCase());
  if (roles.includes("GOD")) return "GOD";
  if (roles.includes("ADMIN")) return "ADMIN";
  return "AREA";
}

async function canViewPartidasMil(req) {
  return (await checkIsUserL00117(req)) || (await checkIsUserE00(req));
}

/* =====================================================
   PROYECTOS (LISTADO)
   GET /api/projects
   ===================================================== */
router.get("/projects", async (req, res) => {
  try {
    const anio = Number(req.query.anio || 0);
    const role = getRole(req);
    const canSeeAll = role !== "AREA" || (await checkIsUserL00117(req));

    let idDgeneral = Number(req.query.id_dgeneral || 0);
    let idDauxiliar = Number(req.query.id_dauxiliar || 0);

    if (!canSeeAll) {
      idDgeneral = Number(req.user?.id_dgeneral || 0);
      idDauxiliar = Number(req.user?.id_dauxiliar || 0);
    }

    const where = [];
    const params = [];
    let idx = 1;
    const addParam = (v) => {
      params.push(v);
      return `$${idx++}`;
    };

    if (Number.isFinite(anio) && anio > 0) {
      const anioParam = addParam(anio);
      const anioText = addParam(`${anio}-`);
      where.push(
        `(EXTRACT(YEAR FROM pd.fecha_registro) = ${anioParam} OR pd.mes ILIKE ${anioText} || '%')`
      );
    }

    if (Number.isFinite(idDgeneral) && idDgeneral > 0) {
      where.push(`pd.id_dgeneral = ${addParam(idDgeneral)}`);
    }

    if (Number.isFinite(idDauxiliar) && idDauxiliar > 0) {
      where.push(`pd.id_dauxiliar = ${addParam(idDauxiliar)}`);
    }

    const r = await query(
      `
      WITH p AS (
        SELECT
          id_proyecto                          AS project,
          MIN(id_dgeneral)                     AS id_dgeneral,
          MIN(id_dauxiliar)                    AS id_dauxiliar,
          MIN(id_fuente)                       AS id_fuente,
          COUNT(*)                             AS partidas,
          COALESCE(SUM(presupuesto),0)         AS presupuesto_total,
          COALESCE(SUM(total_gastado),0)       AS gastado_total,
          COALESCE(SUM(total_reconducido),0)   AS reconducido_total,
          COALESCE(SUM(saldo_disponible),0)    AS saldo_total
        FROM presupuesto_detalle pd
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY id_proyecto
      )
      SELECT
        p.*,
        dg.clave AS dgeneral_clave,
        da.clave AS dauxiliar_clave
      FROM p
      LEFT JOIN dgeneral dg ON dg.id = p.id_dgeneral
      LEFT JOIN dauxiliar da ON da.id = p.id_dauxiliar
      ORDER BY p.project
      `,
      params
    );

    res.json(r.rows);
  } catch (err) {
    console.error("GET /api/projects", err);
    res.status(500).json({ error: "Error obteniendo proyectos" });
  }
});




/* =====================================================
   DETALLES (partidas por proyecto)
   GET /api/detalles?project=...
   POST /api/detalles
   ===================================================== */

// GET /api/detalles?project=A001...
router.get("/detalles", async (req, res) => {
  try {
    const project = String(req.query.project || "").trim();
    const mes = String(req.query.mes || "").trim(); // YYYY-MM opcional
    if (!project) return res.json([]);

    const r = await query(
      `SELECT id,
              id_proyecto AS "idProyecto",
              partida,
              mes,
              presupuesto,
              fecha_cuando_se_gasto,
              en_que_se_gasto,
              total_gastado,
              fecha_reconduccion,
              motivo_reconduccion,
              total_reconducido,
              saldo_disponible,
              fecha_registro
         FROM presupuesto_detalle
        WHERE id_proyecto = $1
          AND ($2 = '' OR mes = $2)
        ORDER BY partida, mes`,
      [project, mes]
    );

    const rows = Array.isArray(r.rows) ? r.rows : [];
    const allowed = await canViewPartidasMil(req);
    const filtered = allowed
      ? rows
      : rows.filter((row) => !isPartidaMilKey(row?.partida));
    if (!allowed && filtered.length !== rows.length) {
      await logUnauthorizedPartidasAccess(req, {
        motivo: "PARTIDAS_MIL_DETALLES",
        data: { project, mes },
      });
    }
    res.json(filtered);
  } catch (e) {
    console.error("GET /api/detalles error:", e);
    res.status(500).json({ error: "Error obteniendo detalles" });
  }
});

// POST /api/detalles
router.post("/detalles", async (req, res) => {
  try {
    const {
      project,
      partida,
      presupuesto,
      mes, // no se guarda (lo dejamos por compatibilidad)
      id_dgeneral,
      id_dauxiliar,
      id_fuente,
    } = req.body;

    if (!project || !partida || !Number.isFinite(Number(presupuesto))) {
      return res
        .status(400)
        .json({ error: "project, partida y presupuesto son obligatorios" });
    }

    const keys = await getProjectKeys({
      id_proyecto: project,
      id_dgeneral,
      id_dauxiliar,
      id_fuente,
    });

    const client = await getClient();
    try {
      await client.query("BEGIN");

      const sql = `
  INSERT INTO presupuesto_detalle (
    fecha_registro,
    id_dgeneral,
    id_dauxiliar,
    id_fuente,
    id_proyecto,
    partida,
    mes,
    presupuesto,
    total_gastado,
    total_reconducido,
    saldo_disponible
  )
  VALUES (
    NOW(),
    $1,$2,$3,$4,$5,$6,$7,
    0,0,
    $7
  )
  ON CONFLICT (id_proyecto, partida, mes)
  DO UPDATE SET
    presupuesto      = presupuesto_detalle.presupuesto + EXCLUDED.presupuesto,
    saldo_disponible = presupuesto_detalle.saldo_disponible + EXCLUDED.presupuesto
  RETURNING *;
`;

      const params = [
  keys.id_dgeneral,
  keys.id_dauxiliar,
  keys.id_fuente,
  keys.id_proyecto,
  partida,
  mes,
  Number(presupuesto),
];

      const { rows } = await client.query(sql, params);
      await client.query("COMMIT");
      return res.json(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("POST /api/detalles error:", err);
      return res.status(500).json({ error: "Error guardando detalle" });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /api/detalles error (outer):", err);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message || "Error guardando detalle" });
  }
});

/* =====================================================
   GASTOS
   GET /api/gastos?project=...
   POST /api/gastos
   DELETE /api/gastos/:id
   ===================================================== */

router.get("/gastos", async (req, res) => {
  try {
    const project = String(req.query.project || "").trim();
    if (!project) return res.json([]);

    const r = await query(
      `SELECT id,
              id_proyecto AS "idProyecto",
              partida,
              fecha,
              descripcion,
              monto
         FROM public.gastos_detalle
        WHERE id_proyecto = $1
        ORDER BY fecha DESC, id DESC`,
      [project]
    );

    const rows = Array.isArray(r.rows) ? r.rows : [];
    const allowed = await canViewPartidasMil(req);
    const filtered = allowed
      ? rows
      : rows.filter((row) => !isPartidaMilKey(row?.partida));
    if (!allowed && filtered.length !== rows.length) {
      await logUnauthorizedPartidasAccess(req, {
        motivo: "PARTIDAS_MIL_GASTOS",
        data: { project },
      });
    }
    res.json(filtered);
  } catch (e) {
    console.error("GET /api/gastos", e);
    res.status(500).json({ error: "Error obteniendo gastos" });
  }
});

router.post("/gastos", async (req, res) => {
  try {
    const project = String(req.body.project || "").trim();
    const partida = String(req.body.partida || "").trim();
    const monto = Number(req.body.monto || 0);
    const fecha = req.body.fecha || null;
    const descripcion = req.body.descripcion || null;

    if (!project) return res.status(400).json({ error: "project es obligatorio" });
    if (!partida || isNaN(monto) || monto <= 0) {
      return res.status(400).json({ error: "partida y monto > 0 requeridos" });
    }

    const client = await getClient();
    try {
      await client.query("BEGIN");

      const detResult = await client.query(
        `
        SELECT id_dgeneral,
               id_dauxiliar,
               id_fuente,
               presupuesto,
               total_gastado,
               total_reconducido
          FROM presupuesto_detalle
         WHERE id_proyecto = $1
           AND partida      = $2
         FOR UPDATE
        `,
        [project, partida]
      );

      if (!detResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "No existe presupuesto para la partida seleccionada en este proyecto.",
        });
      }

      let {
        id_dgeneral,
        id_dauxiliar,
        id_fuente,
        presupuesto,
        total_reconducido,
      } = detResult.rows[0];

      // fallback por si hay filas viejas sin llaves
      if (id_dgeneral == null || id_dauxiliar == null || id_fuente == null) {
        const keysFallback = await client.query(
          `
          SELECT id_dgeneral, id_dauxiliar, id_fuente
            FROM presupuesto_detalle
           WHERE id_proyecto = $1
             AND id_dgeneral IS NOT NULL
             AND id_dauxiliar IS NOT NULL
             AND id_fuente IS NOT NULL
           ORDER BY id
           LIMIT 1
          `,
          [project]
        );

        if (!keysFallback.rows.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error:
              "No se encontraron llaves de catálogo (id_dgeneral, id_dauxiliar, id_fuente) para este proyecto. " +
              "Elimina el proyecto y vuélvelo a crear desde la pantalla 'Crear proyecto'.",
          });
        }

        id_dgeneral = keysFallback.rows[0].id_dgeneral;
        id_dauxiliar = keysFallback.rows[0].id_dauxiliar;
        id_fuente = keysFallback.rows[0].id_fuente;
      }

      await client.query(
        `
        INSERT INTO public.gastos_detalle (
          id_dgeneral,
          id_dauxiliar,
          id_fuente,
          id_proyecto,
          partida,
          fecha,
          descripcion,
          monto
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          id_dgeneral,
          id_dauxiliar,
          id_fuente,
          project,
          partida,
          fecha,
          descripcion,
          monto,
        ]
      );

      const tot = await client.query(
        `
        SELECT COALESCE(SUM(monto),0) AS total_gastado
          FROM public.gastos_detalle
         WHERE id_proyecto = $1
           AND partida      = $2
        `,
        [project, partida]
      );
      const total_gastado = Number(tot.rows[0].total_gastado || 0);

      const saldo = computeSaldo({
        presupuesto,
        total_gastado,
        total_reconducido,
      });

      const upd = await client.query(
        `
        UPDATE presupuesto_detalle
           SET total_gastado    = $1,
               saldo_disponible = $2
         WHERE id_proyecto = $3
           AND partida      = $4
         RETURNING *
        `,
        [total_gastado, saldo, project, partida]
      );

      await client.query("COMMIT");
      return res.json({ ok: true, detalle: upd.rows[0] });
    } catch (txErr) {
      await client.query("ROLLBACK");
      console.error("POST /api/gastos (tx) error:", txErr);
      return res.status(500).json({ error: "Error guardando gasto" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("POST /api/gastos error:", e);
    res.status(500).json({ error: "Error guardando gasto" });
  }
});

router.delete("/gastos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const client = await getClient();
    try {
      await client.query("BEGIN");

      const old = await client.query(
        `SELECT id_proyecto AS "idProyecto", partida
           FROM public.gastos_detalle
          WHERE id = $1`,
        [id]
      );

      if (!old.rows.length) {
        await client.query("ROLLBACK");
        return res.json({ ok: true, deleted: false });
      }

      const { idProyecto, partida } = old.rows[0];

      await client.query(`DELETE FROM public.gastos_detalle WHERE id = $1`, [id]);

      const tot = await client.query(
        `SELECT COALESCE(SUM(monto),0) AS total_gastado
           FROM public.gastos_detalle
          WHERE id_proyecto = $1 AND partida = $2`,
        [idProyecto, partida]
      );
      const total_gastado = Number(tot.rows[0].total_gastado || 0);

      const det = await client.query(
        `SELECT presupuesto, total_reconducido
           FROM presupuesto_detalle
          WHERE id_proyecto = $1 AND partida = $2`,
        [idProyecto, partida]
      );

      if (!det.rows.length) {
        await client.query("COMMIT");
        return res.json({ ok: true, deleted: true, detalle: null });
      }

      const row = det.rows[0];
      const saldo = computeSaldo({
        presupuesto: row.presupuesto,
        total_gastado,
        total_reconducido: row.total_reconducido,
      });

      const upd = await client.query(
        `UPDATE presupuesto_detalle
            SET total_gastado    = $1,
                saldo_disponible = $2
          WHERE id_proyecto = $3 AND partida = $4
          RETURNING *`,
        [total_gastado, saldo, idProyecto, partida]
      );

      await client.query("COMMIT");
      res.json({ ok: true, deleted: true, detalle: upd.rows[0] });
    } catch (txErr) {
      await client.query("ROLLBACK");
      console.error("DELETE /api/gastos/:id (tx)", txErr);
      res.status(500).json({ error: "Error eliminando gasto" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("DELETE /api/gastos/:id (outer)", e);
    res.status(500).json({ error: "Error eliminando gasto" });
  }
});

/* =====================================================
   RECONDUCCIÓN
   POST /api/reconducir
   ===================================================== */

router.post("/reconducir", async (req, res) => {
  try {
    const project = String(req.body.project || "").trim();
    const origen = String(req.body.origen || "").trim();
    const destino = String(req.body.destino || "").trim();
    const monto = Number(req.body.monto || 0);
    const concepto = req.body.concepto || null;
    const fecha = req.body.fecha || null;

    if (!project) return res.status(400).json({ error: "project es obligatorio" });
    if (!origen || !destino || isNaN(monto) || monto <= 0) {
      return res.status(400).json({ error: "origen, destino y monto > 0 requeridos" });
    }

    const client = await getClient();
    try {
      await client.query("BEGIN");

      const qOrigen = await client.query(
        `SELECT id_dgeneral,
                id_dauxiliar,
                id_fuente,
                presupuesto,
                total_gastado,
                total_reconducido
           FROM presupuesto_detalle
          WHERE id_proyecto = $1
            AND partida      = $2
          FOR UPDATE`,
        [project, origen]
      );

      if (!qOrigen.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "No existe presupuesto para la partida origen en este proyecto.",
        });
      }

      const origenRow = qOrigen.rows[0];

      let qDestino = await client.query(
        `SELECT id_dgeneral,
                id_dauxiliar,
                id_fuente,
                presupuesto,
                total_gastado,
                total_reconducido
           FROM presupuesto_detalle
          WHERE id_proyecto = $1
            AND partida      = $2
          FOR UPDATE`,
        [project, destino]
      );

      if (!qDestino.rows.length) {
        await client.query(
          `INSERT INTO presupuesto_detalle (
             fecha_registro,
             id_dgeneral,
             id_dauxiliar,
             id_fuente,
             id_proyecto,
             partida,
             presupuesto,
             total_gastado,
             total_reconducido,
             saldo_disponible
           )
           VALUES (NOW(), $1,$2,$3, $4, $5, 0,0,0,0)`,
          [
            origenRow.id_dgeneral,
            origenRow.id_dauxiliar,
            origenRow.id_fuente,
            project,
            destino,
          ]
        );

        qDestino = await client.query(
          `SELECT id_dgeneral,
                  id_dauxiliar,
                  id_fuente,
                  presupuesto,
                  total_gastado,
                  total_reconducido
             FROM presupuesto_detalle
            WHERE id_proyecto = $1
              AND partida      = $2
            FOR UPDATE`,
          [project, destino]
        );
      }

      const destinoRow = qDestino.rows[0];

      const nuevoReconOrigen = Number(origenRow.total_reconducido || 0) - monto;

      const saldoOrigen = computeSaldo({
        presupuesto: origenRow.presupuesto,
        total_gastado: origenRow.total_gastado,
        total_reconducido: nuevoReconOrigen,
      });

      await client.query(
        `UPDATE presupuesto_detalle
            SET total_reconducido  = $1,
                fecha_reconduccion = COALESCE($2, fecha_reconduccion),
                motivo_reconduccion= COALESCE($3, motivo_reconduccion),
                saldo_disponible   = $4
          WHERE id_proyecto = $5
            AND partida      = $6`,
        [nuevoReconOrigen, fecha, concepto, saldoOrigen, project, origen]
      );

      const nuevoReconDestino = Number(destinoRow.total_reconducido || 0) + monto;

      const saldoDestino = computeSaldo({
        presupuesto: destinoRow.presupuesto,
        total_gastado: destinoRow.total_gastado,
        total_reconducido: nuevoReconDestino,
      });

      await client.query(
        `UPDATE presupuesto_detalle
            SET total_reconducido  = $1,
                fecha_reconduccion = COALESCE($2, fecha_reconduccion),
                motivo_reconduccion= COALESCE($3, motivo_reconduccion),
                saldo_disponible   = $4
          WHERE id_proyecto = $5
            AND partida      = $6`,
        [nuevoReconDestino, fecha, concepto, saldoDestino, project, destino]
      );

      await client.query("COMMIT");
      return res.json({
        ok: true,
        origenNegativo: saldoOrigen < 0,
        saldos: { origen: saldoOrigen, destino: saldoDestino },
      });
    } catch (txErr) {
      await client.query("ROLLBACK");
      console.error("POST /api/reconducir", txErr);
      return res.status(500).json({ error: "Error en reconducción" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("POST /api/reconducir", e);
    res.status(500).json({ error: "Error en reconducción" });
  }
});

/* =====================================================
   Borrar todo un proyecto
   DELETE /api/project?project=...
   ===================================================== */
router.delete("/project", async (req, res) => {
  try {
    const project = String(req.query.project || "").trim();
    if (!project) return res.status(400).json({ error: "project es obligatorio" });

    const r = await query("DELETE FROM presupuesto_detalle WHERE id_proyecto = $1", [project]);
    res.json({ ok: true, deleted_rows: r.rowCount });
  } catch (e) {
    console.error("DELETE /api/project", e);
    res.status(500).json({ error: "No se pudo borrar el proyecto" });
  }
});

/* =====================================================
   Checadores de duplicados (si los usas aún)
   GET /api/check-duplicates
   GET /api/check-recon-duplicates
   ===================================================== */
router.get("/check-duplicates", async (req, res) => {
  try {
    const { project, partida } = req.query;
    const result = await query(
      `SELECT partida, presupuesto, fecha_registro
         FROM public.presupuesto_detalle
        WHERE id_proyecto = $1 AND partida = $2
        ORDER BY fecha_registro DESC`,
      [project, partida]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/check-duplicates", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

router.get("/check-recon-duplicates", async (req, res) => {
  try {
    const { project, origen, destino, monto } = req.query;
    const result = await query(
      `SELECT origen, destino, monto, fecha_reconduccion
         FROM public.reconducciones
        WHERE id_proyecto = $1 AND origen = $2 AND destino = $3 AND monto = $4
        ORDER BY fecha_reconduccion DESC`,
      [project, origen, destino, monto]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/check-recon-duplicates", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
