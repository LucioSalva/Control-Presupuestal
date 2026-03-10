import assert from "assert/strict";
import {
  canViewIepsPensionesByClaves,
  sanitizeFinancialFieldsForLimitedView,
} from "./financial-fields-perm.js";

function run() {
  assert.equal(canViewIepsPensionesByClaves("L00", "117"), true);
  assert.equal(canViewIepsPensionesByClaves("l00", "117"), true);
  assert.equal(canViewIepsPensionesByClaves("L00", "137"), false);
  assert.equal(canViewIepsPensionesByClaves("E00", "001"), true);
  assert.equal(canViewIepsPensionesByClaves("E00", ""), true);
  assert.equal(canViewIepsPensionesByClaves("", "117"), false);

  const payload = {
    subtotal: 100,
    iva: 16,
    isr: 10,
    ieps_tasa: 8,
    ieps: 8,
    pension_total: 5,
    pension1_tasa: 10,
    pension1: 10,
    total: 109,
  };
  const out = sanitizeFinancialFieldsForLimitedView(payload);
  assert.equal(out.subtotal, 100);
  assert.equal(out.iva, 16);
  assert.equal(out.isr, 10);
  assert.equal(out.total, 109);
  assert.equal(out.ieps_tasa, null);
  assert.equal(out.ieps, 0);
  assert.equal(out.pension_total, 0);
  assert.equal(out.pension1_tasa, null);
  assert.equal(out.pension1, 0);

  console.log("[financial-fields-perm.test] OK");
}

run();

