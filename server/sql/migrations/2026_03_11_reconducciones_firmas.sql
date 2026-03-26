-- =====================================================
--  Migración: columnas de firma en reconducciones
--  Fecha: 2026-03-11
--  Idempotente: usa ADD COLUMN IF NOT EXISTS
-- =====================================================

ALTER TABLE public.reconducciones
  ADD COLUMN IF NOT EXISTS firma_enlace_label    text,
  ADD COLUMN IF NOT EXISTS firma_enlace_nombre   text,
  ADD COLUMN IF NOT EXISTS firma_area_label      text,
  ADD COLUMN IF NOT EXISTS firma_area_nombre     text,
  ADD COLUMN IF NOT EXISTS firma_direccion_nombre text;
