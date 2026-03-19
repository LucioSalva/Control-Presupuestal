/**
 * ================================================================
 *  CONTROL PRESUPUESTAL — Tests: Setup global
 * ================================================================
 *  Mocka el módulo db.js para evitar conexión real a la BD.
 *  Este archivo se carga vía setupFilesAfterFramework en jest.config.js
 * ================================================================
 */
import { jest } from "@jest/globals";

// Mock del módulo db.js — cualquier archivo que importe "../db.js"
// recibirá estas funciones falsas en lugar del Pool real de PostgreSQL.
jest.mock("../db.js", () => ({
  query: jest.fn(),
  getClient: jest.fn(() =>
    Promise.resolve({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    })
  ),
}));
