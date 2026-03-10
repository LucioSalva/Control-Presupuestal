export function normKey(v) {
  return String(v || "").trim().toUpperCase();
}

export function normDa(v) {
  return String(v || "").trim().toUpperCase();
}

export function canViewIepsPensionesByClaves(dgClave, daClave) {
  const dg = normKey(dgClave);
  const da = normDa(daClave);
  if (!dg) return false;
  if (dg === "E00") return true;
  return dg === "L00" && da === "117";
}

export function sanitizeFinancialFieldsForLimitedView(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const out = { ...p };
  if ("ieps_tasa" in out) out.ieps_tasa = null;
  if ("ieps" in out) out.ieps = 0;
  if ("pension_total" in out) out.pension_total = 0;
  if ("pension1_tasa" in out) out.pension1_tasa = null;
  if ("pension2_tasa" in out) out.pension2_tasa = null;
  if ("pension3_tasa" in out) out.pension3_tasa = null;
  if ("pension4_tasa" in out) out.pension4_tasa = null;
  if ("pension5_tasa" in out) out.pension5_tasa = null;
  if ("pension1" in out) out.pension1 = 0;
  if ("pension2" in out) out.pension2 = 0;
  if ("pension3" in out) out.pension3 = 0;
  if ("pension4" in out) out.pension4 = 0;
  if ("pension5" in out) out.pension5 = 0;
  return out;
}

