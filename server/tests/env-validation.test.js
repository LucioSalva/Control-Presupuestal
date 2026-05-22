/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: H-6 (validateEnv)
 * ================================================================
 *  Verifica que validateEnv() falla rápido en producción cuando
 *  faltan o son inválidas variables críticas, y pasa OK con set
 *  válido.
 *
 *  IMPORTANTE: validateEnv() llama process.exit(1) en caso de
 *  error. Lo capturamos con un spy que lanza una excepción.
 * ================================================================
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

const { validateEnv } = await import("../utils/env-schema.js");

describe("H-6: validateEnv fail-fast por variable", () => {
  let originalEnv;
  let exitSpy;
  let exitError;

  beforeEach(() => {
    originalEnv = { ...process.env };
    exitError = new Error("__PROCESS_EXIT__");
    exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
      exitError.code = code;
      throw exitError;
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    exitSpy.mockRestore();
  });

  it("sin DATABASE_URL → process.exit(1)", () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "test";
    expect(() => validateEnv()).toThrow("__PROCESS_EXIT__");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("DATABASE_URL con formato inválido → process.exit(1)", () => {
    process.env.DATABASE_URL = "no-es-una-url-de-postgres";
    process.env.NODE_ENV = "test";
    expect(() => validateEnv()).toThrow("__PROCESS_EXIT__");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("en production sin JWT_SECRET → process.exit(1)", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://u:p@h:5432/d";
    delete process.env.JWT_SECRET;
    process.env.ALLOWED_ORIGINS = "https://app.example";
    expect(() => validateEnv()).toThrow("__PROCESS_EXIT__");
  });

  it("en production con JWT_SECRET corto (<32) → process.exit(1)", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://u:p@h:5432/d";
    process.env.JWT_SECRET = "corto";
    process.env.ALLOWED_ORIGINS = "https://app.example";
    expect(() => validateEnv()).toThrow("__PROCESS_EXIT__");
  });

  it("en production sin ALLOWED_ORIGINS → process.exit(1)", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://u:p@h:5432/d";
    process.env.JWT_SECRET = "a".repeat(40);
    delete process.env.ALLOWED_ORIGINS;
    expect(() => validateEnv()).toThrow("__PROCESS_EXIT__");
  });

  it("en development sin JWT_SECRET → NO hace exit (solo warning)", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://u:p@h:5432/d";
    delete process.env.JWT_SECRET;
    expect(() => validateEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("validateEnv OK con todas las variables → no exit", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://u:p@h:5432/d";
    process.env.JWT_SECRET = "a".repeat(40);
    process.env.ALLOWED_ORIGINS = "https://app.example,https://otro.example";
    process.env.PORT = "3000";
    process.env.PGSSL = "false";

    expect(() => validateEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("ALLOWED_ORIGINS en production con URL malformada → process.exit(1)", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://u:p@h:5432/d";
    process.env.JWT_SECRET = "a".repeat(40);
    process.env.ALLOWED_ORIGINS = "no-es-url, otra-mala";
    expect(() => validateEnv()).toThrow("__PROCESS_EXIT__");
  });

  it("PORT no numérico → process.exit(1)", () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgres://u:p@h:5432/d";
    process.env.PORT = "abc";
    expect(() => validateEnv()).toThrow("__PROCESS_EXIT__");
  });

  it("PGSSL con valor extraño → process.exit(1)", () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgres://u:p@h:5432/d";
    process.env.PGSSL = "maybe";
    expect(() => validateEnv()).toThrow("__PROCESS_EXIT__");
  });
});
