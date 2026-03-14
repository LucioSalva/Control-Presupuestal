/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Configuración del Ofuscador de Producción
 *  Archivo: obfuscator.config.js
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
 *  CONFIGURACIÓN DEL OFUSCADOR — javascript-obfuscator
 * ================================================================
 *
 *  Uso en producción:
 *    npm run build
 *
 *  Resultado:
 *    Los archivos JS de public/js/ se ofuscan y se guardan
 *    en public/dist/js/ listos para despliegue.
 *
 *  En desarrollo:
 *    El servidor sirve directamente de public/js/ (código legible).
 *    NODE_ENV=development (default)
 *
 *  En producción:
 *    Ejecutar: npm run build
 *    Luego iniciar con: NODE_ENV=production npm start
 *    El servidor sirve de public/dist/js/ (código ofuscado).
 *
 * ================================================================
 *  NIVELES DE PROTECCIÓN APLICADOS:
 *
 *  [✓] Renombrado de identificadores  → nombres hexadecimales (_0x1a2b)
 *  [✓] Cifrado de strings en base64   → strings ilegibles en el binario
 *  [✓] Transformación de números      → expresiones matemáticas
 *  [✓] Control de flujo plano         → bifurcaciones confusas
 *  [✓] Rotación y barajeado de arrays → orden de strings aleatorio
 *  [✗] Inyección de código muerto     → desactivado (aumenta tamaño)
 *  [✗] Protección de consola          → desactivado (afecta depuración prod)
 *  [✗] Auto-defensa                   → desactivado (puede romper iframes)
 * ================================================================
 */

export const obfuscatorOptions = {
  // ─── IDENTIFICADORES ─────────────────────────────────────────
  // Genera nombres como _0x1a2b3c para variables y funciones
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,           // No renombrar globals (rompe interop con libs CDN)

  // ─── STRINGS ─────────────────────────────────────────────────
  // Extrae todos los strings a un array encriptado en base64
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.8,      // 80% de strings serán ofuscados
  stringArrayCallsTransform: true,
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: "function",
  splitStrings: true,
  splitStringsChunkLength: 12,

  // ─── NÚMEROS ─────────────────────────────────────────────────
  // Convierte: 100 → (0x32 * 0x2) para dificultar lectura
  numbersToExpressions: true,

  // ─── FLUJO DE CONTROL ────────────────────────────────────────
  // Aplana el flujo de control con switch/while falso
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.4,   // 40% del código afectado (balance tamaño/seguridad)

  // ─── OPTIMIZACIÓN ────────────────────────────────────────────
  compact: true,                  // Una sola línea de salida
  simplify: true,                 // Simplifica expresiones booleanas

  // ─── FEATURES DESACTIVADAS ───────────────────────────────────
  deadCodeInjection: false,       // Aumenta tamaño hasta 200%
  debugProtection: false,         // Puede colgar DevTools legítimos
  selfDefending: false,           // Incompatible con algunos entornos
  disableConsoleOutput: false,    // Mantener logs en producción
  log: false,
};
