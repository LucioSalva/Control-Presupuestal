/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Configuración Global
 *  Archivo: config.js
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
(() => {
  if (window.API_URL) return;

  const host = String(window.location.hostname || "").trim().toLowerCase();
  const port = String(window.location.port || "").trim();
  const isLocal = host === "localhost" || host === "127.0.0.1";
  const isFrontendDevPort = isLocal && port && port !== "3000";

  window.API_URL = isFrontendDevPort ? "http://localhost:3000" : window.location.origin;
})();
