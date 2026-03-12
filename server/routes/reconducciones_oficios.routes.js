// =====================================================
//  RECONDUCCIONES OFICIOS — Subida y descarga de PDFs
//  Almacena el oficio físico escaneado asociado a cada
//  reconducción como respaldo del trámite.
// =====================================================
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { query } from "../db.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, "..", "uploads", "oficios");

// =====================================================
//  CONFIGURACIÓN DE MULTER
// =====================================================
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, _file, cb) => {
    const id = req.params.id || "0";
    const ts = Date.now();
    cb(null, `oficio-${id}-${ts}.pdf`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos PDF"));
    }
  },
});

// =====================================================
//  POST /:id/oficio — Subir PDF del oficio
// =====================================================
router.post("/:id/oficio", upload.single("oficio"), async (req, res) => {
  const idReconduccion = Number(req.params.id);
  if (!Number.isFinite(idReconduccion) || idReconduccion <= 0) {
    return res.status(400).json({ error: "ID de reconducción inválido" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No se recibió ningún archivo PDF" });
  }

  try {
    // Verificar que la reconducción existe
    const rRecon = await query(
      "SELECT id, created_by FROM reconducciones WHERE id = $1 LIMIT 1",
      [idReconduccion]
    );
    if (rRecon.rowCount === 0) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: "Reconducción no encontrada" });
    }

    const recon = rRecon.rows[0];
    const roles = req.user?.roles || [];
    const isGodOrAdmin = roles.includes("GOD") || roles.includes("ADMIN");
    const isOwner = Number(recon.created_by) === Number(req.user?.id);

    if (!isGodOrAdmin && !isOwner) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: "No tienes permiso para modificar esta reconducción" });
    }

    // Si ya existe un oficio anterior, eliminar el archivo físico
    const rExistente = await query(
      "SELECT id, ruta_archivo FROM reconduccion_oficios WHERE id_reconduccion = $1 LIMIT 1",
      [idReconduccion]
    );
    if (rExistente.rowCount > 0) {
      const rutaAnterior = rExistente.rows[0].ruta_archivo;
      const rutaFisica = path.join(__dirname, "..", rutaAnterior);
      await fs.unlink(rutaFisica).catch(() => {});

      // Actualizar registro existente
      const rutaRelativa = path.join("uploads", "oficios", req.file.filename).replace(/\\/g, "/");
      const rUpd = await query(
        `UPDATE reconduccion_oficios
         SET nombre_archivo = $1, ruta_archivo = $2, tamano_bytes = $3,
             subido_por = $4, fecha_subida = NOW()
         WHERE id_reconduccion = $5
         RETURNING id, nombre_archivo, tamano_bytes, fecha_subida`,
        [req.file.originalname, rutaRelativa, req.file.size, req.user.id, idReconduccion]
      );
      return res.json(rUpd.rows[0]);
    }

    // Insertar nuevo registro
    const rutaRelativa = path.join("uploads", "oficios", req.file.filename).replace(/\\/g, "/");
    const rIns = await query(
      `INSERT INTO reconduccion_oficios (id_reconduccion, nombre_archivo, ruta_archivo, tamano_bytes, subido_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre_archivo, tamano_bytes, fecha_subida`,
      [idReconduccion, req.file.originalname, rutaRelativa, req.file.size, req.user.id]
    );
    return res.status(201).json(rIns.rows[0]);
  } catch (e) {
    console.error("[RECONDUCCIONES_OFICIOS][POST] Error:", e);
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(500).json({ error: "Error al guardar el oficio" });
  }
});

// =====================================================
//  GET /:id/oficio — Metadata del oficio (o null)
// =====================================================
router.get("/:id/oficio", async (req, res) => {
  const idReconduccion = Number(req.params.id);
  if (!Number.isFinite(idReconduccion) || idReconduccion <= 0) {
    return res.status(400).json({ error: "ID de reconducción inválido" });
  }

  try {
    const r = await query(
      `SELECT id, nombre_archivo, tamano_bytes, fecha_subida
       FROM reconduccion_oficios
       WHERE id_reconduccion = $1
       LIMIT 1`,
      [idReconduccion]
    );
    if (r.rowCount === 0) return res.json(null);
    return res.json(r.rows[0]);
  } catch (e) {
    console.error("[RECONDUCCIONES_OFICIOS][GET] Error:", e);
    return res.status(500).json({ error: "Error al obtener info del oficio" });
  }
});

// =====================================================
//  GET /:id/oficio/descargar — Descargar el PDF
// =====================================================
router.get("/:id/oficio/descargar", async (req, res) => {
  const idReconduccion = Number(req.params.id);
  if (!Number.isFinite(idReconduccion) || idReconduccion <= 0) {
    return res.status(400).json({ error: "ID de reconducción inválido" });
  }

  try {
    const r = await query(
      "SELECT nombre_archivo, ruta_archivo FROM reconduccion_oficios WHERE id_reconduccion = $1 LIMIT 1",
      [idReconduccion]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "No hay oficio registrado para esta reconducción" });
    }

    const { nombre_archivo, ruta_archivo } = r.rows[0];
    const rutaFisica = path.join(__dirname, "..", ruta_archivo);

    if (!existsSync(rutaFisica)) {
      return res.status(404).json({ error: "El archivo PDF no se encontró en el servidor" });
    }

    return res.download(rutaFisica, nombre_archivo);
  } catch (e) {
    console.error("[RECONDUCCIONES_OFICIOS][DESCARGAR] Error:", e);
    return res.status(500).json({ error: "Error al descargar el oficio" });
  }
});

export default router;
