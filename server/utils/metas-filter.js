/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Filtro de Metas por Jerarquía
 *  Archivo: metas-filter.js
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
export function normalizeKey(v) {
  return String(v || "").trim().toUpperCase();
}

export function normalizeDigits(v) {
  return String(v || "").trim().replace(/[^\d]/g, "");
}

export function filterMetasByHierarchy(rows, filtros) {
  const all = Array.isArray(rows) ? rows : [];
  const dg = normalizeKey(filtros?.dg_clave);
  const da = String(filtros?.da_clave || "").trim();
  const proy = normalizeDigits(filtros?.proy_clave);
  const conac = normalizeKey(filtros?.conac);

  return all.filter((r) => {
    const rdg = normalizeKey(r?.dg_clave);
    const rda = String(r?.da_clave || "").trim();
    const rproy = normalizeDigits(r?.proy_clave);
    const rconac = normalizeKey(r?.conac);
    if (dg && rdg !== dg) return false;
    if (da && rda !== da) return false;
    if (proy && rproy !== proy) return false;
    if (conac && rconac !== conac) return false;
    return true;
  });
}

