/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Validación de Variables de Entorno (fail-fast)
 *  Archivo: utils/env-schema.js
 *
 *  © 2025–2026 Humberto Salvador Ruiz Lucio.
 *  Todos los derechos reservados.
 *
 *  Verifica que las variables de entorno necesarias estén
 *  presentes y bien formadas ANTES de instanciar el pool de
 *  Postgres y antes de hacer app.listen.
 *  Si la validación falla, hace process.exit(1) con un log
 *  claro que indica el campo y el motivo.
 * ================================================================
 */

// =====================================================
//  HELPERS DE VALIDACIÓN
// =====================================================

/**
 * Determina si el entorno actual es "permisivo" (development o test).
 * En ambos casos se aceptan defaults razonables para algunas variables.
 */
function isDevOrTest() {
  const env = String(process.env.NODE_ENV || "").trim().toLowerCase();
  return env === "development" || env === "test" || env === "";
}

/**
 * Determina si el entorno es producción explícita.
 */
function isProduction() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
}

/**
 * Acumula errores y los reporta todos juntos al final, para que el
 * operador pueda corregir múltiples problemas de una vez.
 */
function makeErrorBucket() {
  const errors = [];
  return {
    add(field, motivo) {
      errors.push({ field, motivo });
    },
    hasErrors() {
      return errors.length > 0;
    },
    report() {
      console.error("[ENV] Validación de variables de entorno fallida:");
      for (const e of errors) {
        console.error(`  - ${e.field}: ${e.motivo}`);
      }
      console.error("[ENV] El servidor no puede iniciar. Corrige el archivo .env y reintenta.");
    },
  };
}

// =====================================================
//  VALIDACIÓN PRINCIPAL
// =====================================================

/**
 * validateEnv: lee process.env y verifica los campos obligatorios.
 * Si encuentra problemas en producción/staging, hace process.exit(1).
 * En development/test es más permisivo (solo advierte).
 */
export function validateEnv() {
  const bucket = makeErrorBucket();
  const warnings = [];

  // ── DATABASE_URL: obligatorio siempre ─────────────────────────
  const dbUrl = String(process.env.DATABASE_URL || "").trim();
  if (!dbUrl) {
    bucket.add("DATABASE_URL", "no está definida");
  } else if (!/^postgres(ql)?:\/\//i.test(dbUrl)) {
    bucket.add("DATABASE_URL", "formato inválido (se esperaba postgres://… o postgresql://…)");
  }

  // ── JWT_SECRET: obligatorio fuera de dev/test, longitud >= 32 ─
  const jwtSecret = String(process.env.JWT_SECRET || "");
  if (!jwtSecret) {
    if (isDevOrTest()) {
      warnings.push("JWT_SECRET no definido en development/test (se usará secreto local NO APTO para producción).");
    } else {
      bucket.add("JWT_SECRET", "obligatorio en producción/staging");
    }
  } else if (jwtSecret.length < 32) {
    if (isDevOrTest()) {
      warnings.push("JWT_SECRET tiene longitud < 32 caracteres (aceptado solo en development/test).");
    } else {
      bucket.add("JWT_SECRET", "longitud insuficiente (mínimo 32 caracteres)");
    }
  }

  // ── ALLOWED_ORIGINS: obligatorio en producción ────────────────
  const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "").trim();
  if (isProduction()) {
    if (!allowedOrigins) {
      bucket.add("ALLOWED_ORIGINS", "obligatorio en producción (lista comma-separated)");
    } else {
      const list = allowedOrigins.split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length === 0) {
        bucket.add("ALLOWED_ORIGINS", "obligatorio en producción (lista no vacía)");
      } else {
        // Verificar formato de cada origen
        for (const o of list) {
          try {
            new URL(o);
          } catch {
            bucket.add("ALLOWED_ORIGINS", `origen mal formado: "${o}"`);
          }
        }
      }
    }
  }

  // ── PORT: numérico opcional (default 3000) ────────────────────
  const portRaw = String(process.env.PORT || "").trim();
  if (portRaw) {
    const portNum = Number(portRaw);
    if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
      bucket.add("PORT", `valor inválido "${portRaw}" (debe ser entero entre 1 y 65535)`);
    }
  }

  // ── PGSSL: bool string ────────────────────────────────────────
  const pgsslRaw = String(process.env.PGSSL || "").trim().toLowerCase();
  if (pgsslRaw && !["true", "false", "1", "0", "yes", "no"].includes(pgsslRaw)) {
    bucket.add("PGSSL", `valor inválido "${pgsslRaw}" (debe ser true/false)`);
  }

  // ── NODE_ENV: si está definido, debe ser uno conocido ─────────
  const nodeEnvRaw = String(process.env.NODE_ENV || "").trim().toLowerCase();
  if (nodeEnvRaw && !["development", "test", "staging", "production"].includes(nodeEnvRaw)) {
    warnings.push(`NODE_ENV="${nodeEnvRaw}" no es un valor estándar (development|test|staging|production).`);
  }

  // ── REPORTE ───────────────────────────────────────────────────
  for (const w of warnings) {
    console.warn(`[ENV][WARN] ${w}`);
  }

  if (bucket.hasErrors()) {
    bucket.report();
    process.exit(1);
  }

  console.log(`[ENV] Validación exitosa (NODE_ENV=${nodeEnvRaw || "<vacío>"}).`);
}
