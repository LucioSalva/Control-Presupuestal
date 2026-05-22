/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: Setup global
 * ================================================================
 *  Configura el entorno mínimo necesario para que los tests
 *  puedan importar módulos que dependen de variables de entorno
 *  (server.js, db.js, env-schema.js, middleware/auth.js, etc.)
 *  sin invocar process.exit(1) ni abrir un Pool real.
 *
 *  NOTA: El mock de db.js se hace en CADA archivo de test con
 *  `jest.unstable_mockModule("../db.js", ...)` ANTES de los
 *  await import() — los mocks por módulo son más fiables con ESM
 *  que un mock global aquí.
 * ================================================================
 */

// Forzamos NODE_ENV=test ANTES de cualquier require/import.
// Las migraciones, app.listen y validateEnv() chequean esta variable.
process.env.NODE_ENV = "test";

// JWT_SECRET es leído por server.js, middleware/auth.js y auth.routes.js.
// En tests usamos un secreto fijo de longitud >=32 para que firmar/verificar
// JWT sea determinista entre archivos de test.
process.env.JWT_SECRET = "test_jwt_secret_de_32_caracteres_minimo_xx";

// DATABASE_URL: validateEnv() la exige siempre. En tests no se conecta
// realmente; los mocks de db.js interceptan las llamadas. Solo pasamos
// el formato esperado para que la validación no falle.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test_db";
}

// PORT: cualquier valor válido. No se hace listen en tests.
if (!process.env.PORT) {
  process.env.PORT = "3001";
}

// PGSSL: deshabilita SSL.
process.env.PGSSL = "false";

// Evita ruido en consola de migraciones que no se aplican en tests.
process.env.SEED = "false";

// Silencia console.error/warn ruidosos durante tests (errores intencionales
// de validación, audit, etc.). Los tests deben aserciar por status/body.
const originalError = console.error;
const originalWarn = console.warn;
console.error = (...args) => {
  // Permitir solo los logs explícitos de los tests, no los de los handlers.
  const msg = String(args[0] || "");
  if (msg.startsWith("[TEST]")) originalError(...args);
};
console.warn = (...args) => {
  const msg = String(args[0] || "");
  if (msg.startsWith("[TEST]")) originalWarn(...args);
};
