-- =====================================================
--  Migración: columnas de firma en suficiencias,
--  comprometidos y devengados
--  Fecha: 2026-03-11
--  Idempotente: usa ADD COLUMN IF NOT EXISTS
-- =====================================================

ALTER TABLE public.suficiencias
  ADD COLUMN IF NOT EXISTS firma_enlace_label    text,
  ADD COLUMN IF NOT EXISTS firma_enlace_nombre   text,
  ADD COLUMN IF NOT EXISTS firma_area_label      text,
  ADD COLUMN IF NOT EXISTS firma_area_nombre     text,
  ADD COLUMN IF NOT EXISTS firma_direccion_nombre text;

ALTER TABLE public.comprometidos
  ADD COLUMN IF NOT EXISTS firma_enlace_label    text,
  ADD COLUMN IF NOT EXISTS firma_enlace_nombre   text,
  ADD COLUMN IF NOT EXISTS firma_area_label      text,
  ADD COLUMN IF NOT EXISTS firma_area_nombre     text,
  ADD COLUMN IF NOT EXISTS firma_direccion_nombre text;

ALTER TABLE public.devengados
  ADD COLUMN IF NOT EXISTS firma_enlace_label    text,
  ADD COLUMN IF NOT EXISTS firma_enlace_nombre   text,
  ADD COLUMN IF NOT EXISTS firma_area_label      text,
  ADD COLUMN IF NOT EXISTS firma_area_nombre     text,
  ADD COLUMN IF NOT EXISTS firma_direccion_nombre text;
