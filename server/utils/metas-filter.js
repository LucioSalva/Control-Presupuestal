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

