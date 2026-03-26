-- ================================================================
--  CONTROL PRESUPUESTAL MUNICIPAL
--  Migración: Sequences para generación atómica de folios
--  Archivo: 2026_03_19_folio_sequences.sql
--
--  Reemplaza la generación manual de folios (SELECT MAX / FOR UPDATE
--  en JS) por SEQUENCES de PostgreSQL, eliminando race conditions
--  en concurrencia alta.
--
--  Idempotente: usa CREATE SEQUENCE IF NOT EXISTS y
--  CREATE OR REPLACE FUNCTION.
-- ================================================================

-- ------------------------------------------------------------
-- 1. Sequences
-- ------------------------------------------------------------

-- Suficiencias: ECA-YYYY-MM-SP-NNNN
CREATE SEQUENCE IF NOT EXISTS seq_suficiencia_folio
  START 1 INCREMENT 1 MINVALUE 1 NO MAXVALUE CACHE 1;

-- Comprometidos: ECA-YYYY-MM-CP-NNNN
CREATE SEQUENCE IF NOT EXISTS seq_comprometido_folio
  START 1 INCREMENT 1 MINVALUE 1 NO MAXVALUE CACHE 1;

-- Devengados: ECA-YYYY-MM-DV-NNNN
CREATE SEQUENCE IF NOT EXISTS seq_devengado_folio
  START 1 INCREMENT 1 MINVALUE 1 NO MAXVALUE CACHE 1;

-- Reconducciones: ECA-YYYY-MM-RC-NNNN
CREATE SEQUENCE IF NOT EXISTS seq_reconduccion_folio
  START 1 INCREMENT 1 MINVALUE 1 NO MAXVALUE CACHE 1;

-- ------------------------------------------------------------
-- 2. Funciones helper (retornan el siguiente entero de forma atómica)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_next_folio_suficiencia()
RETURNS integer AS $$
  SELECT nextval('seq_suficiencia_folio')::integer;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION fn_next_folio_comprometido()
RETURNS integer AS $$
  SELECT nextval('seq_comprometido_folio')::integer;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION fn_next_folio_devengado()
RETURNS integer AS $$
  SELECT nextval('seq_devengado_folio')::integer;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION fn_next_folio_reconduccion()
RETURNS integer AS $$
  SELECT nextval('seq_reconduccion_folio')::integer;
$$ LANGUAGE sql;

-- ------------------------------------------------------------
-- 3. Inicializar sequences con el máximo actual de cada tabla
--    (idempotente: setval solo se llama si hay datos)
-- ------------------------------------------------------------
DO $$
DECLARE
  max_suf  integer;
  max_comp integer;
  max_dev  integer;
BEGIN
  -- Suficiencias: extrae el mayor número al final del folio (últimos dígitos)
  SELECT COALESCE(
    MAX((regexp_match(no_suficiencia, '(\d+)$'))[1]::integer), 0
  )
  INTO max_suf
  FROM suficiencias;

  IF max_suf > 0 THEN
    PERFORM setval('seq_suficiencia_folio', max_suf);
  END IF;

  -- Comprometidos
  SELECT COALESCE(
    MAX((regexp_match(no_comprometido, '(\d+)$'))[1]::integer), 0
  )
  INTO max_comp
  FROM comprometidos;

  IF max_comp > 0 THEN
    PERFORM setval('seq_comprometido_folio', max_comp);
  END IF;

  -- Devengados
  SELECT COALESCE(
    MAX((regexp_match(no_devengado, '(\d+)$'))[1]::integer), 0
  )
  INTO max_dev
  FROM devengados;

  IF max_dev > 0 THEN
    PERFORM setval('seq_devengado_folio', max_dev);
  END IF;
END $$;
