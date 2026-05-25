/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Generador de plantilla XLSX para carga masiva de suficiencias
 *  Archivo: scripts/generar_plantilla_suficiencias.mjs
 *  Fecha:   2026-05-25
 *
 *  OBJETIVO
 *  --------
 *  Construir un archivo Excel autocontenido (catalogos + 2 hojas para
 *  llenar) que el usuario puede usar para preparar un lote de
 *  suficiencias antes de enviarlo a POST /api/suficiencias/lote.
 *
 *  Modo de uso (dentro del contenedor app):
 *     docker compose exec app node /app/scripts/generar_plantilla_suficiencias.mjs
 *
 *  Salida:
 *     /app/public/plantillas/suficiencias_carga_masiva.xlsx
 *     → descargable desde http://localhost:3000/plantillas/suficiencias_carga_masiva.xlsx
 *
 *  El XLSX trae las siguientes hojas:
 *    00_Instrucciones    Como llenar y reglas obligatorias
 *    01_Suficiencias     1 fila por suficiencia (cabecera)
 *    02_Detalle          N filas por suficiencia (renglones de partidas)
 *    cat_DG              Catalogo de Direcciones Generales (id, clave, nombre)
 *    cat_DA              Catalogo de Direcciones Auxiliares
 *    cat_Proyecto        Catalogo de proyectos
 *    cat_Fuente          Catalogo de fuentes de financiamiento
 *    cat_Partida         Catalogo de partidas presupuestales
 *    cat_Impuesto        Catalogo de tipos de impuesto
 *    cat_Mes             Lista de meses validos (MAYUSCULA)
 * ================================================================
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { query, pool } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "plantillas");
const OUT_FILE = path.join(OUT_DIR, "suficiencias_carga_masiva.xlsx");

const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

// =====================================================
//  HOJA DE INSTRUCCIONES (texto plano renderizado como filas)
// =====================================================
const INSTRUCCIONES = [
  ["PLANTILLA DE CARGA MASIVA DE SUFICIENCIAS PRESUPUESTALES"],
  ["Control Presupuestal Municipal — Ecatepec de Morelos"],
  [""],
  ["1) ESTRUCTURA"],
  ["   - Hoja 01_Suficiencias: una fila por cada suficiencia (cabecera)."],
  ["   - Hoja 02_Detalle: cada renglon de la suficiencia (clave de partida + importe)."],
  ["   - Ambas hojas se ligan por la columna 'id_local', que TU asignas (p.ej. S1, S2, S3...)."],
  [""],
  ["2) REGLAS OBLIGATORIAS"],
  ["   a) Maximo 20 suficiencias por lote (limite del endpoint /api/suficiencias/lote)."],
  ["   b) id_dgeneral, id_dauxiliar, id_proyecto, id_fuente: usar los ID de las hojas cat_*."],
  ["   c) mes_pago: solo se acepta uno de: " + MESES.join(", ")],
  ["   d) fecha (opcional): YYYY-MM-DD. Si la dejas vacia, el sistema usa la fecha del servidor."],
  ["      Solo roles ADMIN o GOD pueden indicar fecha manualmente. Para AREA se ignora."],
  ["   e) impuesto_tipo: usar clave de hoja cat_Impuesto. Si no aplica, escribe NONE."],
  ["   f) IEPS y Pensiones SOLO se aceptan para usuarios de DG L00/117 o E00. Para otros se igualan a 0."],
  ["   g) Partidas mil (clave que empieza con 1): IVA se fuerza a 0 automaticamente."],
  ["   h) Cada renglon de 02_Detalle debe tener un id_local que exista en 01_Suficiencias."],
  ["   i) La columna renglon en 02_Detalle debe empezar en 1 y ser unica por id_local."],
  ["   j) importe debe ser > 0. El sistema valida saldo disponible antes de aceptar el lote."],
  [""],
  ["3) FLUJO PARA SUBIR EL LOTE"],
  ["   Paso 1: Llenar 01_Suficiencias y 02_Detalle con tus datos."],
  ["   Paso 2: Exportar a JSON (proximamente via UI). Mientras tanto, conviene mandarlo armado a mano:"],
  ["           { \"suficiencias\": [ { ...cabecera + detalle: [ {renglon, clave, ...} ] } ] }"],
  ["   Paso 3: POST a /api/suficiencias/lote con Authorization: Bearer <JWT>."],
  [""],
  ["4) COLUMNAS DE 01_Suficiencias (cabecera)"],
  ["   id_local                 (string, requerido) — TU clave local para ligar al detalle (ej. S1)"],
  ["   id_dgeneral              (int, requerido)    — ID de cat_DG"],
  ["   id_dauxiliar             (int, requerido)    — ID de cat_DA"],
  ["   id_proyecto              (int, requerido)    — ID de cat_Proyecto"],
  ["   id_fuente                (int, requerido)    — ID de cat_Fuente"],
  ["   dependencia              (texto)             — etiqueta legible (max 350)"],
  ["   departamento             (texto)             — etiqueta legible (max 350)"],
  ["   fuente                   (texto)             — etiqueta legible (max 350)"],
  ["   mes_pago                 (string, requerido) — ver cat_Mes"],
  ["   fecha                    (date, opcional)    — YYYY-MM-DD (ADMIN/GOD)"],
  ["   clave_programatica       (texto)             — clave concatenada para reportes"],
  ["   meta                     (texto)             — descripcion/meta"],
  ["   impuesto_tipo            (string)            — ver cat_Impuesto (NONE si no aplica)"],
  ["   isr_tasa, ieps_tasa      (numeric, opcional) — porcentaje, ej 1.25 para 1.25%"],
  ["   subtotal, iva, isr, ieps (numeric)           — importes calculados"],
  ["   pension_total            (numeric)           — total de pensiones"],
  ["   pension1_tasa..pension5_tasa (numeric)       — tasa por pension"],
  ["   pension1..pension5       (numeric)           — importe por pension"],
  ["   cantidad_con_letra       (texto)             — total escrito en letra"],
  ["   firma_*                  (texto opcional)    — leyendas y nombres de firmantes"],
  [""],
  ["5) COLUMNAS DE 02_Detalle (renglones)"],
  ["   id_local                 (string, requerido) — debe existir en 01_Suficiencias"],
  ["   renglon                  (int, requerido)    — empieza en 1, unico por id_local"],
  ["   clave                    (string, requerido) — ver cat_Partida"],
  ["   concepto_partida         (texto)             — etiqueta de la partida (max 350)"],
  ["   justificacion            (texto)             — justificacion del gasto"],
  ["   descripcion              (texto)             — descripcion del renglon"],
  ["   importe                  (numeric, > 0)      — monto en MXN"],
  [""],
  ["NOTA: Esta plantilla se regenera con catalogos vivos. Si los catalogos cambian, vuelve a"],
  ["generarla con: docker compose exec app node /app/scripts/generar_plantilla_suficiencias.mjs"],
];

// =====================================================
//  ENCABEZADOS DE HOJAS DE CAPTURA (incluye un ejemplo en fila 2)
// =====================================================
const HEADERS_SUFICIENCIAS = [
  "id_local",
  "id_dgeneral", "id_dauxiliar", "id_proyecto", "id_fuente",
  "dependencia", "departamento", "fuente",
  "mes_pago", "fecha",
  "clave_programatica", "meta",
  "impuesto_tipo",
  "isr_tasa", "ieps_tasa",
  "subtotal", "iva", "isr", "ieps",
  "pension_total",
  "pension1_tasa", "pension1",
  "pension2_tasa", "pension2",
  "pension3_tasa", "pension3",
  "pension4_tasa", "pension4",
  "pension5_tasa", "pension5",
  "cantidad_con_letra",
  "firma_enlace_label", "firma_enlace_nombre",
  "firma_area_label",   "firma_area_nombre",
  "firma_direccion_nombre",
];

const EJEMPLO_SUFICIENCIA = [
  "S1",
  1, 1, 1, 1,
  "Direccion General Ejemplo", "Direccion Auxiliar Ejemplo", "Recursos propios",
  "ENERO", "",
  "EJ-2026-001", "Compra de papeleria para oficina",
  "NONE",
  "", "",
  1000.00, 160.00, 0, 0,
  0,
  "", 0,
  "", 0,
  "", 0,
  "", 0,
  "", 0,
  "(MIL CIENTO SESENTA PESOS 00/100 M.N.)",
  "ENLACE", "Nombre del enlace",
  "AREA",   "Nombre del area",
  "Nombre del director",
];

const HEADERS_DETALLE = [
  "id_local", "renglon", "clave", "concepto_partida",
  "justificacion", "descripcion", "importe",
];

const EJEMPLO_DETALLE = [
  ["S1", 1, "21101", "MATERIALES Y UTILES DE OFICINA",
   "Reposicion mensual del area", "Hojas, plumas, carpetas", 1000.00],
];

// =====================================================
//  AUXILIAR: convierte arreglo de objetos en AOA con encabezado
// =====================================================
function rowsToAOA(rows, headers) {
  const aoa = [headers];
  for (const r of rows) {
    aoa.push(headers.map((h) => (r[h] === null || r[h] === undefined ? "" : r[h])));
  }
  return aoa;
}

// =====================================================
//  MAIN
// =====================================================
async function generar() {
  console.log("[plantilla] Cargando catalogos desde BD...");

  const [rDG, rDA, rProy, rFte, rPart, rImp] = await Promise.all([
    query(`SELECT id, clave, dependencia AS nombre FROM public.dgeneral ORDER BY clave`),
    query(`SELECT id, clave, dependencia AS nombre FROM public.dauxiliar ORDER BY clave`),
    query(`SELECT id, clave, descripcion AS nombre, conac FROM public.proyectos ORDER BY clave`),
    query(`SELECT id, clave, fuente AS nombre FROM public.fuentes ORDER BY clave`),
    query(`SELECT clave, descripcion AS nombre FROM public.partidas ORDER BY clave`),
    query(`SELECT clave, descripcion AS nombre FROM public.cat_impuesto_tipo ORDER BY clave`),
  ]);

  console.log(`[plantilla] Catalogos: DG=${rDG.rowCount} DA=${rDA.rowCount} Proy=${rProy.rowCount} Fuente=${rFte.rowCount} Partida=${rPart.rowCount} Impuesto=${rImp.rowCount}`);

  const wb = XLSX.utils.book_new();

  // 00 Instrucciones
  const wsInstr = XLSX.utils.aoa_to_sheet(INSTRUCCIONES);
  wsInstr["!cols"] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, "00_Instrucciones");

  // 01 Suficiencias (cabecera + 1 fila ejemplo)
  const wsSuf = XLSX.utils.aoa_to_sheet([HEADERS_SUFICIENCIAS, EJEMPLO_SUFICIENCIA]);
  wsSuf["!cols"] = HEADERS_SUFICIENCIAS.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, wsSuf, "01_Suficiencias");

  // 02 Detalle (cabecera + 1 fila ejemplo)
  const wsDet = XLSX.utils.aoa_to_sheet([HEADERS_DETALLE, ...EJEMPLO_DETALLE]);
  wsDet["!cols"] = HEADERS_DETALLE.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, wsDet, "02_Detalle");

  // cat_DG
  const wsDG = XLSX.utils.aoa_to_sheet(rowsToAOA(rDG.rows, ["id", "clave", "nombre"]));
  wsDG["!cols"] = [{ wch: 6 }, { wch: 10 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsDG, "cat_DG");

  // cat_DA
  const wsDA = XLSX.utils.aoa_to_sheet(rowsToAOA(rDA.rows, ["id", "clave", "nombre"]));
  wsDA["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsDA, "cat_DA");

  // cat_Proyecto
  const wsProy = XLSX.utils.aoa_to_sheet(rowsToAOA(rProy.rows, ["id", "clave", "nombre", "conac"]));
  wsProy["!cols"] = [{ wch: 6 }, { wch: 14 }, { wch: 80 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsProy, "cat_Proyecto");

  // cat_Fuente
  const wsFte = XLSX.utils.aoa_to_sheet(rowsToAOA(rFte.rows, ["id", "clave", "nombre"]));
  wsFte["!cols"] = [{ wch: 6 }, { wch: 14 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsFte, "cat_Fuente");

  // cat_Partida
  const wsPart = XLSX.utils.aoa_to_sheet(rowsToAOA(rPart.rows, ["clave", "nombre"]));
  wsPart["!cols"] = [{ wch: 10 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsPart, "cat_Partida");

  // cat_Impuesto
  const wsImp = XLSX.utils.aoa_to_sheet(rowsToAOA(rImp.rows, ["clave", "nombre"]));
  wsImp["!cols"] = [{ wch: 12 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsImp, "cat_Impuesto");

  // cat_Mes
  const wsMes = XLSX.utils.aoa_to_sheet([["codigo"], ...MESES.map((m) => [m])]);
  wsMes["!cols"] = [{ wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsMes, "cat_Mes");

  await mkdir(OUT_DIR, { recursive: true });
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  await writeFile(OUT_FILE, buf);

  console.log(`[plantilla] OK -> ${OUT_FILE}`);
  console.log(`[plantilla] Descarga via: http://localhost:3000/plantillas/suficiencias_carga_masiva.xlsx`);
}

generar()
  .catch((err) => {
    console.error("[plantilla] ERROR:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await pool.end(); } catch {}
  });
