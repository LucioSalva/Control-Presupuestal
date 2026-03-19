/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Configuración de Jest
 * ================================================================
 *  Usa node --experimental-vm-modules para soportar ES Modules.
 *  El proyecto usa "type":"module" en package.json.
 * ================================================================
 */

/** @type {import("jest").Config} */
export default {
  // Entorno de ejecución: Node.js (sin DOM)
  testEnvironment: "node",

  // Sin transform: Jest corre los archivos .js tal cual (ESM nativo)
  transform: {},

  // Indica a Jest que los .js son ESM
  extensionsToTreatAsEsm: [".js"],

  // Permite imports sin extensión en algunos casos
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },

  // Archivos de test: solo dentro de tests/
  testMatch: ["**/tests/**/*.test.js"],

  // Setup ejecutado después de que Jest carga el framework de test
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],

  // Mostrar cada test individualmente
  verbose: true,

  // Forzar salida al terminar (evita que procesos pendientes bloqueen Jest)
  forceExit: true,

  // Limpiar mocks automáticamente entre tests
  clearMocks: true,

  // Tiempo máximo por test: 15 segundos
  testTimeout: 15000,
};
