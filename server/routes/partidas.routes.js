import { Router } from "express";
import { query } from "../db.js";

const router = Router();

/**
 * Espera tabla: public.partidas
 * Columnas usadas: id (serial), clave (varchar), partida (varchar/text)
 *
 * Si tu columna se llama distinto (ej. "partidas" en plural),
 * cambia en SELECT/INSERT/UPDATE esa columna.
 */

// GET /api/catalogos/partidas
router.get("/", async (_req, res) => {
  try {
    const sql = `
      SELECT id, clave, partida
      FROM public.partidas
      ORDER BY clave::text ASC, id ASC
    `;
    const r = await query(sql);
    return res.json(r.rows);
  } catch (e) {
    console.error("[PARTIDAS][GET] Error:", e);
    return res.status(500).json({ error: "Error al listar partidas" });
  }
});

// POST /api/catalogos/partidas   (solo GOD/ADMIN por tu middleware blockPartidasWrite)
router.post("/", async (req, res) => {
  try {
    const clave = String(req.body?.clave || "").trim();
    const partida = String(req.body?.partida || "").trim();

    if (!clave || !partida) {
      return res.status(400).json({ error: "clave y partida son requeridos" });
    }

    const sql = `
      INSERT INTO public.partidas (clave, partida)
      VALUES ($1, $2)
      RETURNING id, clave, partida
    `;
    const r = await query(sql, [clave, partida]);
    return res.status(201).json(r.rows[0]);
  } catch (e) {
    // si tienes UNIQUE(clave) podría caer aquí
    console.error("[PARTIDAS][POST] Error:", e);
    return res.status(500).json({ error: "Error al crear partida" });
  }
});

// PUT /api/catalogos/partidas/:id
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const clave = String(req.body?.clave || "").trim();
    const partida = String(req.body?.partida || "").trim();

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }
    if (!clave || !partida) {
      return res.status(400).json({ error: "clave y partida son requeridos" });
    }

    const sql = `
      UPDATE public.partidas
      SET clave = $1,
          partida = $2
      WHERE id = $3
      RETURNING id, clave, partida
    `;
    const r = await query(sql, [clave, partida, id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "No encontrada" });
    return res.json(r.rows[0]);
  } catch (e) {
    console.error("[PARTIDAS][PUT] Error:", e);
    return res.status(500).json({ error: "Error al actualizar partida" });
  }
});

// DELETE /api/catalogos/partidas/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id inválido" });
    }

    const sql = `
      DELETE FROM public.partidas
      WHERE id = $1
      RETURNING id
    `;
    const r = await query(sql, [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "No encontrada" });

    return res.json({ ok: true });
  } catch (e) {
    console.error("[PARTIDAS][DEL] Error:", e);
    return res.status(500).json({ error: "Error al eliminar partida" });
  }
});

export default router;
