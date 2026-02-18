import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { getClient, query } from "../db.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const EXPECTED_HEADERS = [
  "DEP_GRAL",
  "DEP_AUX",
  "PROY",
  "FF",
  "PARTIDA",
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
  "EJERCICIO",
];

const MONTH_COLUMNS = [
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

const HEADER_ALIASES = {
  DEP_GRAL: ["DEPGRAL"],
  DEP_AUX: ["DEPAUX"],
  PROY: ["PROY", "PROYECTO", "IDPROYECTO", "PROY10DIGITOS"],
  FF: ["FF"],
  PARTIDA: ["PARTIDA"],
  ENERO: ["ENERO"],
  FEBRERO: ["FEBRERO"],
  MARZO: ["MARZO"],
  ABRIL: ["ABRIL"],
  MAYO: ["MAYO"],
  JUNIO: ["JUNIO"],
  JULIO: ["JULIO"],
  AGOSTO: ["AGOSTO"],
  SEPTIEMBRE: ["SEPTIEMBRE"],
  OCTUBRE: ["OCTUBRE"],
  NOVIEMBRE: ["NOVIEMBRE"],
  DICIEMBRE: ["DICIEMBRE"],
  EJERCICIO: ["EJERCICIO", "EJERCICIOFISCAL", "ANO", "ANIO"],
};

function normalizeText(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeCatalogKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\.0+$/, "").toUpperCase();
}

function normalizeProjectKey(value) {
  let key = normalizeCatalogKey(value);
  if (!key) return "";
  if (/^\d+$/.test(key)) {
    key = key.padStart(10, "0");
  }
  return key;
}

function parseMonthValue(value) {
  if (value == null || String(value).trim() === "") return 0;

  const normalized = String(value)
    .trim()
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/^\((.*)\)$/, "-$1");

  const numberValue = Number(normalized);
  if (!Number.isFinite(numberValue)) return NaN;
  return Number(numberValue.toFixed(2));
}

function parseIntOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function isRowEmpty(row) {
  if (!Array.isArray(row)) return true;
  return row.every((v) => String(v ?? "").trim() === "");
}

function buildCatalog(rows) {
  const byKey = new Map();
  const byNumeric = new Map();

  for (const row of rows) {
    const key = normalizeCatalogKey(row.clave);
    if (!key) continue;

    byKey.set(key, row.id);

    if (/^\d+$/.test(key)) {
      const numeric = Number(key);
      if (!byNumeric.has(numeric)) {
        byNumeric.set(numeric, row.id);
      }
    }
  }

  return { byKey, byNumeric };
}

function resolveCatalogId(catalog, rawValue, normalizer = normalizeCatalogKey) {
  const key = normalizer(rawValue);
  if (!key) return null;

  if (catalog.byKey.has(key)) {
    return catalog.byKey.get(key);
  }

  if (/^\d+$/.test(key)) {
    const num = Number(key);
    if (catalog.byNumeric.has(num)) {
      return catalog.byNumeric.get(num);
    }
  }

  return null;
}

function buildRowError(row, message, context = {}) {
  return {
    row,
    message,
    dep_gral: String(context.dep_gral || ""),
    dep_aux: String(context.dep_aux || ""),
    ff: String(context.ff || ""),
    partida: String(context.partida || ""),
    proy: String(context.proy || ""),
  };
}

async function loadCatalogMaps(client) {
  const [dgeneralRows, dauxiliarRows, fuenteRows, partidaRows, proyectoRows] =
    await Promise.all([
      client.query(`SELECT id, TRIM(clave) AS clave FROM public.dgeneral`),
      client.query(`SELECT id, TRIM(clave) AS clave FROM public.dauxiliar`),
      client.query(`SELECT id, TRIM(clave) AS clave FROM public.fuentes`),
      client.query(`SELECT id, TRIM(clave) AS clave FROM public.partidas`),
      client.query(`SELECT id, TRIM(clave) AS clave FROM public.proyectos`),
    ]);

  return {
    dgeneral: buildCatalog(dgeneralRows.rows),
    dauxiliar: buildCatalog(dauxiliarRows.rows),
    fuentes: buildCatalog(fuenteRows.rows),
    partidas: buildCatalog(partidaRows.rows),
    proyectos: buildCatalog(proyectoRows.rows),
  };
}

router.get("/", async (req, res) => {
  try {
    const where = [];
    const params = [];
    let idx = 1;

    const addNumericFilter = (queryKey, column) => {
      const raw = req.query[queryKey];
      if (raw == null || String(raw).trim() === "") return;

      const value = Number.parseInt(String(raw), 10);
      if (!Number.isFinite(value)) {
        throw new Error(`Filtro invalido: ${queryKey}`);
      }

      where.push(`${column} = $${idx++}`);
      params.push(value);
    };

    const addTextFilter = (queryKey, column) => {
      const raw = req.query[queryKey];
      if (raw == null || String(raw).trim() === "") return;

      const value = String(raw).trim();
      where.push(`${column} ILIKE $${idx++}`);
      params.push(`%${value}%`);
    };

    addNumericFilter("ejercicio", "pbp.ejercicio");
    addNumericFilter("id_dgeneral", "pbp.id_dgeneral");
    addNumericFilter("id_dauxiliar", "pbp.id_dauxiliar");
    addNumericFilter("id_fuente", "pbp.id_fuente");
    addTextFilter("partida", "pa.clave");

    const sql = `
      SELECT
        pbp.id,
        pbp.id_dgeneral,
        pbp.id_dauxiliar,
        pbp.id_fuente,
        pbp.id_partida,
        pbp.id_proyecto,
        pbp.ejercicio,
        pbp.ene,
        pbp.feb,
        pbp.mar,
        pbp.abr,
        pbp.may,
        pbp.jun,
        pbp.jul,
        pbp.ago,
        pbp.sep,
        pbp.oct,
        pbp.nov,
        pbp.dic,
        pbp.total,
        pbp.fecha_registro,

        dg.clave AS dep_gral_clave,
        da.clave AS dep_aux_clave,
        ff.clave AS fuente_clave,
        ff.fuente AS fuente_descripcion,

        pa.clave AS partida_clave,
        pa.descripcion AS partida_descripcion,

        pr.clave AS proyecto_clave,
        pr.conac AS proyecto_conac,
        pr.descripcion AS proyecto_descripcion
      FROM public.presupuesto_base_partidas pbp
      JOIN public.dgeneral dg ON dg.id = pbp.id_dgeneral
      JOIN public.dauxiliar da ON da.id = pbp.id_dauxiliar
      JOIN public.fuentes ff ON ff.id = pbp.id_fuente
      JOIN public.partidas pa ON pa.id = pbp.id_partida
      LEFT JOIN public.proyectos pr ON pr.id = pbp.id_proyecto
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY pbp.ejercicio DESC, dg.clave, da.clave, ff.clave, pa.clave;
    `;

    const result = await query(sql, params);
    return res.json({ rows: result.rows });
  } catch (error) {
    if (String(error.message || "").startsWith("Filtro invalido:")) {
      return res.status(400).json({ error: error.message });
    }

    console.error("[PRESUPUESTO_BASE_PARTIDAS][GET]", error);
    return res.status(500).json({ error: "Error al obtener presupuesto base" });
  }
});

router.post("/upload-excel", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Debes adjuntar un archivo en el campo file" });
  }

  if (!/\.xlsx$/i.test(String(req.file.originalname || ""))) {
    return res.status(400).json({ error: "El archivo debe tener extension .xlsx" });
  }

  let rows = [];
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames?.[0];

    if (!sheetName) {
      return res.status(400).json({ error: "El Excel no contiene hojas" });
    }

    const sheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });
  } catch (error) {
    console.error("[PRESUPUESTO_BASE_PARTIDAS][PARSE]", error);
    return res.status(400).json({ error: "No fue posible leer el archivo Excel" });
  }

  if (!Array.isArray(rows) || rows.length < 2) {
    return res.status(400).json({ error: "El archivo no contiene filas para procesar" });
  }

  const headers = Array.isArray(rows[0]) ? rows[0] : [];
  const normalizedHeaders = headers.map(normalizeHeader);

  const headerIndex = {};
  const missingHeaders = [];

  for (const header of EXPECTED_HEADERS) {
    const aliases = HEADER_ALIASES[header] || [header];
    const idx = normalizedHeaders.findIndex((h) =>
      aliases.some((a) => h === a || h.startsWith(a)),
    );
    if (idx < 0) {
      missingHeaders.push(header);
    } else {
      headerIndex[header] = idx;
    }
  }

  if (missingHeaders.length) {
    return res.status(400).json({
      error: `Encabezados faltantes: ${missingHeaders.join(", ")}`,
    });
  }

  const client = await getClient();
  const errors = [];
  let inserted = 0;
  let updated = 0;

  const upsertSql = `
    INSERT INTO public.presupuesto_base_partidas (
      id_dgeneral,
      id_dauxiliar,
      id_fuente,
      id_partida,
      id_proyecto,
      ejercicio,
      ene,
      feb,
      mar,
      abr,
      may,
      jun,
      jul,
      ago,
      sep,
      oct,
      nov,
      dic
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,
      $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
    )
    ON CONFLICT (ejercicio, id_dgeneral, id_dauxiliar, id_fuente, id_partida)
    DO UPDATE SET
      ene = EXCLUDED.ene,
      feb = EXCLUDED.feb,
      mar = EXCLUDED.mar,
      abr = EXCLUDED.abr,
      may = EXCLUDED.may,
      jun = EXCLUDED.jun,
      jul = EXCLUDED.jul,
      ago = EXCLUDED.ago,
      sep = EXCLUDED.sep,
      oct = EXCLUDED.oct,
      nov = EXCLUDED.nov,
      dic = EXCLUDED.dic,
      id_proyecto = EXCLUDED.id_proyecto
    RETURNING (xmax = 0) AS inserted;
  `;

  try {
    await client.query("BEGIN");

    const catalogs = await loadCatalogMaps(client);

    for (let i = 1; i < rows.length; i += 1) {
      const row = Array.isArray(rows[i]) ? rows[i] : [];
      if (isRowEmpty(row)) continue;

      const excelRowNumber = i + 1;

      const depGralRaw = row[headerIndex.DEP_GRAL];
      const depAuxRaw = row[headerIndex.DEP_AUX];
      const ffRaw = row[headerIndex.FF];
      const partidaRaw = row[headerIndex.PARTIDA];
      const proyRaw = row[headerIndex.PROY];

      const context = {
        dep_gral: String(depGralRaw ?? "").trim(),
        dep_aux: String(depAuxRaw ?? "").trim(),
        ff: String(ffRaw ?? "").trim(),
        partida: String(partidaRaw ?? "").trim(),
        proy: String(proyRaw ?? "").trim(),
      };

      const idDgeneral = resolveCatalogId(catalogs.dgeneral, depGralRaw);
      if (!idDgeneral) {
        errors.push(buildRowError(excelRowNumber, "DEP_GRAL no existe en catalogo dgeneral", context));
        continue;
      }

      const idDauxiliar = resolveCatalogId(catalogs.dauxiliar, depAuxRaw);
      if (!idDauxiliar) {
        errors.push(buildRowError(excelRowNumber, "DEP_AUX no existe en catalogo dauxiliar", context));
        continue;
      }

      const idFuente = resolveCatalogId(catalogs.fuentes, ffRaw);
      if (!idFuente) {
        errors.push(buildRowError(excelRowNumber, "FF no existe en catalogo fuentes", context));
        continue;
      }

      const idPartida = resolveCatalogId(catalogs.partidas, partidaRaw);
      if (!idPartida) {
        errors.push(buildRowError(excelRowNumber, "PARTIDA no existe en catalogo partidas", context));
        continue;
      }

      const proyKey = normalizeProjectKey(proyRaw);
      let idProyecto = null;
      if (proyKey) {
        idProyecto = resolveCatalogId(catalogs.proyectos, proyKey, normalizeProjectKey);
        if (!idProyecto) {
          errors.push(buildRowError(excelRowNumber, "PROY no existe en catalogo proyectos", context));
          continue;
        }
      }

      const monthValues = [];
      let hasInvalidMonth = false;

      for (const monthName of MONTH_COLUMNS) {
        const value = parseMonthValue(row[headerIndex[monthName]]);
        if (!Number.isFinite(value)) {
          hasInvalidMonth = true;
          errors.push(
            buildRowError(
              excelRowNumber,
              `Valor invalido en ${monthName}. Debe ser numerico`,
              context,
            ),
          );
          break;
        }
        monthValues.push(value);
      }

      if (hasInvalidMonth) continue;

      const ejercicio = parseIntOrNull(row[headerIndex.EJERCICIO]);
      if (!ejercicio || ejercicio < 2000) {
        errors.push(buildRowError(excelRowNumber, "EJERCICIO invalido", context));
        continue;
      }

      const params = [
        idDgeneral,
        idDauxiliar,
        idFuente,
        idPartida,
        idProyecto,
        ejercicio,
        ...monthValues,
      ];

      try {
        const upsertResult = await client.query(upsertSql, params);
        if (upsertResult.rows?.[0]?.inserted) inserted += 1;
        else updated += 1;
      } catch (dbError) {
        errors.push(
          buildRowError(
            excelRowNumber,
            `Error de base de datos: ${dbError.message}`,
            context,
          ),
        );
      }
    }

    await client.query("COMMIT");
    return res.json({ inserted, updated, errors });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[PRESUPUESTO_BASE_PARTIDAS][UPLOAD]", error);
    return res.status(500).json({ error: "Error al procesar la carga masiva" });
  } finally {
    client.release();
  }
});

router.get("/template", async (_req, res) => {
  try {
    const headers = [...EXPECTED_HEADERS];
    const blankRow = [
      "",
      "",
      "",
      "",
      "",
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      new Date().getFullYear(),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([headers, blankRow]);
    worksheet["!cols"] = headers.map((h) => ({
      wch: h === "PARTIDA" || h === "PROY" ? 16 : 12,
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Plantilla");

    const buffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "buffer",
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=plantilla_presupuesto_base_partidas.xlsx",
    );

    return res.send(buffer);
  } catch (error) {
    console.error("[PRESUPUESTO_BASE_PARTIDAS][TEMPLATE]", error);
    return res.status(500).json({ error: "No fue posible generar la plantilla" });
  }
});

export default router;
