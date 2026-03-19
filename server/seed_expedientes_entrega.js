/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 * ================================================================
 *  Script: seed_expedientes_entrega.js
 *  Propósito: Carga inicial del CSV de expedientes de entrega
 *             hacia la tabla expedientes_entrega en PostgreSQL.
 *
 *  Uso:
 *    cd server && node seed_expedientes_entrega.js
 *
 *  Notas:
 *    - Deshabilita el trigger trg_expedientes_entrega_auto_populate
 *      durante la carga para preservar concepto/dependencia del CSV.
 *    - Inserta fila por fila; los errores individuales se loguean
 *      y no abortan las demás filas.
 *    - Hace COMMIT de todas las filas exitosas al final.
 * ================================================================
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getClient } from "./db.js";

// =====================================================
//  CONFIGURACIÓN INICIAL
// =====================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================================================
//  CONSTANTES
// =====================================================

const CSV_PATH = path.join(__dirname, "..", "expedientes_entrega.csv");
const LOG_EACH = 20; // Loguear progreso cada N filas insertadas

// =====================================================
//  PARSER CSV MANUAL (maneja comas dentro de comillas)
// =====================================================

/**
 * Parsea una línea CSV respetando campos entre comillas dobles
 * que pueden contener comas internas.
 * @param {string} line - Línea del CSV
 * @returns {string[]} - Array de valores (sin comillas externas)
 */
function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Comilla escapada dentro de campo entrecomillado
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  // Último campo
  fields.push(current);
  return fields;
}

// =====================================================
//  TRANSFORMACIONES DE CAMPOS
// =====================================================

/**
 * Convierte fecha de DD/MM/YYYY a YYYY-MM-DD.
 * Retorna null si el valor está vacío o tiene formato inválido.
 * @param {string} val
 * @returns {string|null}
 */
function parseFecha(val) {
  const s = (val || "").trim();
  if (!s) return null;
  const partes = s.split("/");
  if (partes.length !== 3) return null;
  const [dd, mm, yyyy] = partes;
  if (!dd || !mm || !yyyy) return null;
  // Validación básica de rango
  const day = parseInt(dd, 10);
  const month = parseInt(mm, 10);
  const year = parseInt(yyyy, 10);
  if (
    isNaN(day) || isNaN(month) || isNaN(year) ||
    day < 1 || day > 31 ||
    month < 1 || month > 12 ||
    year < 1900 || year > 2100
  ) {
    return null;
  }
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/**
 * Parsea importe como número decimal.
 * Si el string contiene más de un punto devuelve 0 y señala advertencia.
 * @param {string} val
 * @param {string} folio - Para mensaje de advertencia
 * @param {{ advertencias: number }} stats - Objeto de estadísticas mutable
 * @returns {number}
 */
function parseImporte(val, folio, stats) {
  const s = (val || "").trim();
  if (!s) return 0;

  const puntos = (s.match(/\./g) || []).length;
  if (puntos > 1) {
    console.warn(
      `[WARN] Importe malformado "${s}" en folio "${folio}" — se usará 0`
    );
    stats.advertencias++;
    return 0;
  }

  const n = parseFloat(s);
  if (!Number.isFinite(n)) {
    console.warn(
      `[WARN] Importe no numérico "${s}" en folio "${folio}" — se usará 0`
    );
    stats.advertencias++;
    return 0;
  }
  return n;
}

/**
 * Convierte "true" (case-insensitive) a booleano true; todo lo demás → false.
 * @param {string} val
 * @returns {boolean}
 */
function parseBool(val) {
  return (val || "").trim().toLowerCase() === "true";
}

/**
 * Retorna null si el string (ya trimado) está vacío.
 * @param {string} val
 * @returns {string|null}
 */
function nullIfEmpty(val) {
  const s = (val || "").trim();
  return s === "" ? null : s;
}

/**
 * Retorna un entero positivo o null.
 * @param {string} val
 * @returns {number|null}
 */
function parseIntOrNull(val) {
  const s = (val || "").trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// =====================================================
//  LECTURA Y TRANSFORMACIÓN DEL CSV
// =====================================================

/**
 * Lee el CSV con encoding latin1 y retorna un array de objetos
 * listos para insertar, junto con warnings y filas omitidas.
 * @returns {{ filas: object[], omitidas: number, advertencias: number }}
 */
function leerCSV() {
  const contenido = fs.readFileSync(CSV_PATH, { encoding: "latin1" });
  const lineas = contenido.split(/\r?\n/);

  // Saltar encabezado (línea 0) y líneas vacías al final
  const datos = lineas.slice(1).filter((l) => l.trim() !== "");

  const filas = [];
  let omitidas = 0;
  const stats = { advertencias: 0 };

  // Nombres de columnas en orden del CSV
  // id,anio,mes,id_suficiencia,id_comprometido,id_devengado,
  // id_dgeneral,id_dauxiliar,partida_clave,folio,dependencia,concepto,
  // importe,entrego_comprometido,entrego_devengado,
  // fecha_entrega_tesoreria,fecha_recibido_presupuesto,
  // estatus,observaciones,creado_por,creado_en,actualizado_en
  const IDX = {
    id: 0,
    anio: 1,
    mes: 2,
    id_suficiencia: 3,
    id_comprometido: 4,
    id_devengado: 5,
    id_dgeneral: 6,
    id_dauxiliar: 7,
    partida_clave: 8,
    folio: 9,
    dependencia: 10,
    concepto: 11,
    importe: 12,
    entrego_comprometido: 13,
    entrego_devengado: 14,
    fecha_entrega_tesoreria: 15,
    fecha_recibido_presupuesto: 16,
    estatus: 17,
    observaciones: 18,
    creado_por: 19,
    // creado_en (20) y actualizado_en (21) → ignorados, usa DEFAULT de DB
  };

  for (let i = 0; i < datos.length; i++) {
    const lineaNum = i + 2; // +2 porque saltamos el header y es 1-indexed
    const campos = parseCSVLine(datos[i]);

    // Extraer folio antes de cualquier otra validación
    const folioRaw = (campos[IDX.folio] || "").trim();

    if (!folioRaw) {
      console.warn(
        `[WARN] Fila ${lineaNum}: folio vacío — fila omitida`
      );
      omitidas++;
      stats.advertencias++;
      continue;
    }

    const importe = parseImporte(
      campos[IDX.importe],
      folioRaw,
      stats
    );

    // Estatus: trim + uppercase; vacío → "ENTREGADO"
    const estatusRaw = (campos[IDX.estatus] || "").trim().toUpperCase();
    const estatus = estatusRaw === "" ? "ENTREGADO" : estatusRaw;

    filas.push({
      anio: parseIntOrNull(campos[IDX.anio]),
      mes: parseIntOrNull(campos[IDX.mes]),
      id_suficiencia: parseIntOrNull(campos[IDX.id_suficiencia]),
      id_comprometido: parseIntOrNull(campos[IDX.id_comprometido]),
      id_devengado: parseIntOrNull(campos[IDX.id_devengado]),
      id_dgeneral: parseIntOrNull(campos[IDX.id_dgeneral]),
      id_dauxiliar: parseIntOrNull(campos[IDX.id_dauxiliar]),
      partida_clave: nullIfEmpty(campos[IDX.partida_clave]),
      folio: folioRaw,
      dependencia: (campos[IDX.dependencia] || "").trim(),
      concepto: (campos[IDX.concepto] || "").trim(),
      importe,
      entrego_comprometido: parseBool(campos[IDX.entrego_comprometido]),
      entrego_devengado: parseBool(campos[IDX.entrego_devengado]),
      fecha_entrega_tesoreria: parseFecha(campos[IDX.fecha_entrega_tesoreria]),
      fecha_recibido_presupuesto: parseFecha(campos[IDX.fecha_recibido_presupuesto]),
      estatus,
      observaciones: nullIfEmpty(campos[IDX.observaciones]),
      creado_por: nullIfEmpty(campos[IDX.creado_por]),
    });
  }

  return { filas, omitidas, advertencias: stats.advertencias };
}

// =====================================================
//  INSERCIÓN EN BASE DE DATOS
// =====================================================

const SQL_INSERT = `
  INSERT INTO expedientes_entrega (
    anio, mes,
    id_suficiencia, id_comprometido, id_devengado,
    id_dgeneral, id_dauxiliar,
    partida_clave, folio,
    dependencia, concepto,
    importe,
    entrego_comprometido, entrego_devengado,
    fecha_entrega_tesoreria, fecha_recibido_presupuesto,
    estatus, observaciones, creado_por
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
`;

/**
 * Ejecuta la carga masiva dentro de una transacción.
 * Deshabilita el trigger de auto-populate al inicio y lo rehabilita
 * antes del COMMIT para preservar concepto/dependencia del CSV.
 */
async function seedExpedientes() {
  console.log("[SEED] Leyendo CSV desde:", CSV_PATH);

  const { filas, omitidas, advertencias: advertenciasLectura } = leerCSV();

  console.log(
    `[SEED] CSV procesado: ${filas.length} filas válidas, ` +
    `${omitidas} omitidas (folio vacío)`
  );

  if (filas.length === 0) {
    console.log("[SEED] No hay filas para insertar. Finalizando.");
    return;
  }

  const client = await getClient();

  const stats = {
    insertadas: 0,
    errores: 0,
    advertencias: advertenciasLectura,
  };

  try {
    await client.query("BEGIN");

    // Deshabilitar trigger para preservar concepto/dependencia del CSV
    await client.query(
      "ALTER TABLE expedientes_entrega DISABLE TRIGGER trg_expedientes_entrega_auto_populate"
    );
    console.log("[SEED] Trigger trg_expedientes_entrega_auto_populate DESHABILITADO");

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const filaNum = i + 1;

      try {
        await client.query(SQL_INSERT, [
          fila.anio,
          fila.mes,
          fila.id_suficiencia,
          fila.id_comprometido,
          fila.id_devengado,
          fila.id_dgeneral,
          fila.id_dauxiliar,
          fila.partida_clave,
          fila.folio,
          fila.dependencia,
          fila.concepto,
          fila.importe,
          fila.entrego_comprometido,
          fila.entrego_devengado,
          fila.fecha_entrega_tesoreria,
          fila.fecha_recibido_presupuesto,
          fila.estatus,
          fila.observaciones,
          fila.creado_por,
        ]);

        stats.insertadas++;

        // Loguear progreso cada LOG_EACH filas insertadas exitosamente
        if (stats.insertadas % LOG_EACH === 0) {
          console.log(
            `[SEED] [${stats.insertadas}/${filas.length}] ` +
            `folio "${fila.folio}" insertado`
          );
        }
      } catch (e) {
        stats.errores++;
        console.error(
          `[SEED][ERROR] Fila ${filaNum}, folio "${fila.folio}": ${e.message}`
        );
      }
    }

    // Rehabilitar trigger antes del COMMIT
    await client.query(
      "ALTER TABLE expedientes_entrega ENABLE TRIGGER trg_expedientes_entrega_auto_populate"
    );
    console.log("[SEED] Trigger trg_expedientes_entrega_auto_populate REHABILITADO");

    await client.query("COMMIT");
    console.log("[SEED] COMMIT realizado.");

  } catch (e) {
    console.error("[SEED][FATAL] Error inesperado, realizando ROLLBACK:", e);
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("[SEED][FATAL] Error durante ROLLBACK:", rollbackErr);
    }
    process.exit(1);
  } finally {
    client.release();
  }

  // =====================================================
  //  RESUMEN FINAL
  // =====================================================
  console.log("\n========================================");
  console.log("  RESUMEN DE CARGA");
  console.log("========================================");
  console.log(`  Filas en CSV (sin header):  ${filas.length + omitidas}`);
  console.log(`  Omitidas (folio vacío):     ${omitidas}`);
  console.log(`  Insertadas exitosamente:    ${stats.insertadas}`);
  console.log(`  Errores de inserción:       ${stats.errores}`);
  console.log(`  Advertencias (datos):       ${stats.advertencias}`);
  console.log("========================================");
  console.log(
    `\n  Insertadas: ${stats.insertadas} | ` +
    `Advertencias: ${stats.advertencias} | ` +
    `Errores: ${stats.errores}`
  );
}

// =====================================================
//  ENTRADA PRINCIPAL
// =====================================================

seedExpedientes()
  .then(() => {
    console.log("[SEED] Script finalizado.");
    process.exit(0);
  })
  .catch((e) => {
    console.error("[SEED][FATAL] Error no capturado:", e);
    process.exit(1);
  });
