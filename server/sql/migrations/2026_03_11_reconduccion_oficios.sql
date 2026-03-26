-- =====================================================
--  Migración: tabla reconduccion_oficios
--  Fecha: 2026-03-11
--  Almacena el oficio físico escaneado de cada reconducción
--  Idempotente: usa CREATE TABLE IF NOT EXISTS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.reconduccion_oficios (
  id              serial PRIMARY KEY,
  id_reconduccion integer NOT NULL REFERENCES public.reconducciones(id) ON DELETE CASCADE,
  nombre_archivo  text,
  ruta_archivo    text,
  tamano_bytes    integer,
  subido_por      integer,
  fecha_subida    timestamp without time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconduccion_oficios_reconduccion
  ON public.reconduccion_oficios (id_reconduccion);
