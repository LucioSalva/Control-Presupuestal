/**
 * ================================================================
 *  CONTROL PRESUPUESTAL MUNICIPAL
 *  Humberto Salvador Ruiz Lucio
 * ================================================================
 *  Módulo: Restricciones por Fuente
 *  Archivo: candados.fuentes.js
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
window.DG_DA_FUENTES_FILTERS = window.DG_DA_FUENTES_FILTERS || {};
window.DG_DA_PROYECTO_FUENTES_FILTERS =
  window.DG_DA_PROYECTO_FUENTES_FILTERS || {};
window.DG_DA_PROYECTO_FUENTE_PARTIDAS_FILTERS =
  window.DG_DA_PROYECTO_FUENTE_PARTIDAS_FILTERS || {};

window.getFuentesPermitidas = async function ({ dg, da, proyecto }) {
  const dgKey = String(dg || "").trim().toUpperCase();
  const daKey = String(da || "").trim();
  const proyKey = String(proyecto || "").replace(/[^\d]/g, "").trim();
  if (!dgKey || !daKey || !proyKey) return null;

  const cacheKey = `${dgKey}|${daKey}|${proyKey}`;
  const cached = window.DG_DA_PROYECTO_FUENTES_FILTERS[cacheKey];
  if (cached) return new Set(cached.map(String));

  const token =
    localStorage.getItem("cp_token") ||
    sessionStorage.getItem("cp_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    "";

  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");
  const url = `${API}/api/catalogos/fuentes-permitidas?dg_clave=${encodeURIComponent(
    dgKey,
  )}&da_clave=${encodeURIComponent(daKey)}&proy_clave=${encodeURIComponent(
    proyKey,
  )}`;

  try {
    const r = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const fuentes = Array.isArray(data?.fuentes) ? data.fuentes : [];
    const list = fuentes.map((f) => String(f || "").trim());
    window.DG_DA_PROYECTO_FUENTES_FILTERS[cacheKey] = list;
    return new Set(list);
  } catch {
    return null;
  }
};

window.getPartidasPermitidas = async function ({ dg, da, proyecto, fuente }) {
  const dgKey = String(dg || "").trim().toUpperCase();
  const daKey = String(da || "").trim();
  const proyKey = String(proyecto || "").replace(/[^\d]/g, "").trim();
  const fuenteKey = String(fuente || "").replace(/[^\d]/g, "").trim();
  if (!dgKey || !daKey || !proyKey || !fuenteKey) return null;

  const cacheKey = `${dgKey}|${daKey}|${proyKey}|${fuenteKey}`;
  const cached = window.DG_DA_PROYECTO_FUENTE_PARTIDAS_FILTERS[cacheKey];
  if (cached) return new Set(cached.map(String));

  const token =
    localStorage.getItem("cp_token") ||
    sessionStorage.getItem("cp_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    "";

  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");
  const url = `${API}/api/catalogos/partidas-permitidas-detalle?dg_clave=${encodeURIComponent(
    dgKey,
  )}&da_clave=${encodeURIComponent(daKey)}&proy_clave=${encodeURIComponent(
    proyKey,
  )}&fuente_clave=${encodeURIComponent(fuenteKey)}`;

  try {
    const r = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const partidas = Array.isArray(data?.partidas) ? data.partidas : [];
    const list = partidas.map((p) => String(p || "").trim());
    window.DG_DA_PROYECTO_FUENTE_PARTIDAS_FILTERS[cacheKey] = list;
    return new Set(list);
  } catch {
    return null;
  }
};
