-- =====================================================
--  Migración: tablas principales de Reconducciones
--  Fecha: 2026-02-23
--  Idempotente: usa CREATE TABLE IF NOT EXISTS
-- =====================================================

-- Tabla cabecera de reconducciones
CREATE TABLE IF NOT EXISTS public.reconducciones (
  id                    serial PRIMARY KEY,
  oficio                varchar(50),
  fecha_elaboracion     date,
  tipo_movimiento       varchar(30),
  justificacion         text,
  estatus               varchar(20) NOT NULL DEFAULT 'BORRADOR',
  ejercicio             integer,
  mes_pago_date         varchar(20),
  created_by            integer,
  created_at            timestamp without time zone NOT NULL DEFAULT NOW(),
  updated_at            timestamp without time zone NOT NULL DEFAULT NOW(),
  firma_enlace_label    text,
  firma_enlace_nombre   text,
  firma_area_label      text,
  firma_area_nombre     text,
  firma_direccion_nombre text
);

-- Índice único en oficio
CREATE UNIQUE INDEX IF NOT EXISTS reconducciones_oficio_key ON public.reconducciones (oficio);

-- Tabla de lados (ORIGEN / DESTINO)
CREATE TABLE IF NOT EXISTS public.reconducciones_lados (
  id              serial PRIMARY KEY,
  id_reconduccion integer NOT NULL REFERENCES public.reconducciones(id) ON DELETE CASCADE,
  lado            varchar(10) NOT NULL,
  id_dgeneral     integer,
  id_dauxiliar    integer,
  id_programa     integer,
  objetivo        text,
  id_fuente       integer,
  id_proyecto     integer,
  clave_proyecto  varchar(30),
  denominacion    text
);

-- Tabla de recursos (partidas por lado)
CREATE TABLE IF NOT EXISTS public.reconducciones_recursos (
  id                   serial PRIMARY KEY,
  id_reconduccion      integer NOT NULL REFERENCES public.reconducciones(id) ON DELETE CASCADE,
  lado                 varchar(10) NOT NULL,
  id_partida           integer,
  concepto_partida     text,
  autorizado           numeric(18,2),
  por_ejercer          numeric(18,2),
  monto_movimiento     numeric(18,2) NOT NULL DEFAULT 0,
  autorizado_modificado numeric(18,2),
  created_by           integer
);

-- Tabla de metas por lado
CREATE TABLE IF NOT EXISTS public.reconducciones_metas (
  id              serial PRIMARY KEY,
  id_reconduccion integer NOT NULL REFERENCES public.reconducciones(id) ON DELETE CASCADE,
  lado            varchar(10) NOT NULL,
  codigo          varchar(50),
  descripcion     text,
  unidad_medida   varchar(50),
  inicial         numeric(18,2),
  avance          numeric(18,2),
  modificada      numeric(18,2),
  t1              numeric(18,2),
  t2              numeric(18,2),
  t3              numeric(18,2),
  t4              numeric(18,2),
  created_by      integer
);

-- Tabla de movimientos (ledger contable)
CREATE TABLE IF NOT EXISTS public.reconducciones_movimientos (
  id              serial PRIMARY KEY,
  id_reconduccion integer NOT NULL REFERENCES public.reconducciones(id) ON DELETE CASCADE,
  lado            varchar(10),
  id_dgeneral     integer,
  id_dauxiliar    integer,
  id_fuente       integer,
  id_proyecto     integer,
  id_partida      integer,
  ejercicio       integer,
  mes_pago_date   varchar(20),
  monto           numeric(18,2),
  created_at      timestamp without time zone NOT NULL DEFAULT NOW(),
  created_by      integer
);

-- Vista resumen por reconducción
CREATE OR REPLACE VIEW public.v_reconducciones_resumen AS
SELECT
  r.id AS id_reconduccion,
  COALESCE(SUM(CASE WHEN rr.lado = 'ORIGEN'  THEN rr.monto_movimiento ELSE 0 END), 0) AS origen_total,
  COALESCE(SUM(CASE WHEN rr.lado = 'DESTINO' THEN rr.monto_movimiento ELSE 0 END), 0) AS destino_total,
  COALESCE(SUM(CASE WHEN rr.lado = 'DESTINO' THEN rr.monto_movimiento ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN rr.lado = 'ORIGEN' THEN rr.monto_movimiento ELSE 0 END), 0) AS diferencia
FROM public.reconducciones r
LEFT JOIN public.reconducciones_recursos rr ON rr.id_reconduccion = r.id
GROUP BY r.id;

-- Tablas auxiliares de claves y sesiones (usadas en el flujo de aprobación)
CREATE TABLE IF NOT EXISTS public.reconducciones_claves (
  id         serial PRIMARY KEY,
  clave      varchar(6) NOT NULL,
  dg_clave   varchar(3) NOT NULL DEFAULT '',
  da_clave   varchar(3) NOT NULL DEFAULT '',
  created_at timestamp without time zone NOT NULL DEFAULT NOW(),
  created_by integer,
  status     varchar(10) NOT NULL DEFAULT 'ACTIVA',
  used_at    timestamp without time zone,
  used_by    integer
);
CREATE UNIQUE INDEX IF NOT EXISTS reconducciones_claves_clave_key ON public.reconducciones_claves (clave);

CREATE TABLE IF NOT EXISTS public.reconducciones_sesiones (
  token       varchar(64) PRIMARY KEY,
  id_dgeneral integer NOT NULL,
  id_dauxiliar integer NOT NULL,
  created_at  timestamp without time zone NOT NULL DEFAULT NOW(),
  created_by  integer,
  activo      boolean NOT NULL DEFAULT true
);
