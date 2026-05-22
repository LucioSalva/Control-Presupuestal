/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Utilidades de Renderizado Seguro (anti-XSS)
 *  Archivo: safe-render.js
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
 *
 *  Proporciona utilidades mínimas para sanitizar valores de texto
 *  antes de inyectarlos vía innerHTML. Se carga ANTES que cualquier
 *  script de página para que `window.escapeHtml` esté disponible
 *  globalmente en todos los módulos clásicos del frontend.
 *
 *  IMPORTANTE: este archivo NO depende de ningún otro módulo.
 *  No introduzcas dependencias externas aquí.
 * ================================================================
 */
(function () {
  "use strict";

  // Si ya existe (por ejemplo, script.js definió uno propio), no lo pisamos:
  // ambas implementaciones son equivalentes y mantenemos compatibilidad.
  if (typeof window.escapeHtml === "function") return;

  /**
   * Escapa caracteres HTML peligrosos para evitar XSS al inyectar
   * texto en innerHTML. Convierte null/undefined a cadena vacía.
   *
   * @param {*} value - Valor a escapar (se castea a String).
   * @returns {string} Cadena segura para concatenar en HTML.
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Exponer en el global para scripts clásicos (no módulos).
  window.escapeHtml = escapeHtml;
})();
