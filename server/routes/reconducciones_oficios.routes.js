/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: API — Oficios de Reconducciones
 *  Archivo: reconducciones_oficios.routes.js
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
// =====================================================
//  RECONDUCCIONES OFICIOS — Subida y descarga de PDFs
//  Almacena el oficio físico escaneado asociado a cada
//  reconducción como respaldo del trámite.
//
//  Endurecimiento (Fase 3C — C-8):
//   - mkdir recursivo de UPLOADS_DIR al cargar el módulo.
//   - Nombre interno UUID + .pdf (impredecible, sin colisión).
//   - Límite estricto de tamaño/files/fields en multer.
//   - Validación de mimetype + extensión EN multer.
//   - Validación de magic bytes (%PDF-) POST-upload.
//   - Rechazo de archivos vacíos.
//   - Sanitización de originalname antes de BD y Content-Disposition.
//   - Guardia anti path traversal en descarga.
//   - Manejo localizado de MulterError → 400 legible.
// =====================================================
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { query } from "../db.js";
import {
  ensureUploadsDir,
  sanitizeFilename,
  validatePdfMagicBytes,
  resolveInsideDir,
  isPdfMimetypeAndExt,
} from "../utils/upload-pdf.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, "..", "uploads", "oficios");

// Garantizar la carpeta al cargar el módulo (idempotente).
ensureUploadsDir(UPLOADS_DIR);
console.log("[OFICIOS] uploads dir:", UPLOADS_DIR);

// =====================================================
//  CONFIGURACIÓN DE MULTER (endurecida)
// =====================================================
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, _file, cb) => {
    // Nombre interno impredecible: UUID v4 + .pdf
    cb(null, `${crypto.randomUUID()}.pdf`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB máx
    files: 1,
    fields: 10,
  },
  fileFilter: (_req, file, cb) => {
    // Filtro inicial: mimetype declarado + extensión declarada.
    // Los magic bytes se verifican DESPUÉS de escribir el archivo.
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("mimetype_invalido"));
    }
    if (!isPdfMimetypeAndExt(file)) {
      return cb(new Error("extension_invalida"));
    }
    cb(null, true);
  },
});

// =====================================================
//  uploadOficioMiddleware — envuelve upload.single("oficio")
//  Convierte MulterError y errores del fileFilter en respuestas
//  400 legibles. No deja que llegue al manejador global.
// =====================================================
function uploadOficioMiddleware(req, res, next) {
  upload.single("oficio")(req, res, (err) => {
    if (!err) return next();
    const traceId = req.cpTraceId;
    if (err instanceof multer.MulterError) {
      let msg = "Error al subir el archivo";
      if (err.code === "LIMIT_FILE_SIZE") msg = "El archivo excede el tamaño máximo permitido (10 MB)";
      else if (err.code === "LIMIT_FILE_COUNT") msg = "Solo se permite un archivo";
      else if (err.code === "LIMIT_UNEXPECTED_FILE") msg = "Campo de archivo inesperado";
      else if (err.code === "LIMIT_PART_COUNT" || err.code === "LIMIT_FIELD_COUNT") {
        msg = "Formulario con demasiados campos";
      }
      return res.status(400).json({ error: msg, trace_id: traceId });
    }
    // Errores del fileFilter (mimetype/extensión)
    const code = String(err?.message || "");
    if (code === "mimetype_invalido") {
      return res.status(400).json({ error: "Solo se permiten archivos PDF (mimetype inválido)", trace_id: traceId });
    }
    if (code === "extension_invalida") {
      return res.status(400).json({ error: "Solo se permiten archivos con extensión .pdf", trace_id: traceId });
    }
    console.error("[RECONDUCCIONES_OFICIOS][UPLOAD] Error inesperado:", err);
    return res.status(400).json({ error: "No se pudo procesar el archivo", trace_id: traceId });
  });
}

// =====================================================
//  POST /:id/oficio — Subir PDF del oficio
// =====================================================
router.post("/:id/oficio", uploadOficioMiddleware, async (req, res) => {
  const traceId = req.cpTraceId;
  const idReconduccion = Number(req.params.id);
  if (!Number.isFinite(idReconduccion) || idReconduccion <= 0) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: "ID de reconducción inválido", trace_id: traceId });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No se recibió ningún archivo PDF", trace_id: traceId });
  }

  // Rechazar archivos vacíos antes de hacer cualquier otra cosa.
  if (!req.file.size || req.file.size === 0) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: "El archivo está vacío", trace_id: traceId });
  }

  // Validar magic bytes (%PDF-) — defensa contra archivos renombrados.
  const esPdfReal = await validatePdfMagicBytes(req.file.path);
  if (!esPdfReal) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: "Archivo no es PDF válido", trace_id: traceId });
  }

  try {
    // Verificar que la reconducción existe
    const rRecon = await query(
      "SELECT id, created_by FROM reconducciones WHERE id = $1 LIMIT 1",
      [idReconduccion]
    );
    if (rRecon.rowCount === 0) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: "Reconducción no encontrada", trace_id: traceId });
    }

    const recon = rRecon.rows[0];
    const roles = req.user?.roles || [];
    const isGodOrAdmin = roles.includes("GOD") || roles.includes("ADMIN");
    const isOwner = Number(recon.created_by) === Number(req.user?.id);

    if (!isGodOrAdmin && !isOwner) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: "No tienes permiso para modificar esta reconducción", trace_id: traceId });
    }

    // Nombre original saneado para BD (defensa CRLF / caracteres peligrosos).
    const nombreSanitizado = sanitizeFilename(req.file.originalname);

    // Si ya existe un oficio anterior, eliminar el archivo físico
    const rExistente = await query(
      "SELECT id, ruta_archivo FROM reconduccion_oficios WHERE id_reconduccion = $1 LIMIT 1",
      [idReconduccion]
    );
    if (rExistente.rowCount > 0) {
      const rutaAnterior = rExistente.rows[0].ruta_archivo;
      // Resolver de forma segura para eliminar el archivo previo.
      const rutaFisicaAnterior = resolveInsideDir(UPLOADS_DIR, rutaAnterior);
      if (rutaFisicaAnterior) {
        await fs.unlink(rutaFisicaAnterior).catch(() => {});
      }

      // Actualizar registro existente
      const rutaRelativa = path.join("uploads", "oficios", req.file.filename).replace(/\\/g, "/");
      const rUpd = await query(
        `UPDATE reconduccion_oficios
         SET nombre_archivo = $1, ruta_archivo = $2, tamano_bytes = $3,
             subido_por = $4, fecha_subida = NOW()
         WHERE id_reconduccion = $5
         RETURNING id, nombre_archivo, tamano_bytes, fecha_subida`,
        [nombreSanitizado, rutaRelativa, req.file.size, req.user.id, idReconduccion]
      );
      return res.json(rUpd.rows[0]);
    }

    // Insertar nuevo registro
    const rutaRelativa = path.join("uploads", "oficios", req.file.filename).replace(/\\/g, "/");
    const rIns = await query(
      `INSERT INTO reconduccion_oficios (id_reconduccion, nombre_archivo, ruta_archivo, tamano_bytes, subido_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre_archivo, tamano_bytes, fecha_subida`,
      [idReconduccion, nombreSanitizado, rutaRelativa, req.file.size, req.user.id]
    );
    return res.status(201).json(rIns.rows[0]);
  } catch (e) {
    console.error("[RECONDUCCIONES_OFICIOS][POST] Error:", e);
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    return res.status(500).json({ error: "Error al guardar el oficio", trace_id: traceId });
  }
});

// =====================================================
//  GET /:id/oficio — Metadata del oficio (o null)
// =====================================================
router.get("/:id/oficio", async (req, res) => {
  const traceId = req.cpTraceId;
  const idReconduccion = Number(req.params.id);
  if (!Number.isFinite(idReconduccion) || idReconduccion <= 0) {
    return res.status(400).json({ error: "ID de reconducción inválido", trace_id: traceId });
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
    return res.status(500).json({ error: "Error al obtener info del oficio", trace_id: traceId });
  }
});

// =====================================================
//  GET /:id/oficio/descargar — Descargar el PDF
// =====================================================
router.get("/:id/oficio/descargar", async (req, res) => {
  const traceId = req.cpTraceId;
  const idReconduccion = Number(req.params.id);
  if (!Number.isFinite(idReconduccion) || idReconduccion <= 0) {
    return res.status(400).json({ error: "ID de reconducción inválido", trace_id: traceId });
  }

  try {
    const r = await query(
      "SELECT nombre_archivo, ruta_archivo FROM reconduccion_oficios WHERE id_reconduccion = $1 LIMIT 1",
      [idReconduccion]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "No hay oficio registrado para esta reconducción", trace_id: traceId });
    }

    const { nombre_archivo, ruta_archivo } = r.rows[0];

    // Guardia anti path traversal: resolver SIEMPRE dentro de UPLOADS_DIR.
    // path.basename neutraliza cualquier "../" en registros corruptos/legacy.
    const rutaFisica = resolveInsideDir(UPLOADS_DIR, ruta_archivo);
    if (!rutaFisica) {
      return res.status(403).json({ error: "path_invalido", trace_id: traceId });
    }

    if (!existsSync(rutaFisica)) {
      return res.status(404).json({ error: "El archivo PDF no se encontró en el servidor", trace_id: traceId });
    }

    // Sanitizar nombre para Content-Disposition (defensa en profundidad).
    const nombreDescarga = sanitizeFilename(nombre_archivo);
    return res.download(rutaFisica, nombreDescarga);
  } catch (e) {
    console.error("[RECONDUCCIONES_OFICIOS][DESCARGAR] Error:", e);
    return res.status(500).json({ error: "Error al descargar el oficio", trace_id: traceId });
  }
});

export default router;
