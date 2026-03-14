/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Script de Build — Ofuscación para Producción
 *  Archivo: build.js
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

/**
 * ================================================================
 *  BUILD SCRIPT — OFUSCACIÓN DE FRONTEND PARA PRODUCCIÓN
 * ================================================================
 *
 *  Uso:
 *    node build.js                  → Ofusca todos los archivos JS
 *    node build.js --file login.js  → Ofusca un archivo específico
 *
 *  Entrada:  server/public/js/*.js        (código fuente legible)
 *  Salida:   server/public/dist/js/*.js   (código ofuscado)
 *
 *  El servidor en NODE_ENV=production sirve de dist/js/
 *  El servidor en NODE_ENV=development sirve de js/ (sin ofuscar)
 *
 * ================================================================
 */

import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JavaScriptObfuscator from "javascript-obfuscator";
import { obfuscatorOptions } from "./obfuscator.config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// =====================================================
//  RUTAS DE ENTRADA Y SALIDA
// =====================================================
const DIR_FUENTE = path.join(__dirname, "public", "js");
const DIR_SALIDA = path.join(__dirname, "public", "dist", "js");

// =====================================================
//  ARCHIVOS A EXCLUIR DEL PROCESO (libs de terceros, etc.)
// =====================================================
const EXCLUIR = new Set([
  // Agrega aquí archivos que NO quieras ofuscar
]);

// =====================================================
//  FUNCIÓN PRINCIPAL
// =====================================================
async function construirProduccion() {
  const inicioTotal = Date.now();
  const argArchivo  = process.argv.includes("--file")
    ? process.argv[process.argv.indexOf("--file") + 1]
    : null;

  console.log("=".repeat(60));
  console.log("  CONTROL PRESUPUESTAL — BUILD DE PRODUCCIÓN");
  console.log("  Humberto Salvador Ruiz Lucio");
  console.log("=".repeat(60));

  // Crear carpeta de salida si no existe
  if (!existsSync(DIR_SALIDA)) {
    await mkdir(DIR_SALIDA, { recursive: true });
    console.log(`\n[BUILD] Carpeta de salida creada: ${DIR_SALIDA}`);
  }

  // Obtener lista de archivos a procesar
  let archivos = (await readdir(DIR_FUENTE)).filter(f => f.endsWith(".js"));

  if (argArchivo) {
    archivos = archivos.filter(f => f === argArchivo);
    if (archivos.length === 0) {
      console.error(`[BUILD][ERROR] Archivo no encontrado: ${argArchivo}`);
      process.exit(1);
    }
  }

  archivos = archivos.filter(f => !EXCLUIR.has(f));

  console.log(`\n[BUILD] Procesando ${archivos.length} archivos...\n`);

  let exitosos = 0;
  let fallidos  = 0;
  const errores = [];

  for (const nombreArchivo of archivos) {
    const rutaEntrada = path.join(DIR_FUENTE, nombreArchivo);
    const rutaSalida  = path.join(DIR_SALIDA, nombreArchivo);
    const inicio      = Date.now();

    try {
      const codigoFuente  = await readFile(rutaEntrada, "utf-8");
      const resultado     = JavaScriptObfuscator.obfuscate(codigoFuente, obfuscatorOptions);
      const codigoOfuscado = resultado.getObfuscatedCode();

      await writeFile(rutaSalida, codigoOfuscado, "utf-8");

      const ms = Date.now() - inicio;
      const kbOrig  = (Buffer.byteLength(codigoFuente, "utf-8")   / 1024).toFixed(1);
      const kbFinal = (Buffer.byteLength(codigoOfuscado, "utf-8") / 1024).toFixed(1);

      console.log(`  [✓] ${nombreArchivo.padEnd(45)} ${kbOrig.padStart(7)} KB → ${kbFinal.padStart(7)} KB  (${ms}ms)`);
      exitosos++;
    } catch (err) {
      const ms = Date.now() - inicio;
      console.error(`  [✗] ${nombreArchivo.padEnd(45)} ERROR (${ms}ms): ${err.message}`);
      errores.push({ archivo: nombreArchivo, error: err.message });
      fallidos++;
    }
  }

  // ── RESUMEN ──────────────────────────────────────────────────
  const tiempoTotal = ((Date.now() - inicioTotal) / 1000).toFixed(2);
  console.log("\n" + "=".repeat(60));
  console.log(`  RESULTADO: ${exitosos} exitosos, ${fallidos} fallidos`);
  console.log(`  Tiempo total: ${tiempoTotal}s`);
  console.log(`  Salida: ${DIR_SALIDA}`);
  if (errores.length > 0) {
    console.log("\n  ERRORES:");
    errores.forEach(e => console.log(`    - ${e.archivo}: ${e.error}`));
  }
  console.log("=".repeat(60) + "\n");

  if (fallidos > 0) process.exit(1);
}

construirProduccion().catch(err => {
  console.error("[BUILD][FATAL]", err);
  process.exit(1);
});
