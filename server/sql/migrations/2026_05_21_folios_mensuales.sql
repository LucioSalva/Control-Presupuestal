-- ================================================================
--  CONTROL PRESUPUESTAL MUNICIPAL
--  Migración: Folios mensuales atómicos + Lock saldo por partida
--  Archivo: 2026_05_21_folios_mensuales.sql
--  Fecha:   2026-05-21
--
--  Objetivos:
--    B-3) Folios con reset MENSUAL por tipo (SP, CP, DEV, RC).
--         La secuencia global previa (seq_*_folio) saltaba entre
--         meses al mezclarse todos los registros. Se reemplaza por
--         tabla folios_contadores con clave (tipo, anio, mes).
--    C-2) Función de lock pesimista para evitar saldo negativo
--         bajo concurrencia en presupuesto_base_partidas.
--
--  Idempotente:
--    - CREATE TABLE IF NOT EXISTS
--    - CREATE OR REPLACE FUNCTION
--    - INSERT ... ON CONFLICT DO NOTHING para el seed
--    - DO block con guard sobre pg_constraint para UNIQUE
--
--  Compatibilidad:
--    - NO destruye sequences viejas (seq_*_folio); quedan
--      DEPRECATED por compatibilidad con código no migrado.
--    - NO añade CHECK monto >= 0 todavía (ver TODO al final).
-- ================================================================


-- ----------------------------------------------------------------
-- 1. Tabla de contadores mensuales por tipo
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.folios_contadores (
  tipo               varchar(10)  NOT NULL,
  anio               integer      NOT NULL,
  mes                integer      NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ultimo_consecutivo integer      NOT NULL DEFAULT 0 CHECK (ultimo_consecutivo >= 0),
  updated_at         timestamp without time zone NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tipo, anio, mes)
);

COMMENT ON TABLE  public.folios_contadores IS
  'Contador atómico de folios por tipo (SP/CP/DEV/RC) y mes. Se reinicia en 0 cada nuevo mes.';
COMMENT ON COLUMN public.folios_contadores.tipo IS
  'Tipo de documento: SP (suficiencia), CP (comprometido), DEV (devengado), RC (reconducción).';


-- ----------------------------------------------------------------
-- 2. Función atómica fn_next_folio(tipo, anio, mes)
--
--    Devuelve el siguiente entero (1..N) de la combinación
--    (tipo, anio, mes), creándola en 1 si no existía.
--
--    Estrategia: UPSERT con ON CONFLICT DO UPDATE ... RETURNING.
--    Postgres serializa los conflictos por PK, así que dos sesiones
--    concurrentes nunca obtienen el mismo NNNN. No requiere lock
--    explícito.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_next_folio(
  p_tipo varchar,
  p_anio integer,
  p_mes  integer
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo varchar := UPPER(TRIM(p_tipo));
  v_next integer;
BEGIN
  IF v_tipo IS NULL OR v_tipo = '' THEN
    RAISE EXCEPTION 'fn_next_folio: tipo es obligatorio';
  END IF;
  IF p_anio IS NULL OR p_anio < 2000 OR p_anio > 9999 THEN
    RAISE EXCEPTION 'fn_next_folio: anio fuera de rango (recibido %)', p_anio;
  END IF;
  IF p_mes IS NULL OR p_mes < 1 OR p_mes > 12 THEN
    RAISE EXCEPTION 'fn_next_folio: mes fuera de rango (recibido %)', p_mes;
  END IF;

  INSERT INTO public.folios_contadores (tipo, anio, mes, ultimo_consecutivo, updated_at)
  VALUES (v_tipo, p_anio, p_mes, 1, NOW())
  ON CONFLICT (tipo, anio, mes) DO UPDATE
    SET ultimo_consecutivo = public.folios_contadores.ultimo_consecutivo + 1,
        updated_at         = NOW()
  RETURNING ultimo_consecutivo INTO v_next;

  RETURN v_next;
END;
$$;

COMMENT ON FUNCTION public.fn_next_folio(varchar, integer, integer) IS
  'Devuelve el siguiente folio mensual atómico para (tipo, anio, mes). '
  'Tipos: SP, CP, DEV, RC. Reset implícito al cambiar de mes.';


-- ----------------------------------------------------------------
-- 3. Seed: migrar contadores desde tablas existentes
--
--    Para cada tipo se extrae (anio, mes, NNNN) del folio actual
--    y se inserta el MAX. Idempotente: ON CONFLICT DO NOTHING para
--    no pisar contadores ya avanzados por la propia función.
--
--    Convenciones de prefijo detectadas en código vivo:
--      suficiencias.no_suficiencia  → ECA-YYYY-MM-SP-NNNN
--      comprometidos.no_comprometido → ECA-YYYY-MM-CP-NNNN
--      devengados.no_devengado      → ECA-YYYY-MM-DV-NNNN  (código usa DV, tipo lógico = DEV)
--      reconducciones.oficio        → ECA-YYYY-MM-RCP-NNNN (tipo lógico = RC)
-- ----------------------------------------------------------------
DO $$
BEGIN
  -- SP — suficiencias
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'suficiencias') THEN
    INSERT INTO public.folios_contadores (tipo, anio, mes, ultimo_consecutivo, updated_at)
    SELECT
      'SP',
      (regexp_match(no_suficiencia, '^ECA-(\d{4})-(\d{2})-SP-(\d+)$'))[1]::int AS anio,
      (regexp_match(no_suficiencia, '^ECA-(\d{4})-(\d{2})-SP-(\d+)$'))[2]::int AS mes,
      MAX((regexp_match(no_suficiencia, '^ECA-(\d{4})-(\d{2})-SP-(\d+)$'))[3]::int) AS max_n,
      NOW()
    FROM public.suficiencias
    WHERE no_suficiencia ~ '^ECA-\d{4}-\d{2}-SP-\d+$'
    GROUP BY
      (regexp_match(no_suficiencia, '^ECA-(\d{4})-(\d{2})-SP-(\d+)$'))[1]::int,
      (regexp_match(no_suficiencia, '^ECA-(\d{4})-(\d{2})-SP-(\d+)$'))[2]::int
    ON CONFLICT (tipo, anio, mes) DO NOTHING;
  END IF;

  -- CP — comprometidos
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'comprometidos') THEN
    INSERT INTO public.folios_contadores (tipo, anio, mes, ultimo_consecutivo, updated_at)
    SELECT
      'CP',
      (regexp_match(no_comprometido, '^ECA-(\d{4})-(\d{2})-CP-(\d+)$'))[1]::int,
      (regexp_match(no_comprometido, '^ECA-(\d{4})-(\d{2})-CP-(\d+)$'))[2]::int,
      MAX((regexp_match(no_comprometido, '^ECA-(\d{4})-(\d{2})-CP-(\d+)$'))[3]::int),
      NOW()
    FROM public.comprometidos
    WHERE no_comprometido ~ '^ECA-\d{4}-\d{2}-CP-\d+$'
    GROUP BY
      (regexp_match(no_comprometido, '^ECA-(\d{4})-(\d{2})-CP-(\d+)$'))[1]::int,
      (regexp_match(no_comprometido, '^ECA-(\d{4})-(\d{2})-CP-(\d+)$'))[2]::int
    ON CONFLICT (tipo, anio, mes) DO NOTHING;
  END IF;

  -- DEV — devengados (prefijo histórico DV)
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'devengados') THEN
    INSERT INTO public.folios_contadores (tipo, anio, mes, ultimo_consecutivo, updated_at)
    SELECT
      'DEV',
      (regexp_match(no_devengado, '^ECA-(\d{4})-(\d{2})-DV-(\d+)$'))[1]::int,
      (regexp_match(no_devengado, '^ECA-(\d{4})-(\d{2})-DV-(\d+)$'))[2]::int,
      MAX((regexp_match(no_devengado, '^ECA-(\d{4})-(\d{2})-DV-(\d+)$'))[3]::int),
      NOW()
    FROM public.devengados
    WHERE no_devengado ~ '^ECA-\d{4}-\d{2}-DV-\d+$'
    GROUP BY
      (regexp_match(no_devengado, '^ECA-(\d{4})-(\d{2})-DV-(\d+)$'))[1]::int,
      (regexp_match(no_devengado, '^ECA-(\d{4})-(\d{2})-DV-(\d+)$'))[2]::int
    ON CONFLICT (tipo, anio, mes) DO NOTHING;
  END IF;

  -- RC — reconducciones (prefijo histórico RCP, columna oficio)
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'reconducciones') THEN
    INSERT INTO public.folios_contadores (tipo, anio, mes, ultimo_consecutivo, updated_at)
    SELECT
      'RC',
      (regexp_match(oficio, '^ECA-(\d{4})-(\d{2})-RCP-(\d+)$'))[1]::int,
      (regexp_match(oficio, '^ECA-(\d{4})-(\d{2})-RCP-(\d+)$'))[2]::int,
      MAX((regexp_match(oficio, '^ECA-(\d{4})-(\d{2})-RCP-(\d+)$'))[3]::int),
      NOW()
    FROM public.reconducciones
    WHERE oficio ~ '^ECA-\d{4}-\d{2}-RCP-\d+$'
    GROUP BY
      (regexp_match(oficio, '^ECA-(\d{4})-(\d{2})-RCP-(\d+)$'))[1]::int,
      (regexp_match(oficio, '^ECA-(\d{4})-(\d{2})-RCP-(\d+)$'))[2]::int
    ON CONFLICT (tipo, anio, mes) DO NOTHING;
  END IF;
END $$;


-- ----------------------------------------------------------------
-- 4. UNIQUE constraints sobre las columnas de folio
--    (defensa de profundidad: aunque dos inserts colisionen en
--     el contador, una colisión a nivel BD aborta el INSERT)
--
--    Verifica via pg_constraint para no duplicar.
-- ----------------------------------------------------------------
DO $$
BEGIN
  -- suficiencias.no_suficiencia
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='suficiencias' AND column_name='no_suficiencia')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'suficiencias'
          AND c.conname = 'uq_suficiencias_no_suficiencia'
     ) THEN
    BEGIN
      ALTER TABLE public.suficiencias
        ADD CONSTRAINT uq_suficiencias_no_suficiencia UNIQUE (no_suficiencia);
    EXCEPTION WHEN unique_violation OR duplicate_table THEN
      -- ya existe (carrera) o hay duplicados previos en datos
      RAISE NOTICE 'uq_suficiencias_no_suficiencia: no se pudo crear (posibles duplicados o constraint paralelo).';
    END;
  END IF;

  -- comprometidos.no_comprometido
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='comprometidos' AND column_name='no_comprometido')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'comprometidos'
          AND c.conname = 'uq_comprometidos_no_comprometido'
     ) THEN
    BEGIN
      ALTER TABLE public.comprometidos
        ADD CONSTRAINT uq_comprometidos_no_comprometido UNIQUE (no_comprometido);
    EXCEPTION WHEN unique_violation OR duplicate_table THEN
      RAISE NOTICE 'uq_comprometidos_no_comprometido: no se pudo crear (posibles duplicados o constraint paralelo).';
    END;
  END IF;

  -- devengados.no_devengado
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='devengados' AND column_name='no_devengado')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'devengados'
          AND c.conname = 'uq_devengados_no_devengado'
     ) THEN
    BEGIN
      ALTER TABLE public.devengados
        ADD CONSTRAINT uq_devengados_no_devengado UNIQUE (no_devengado);
    EXCEPTION WHEN unique_violation OR duplicate_table THEN
      RAISE NOTICE 'uq_devengados_no_devengado: no se pudo crear (posibles duplicados o constraint paralelo).';
    END;
  END IF;
END $$;


-- ----------------------------------------------------------------
-- 5. Marcar sequences viejas como DEPRECATED (no se destruyen)
-- ----------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'seq_suficiencia_folio') THEN
    EXECUTE 'COMMENT ON SEQUENCE public.seq_suficiencia_folio IS '
            '''DEPRECATED 2026-05-21: usar public.fn_next_folio(''''SP'''', anio, mes). '
            'Mantenido por compatibilidad; no eliminar sin revisar callers.'' ';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'seq_comprometido_folio') THEN
    EXECUTE 'COMMENT ON SEQUENCE public.seq_comprometido_folio IS '
            '''DEPRECATED 2026-05-21: usar public.fn_next_folio(''''CP'''', anio, mes).'' ';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'seq_devengado_folio') THEN
    EXECUTE 'COMMENT ON SEQUENCE public.seq_devengado_folio IS '
            '''DEPRECATED 2026-05-21: usar public.fn_next_folio(''''DEV'''', anio, mes).'' ';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'seq_reconduccion_folio') THEN
    EXECUTE 'COMMENT ON SEQUENCE public.seq_reconduccion_folio IS '
            '''DEPRECATED 2026-05-21: usar public.fn_next_folio(''''RC'''', anio, mes).'' ';
  END IF;
END $$;


-- ================================================================
-- 6. C-2 — Lock pesimista de partida para evitar saldo negativo
-- ================================================================
-- Función fn_lock_partida_para_saldo
--
-- Selecciona FOR UPDATE la fila de presupuesto_base_partidas
-- correspondiente al lookup lógico (DG/DA/Fuente/Proyecto/Partida/Ejercicio).
-- Debe llamarse SIEMPRE dentro de una transacción explícita (BEGIN),
-- antes de calcular saldo y antes de insertar suficiencia/comprometido/devengado
-- que vaya a consumir esa partida.
--
-- Si no encuentra fila (no hay presupuesto base aún) hace un advisory
-- lock por la combinación lógica como fallback, para serializar también
-- el caso "partida sin presupuesto".
--
-- RETURNS void: el efecto colateral es el lock, no se consume nada.
-- ================================================================
CREATE OR REPLACE FUNCTION public.fn_lock_partida_para_saldo(
  p_id_dgeneral  integer,
  p_id_dauxiliar integer,
  p_id_fuente    integer,
  p_id_proyecto  integer,
  p_clave        varchar,
  p_ejercicio    integer
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_found integer;
  v_lock_key bigint;
BEGIN
  -- Intenta tomar lock fila de presupuesto base
  SELECT 1
    INTO v_found
    FROM public.presupuesto_base_partidas pb
    JOIN public.partidas pa ON pa.id = pb.id_partida
   WHERE pb.id_dgeneral  = p_id_dgeneral
     AND pb.id_dauxiliar = p_id_dauxiliar
     AND pb.id_fuente    = p_id_fuente
     AND (
           (p_id_proyecto IS NULL AND pb.id_proyecto IS NULL)
        OR pb.id_proyecto = p_id_proyecto
     )
     AND UPPER(TRIM(pa.clave)) = UPPER(TRIM(p_clave))
     AND pb.ejercicio    = p_ejercicio
   LIMIT 1
   FOR UPDATE;

  -- Si no hay fila base, usar advisory lock por la clave lógica.
  -- hashtextextended es estable y devuelve bigint, apto para pg_advisory_xact_lock.
  IF v_found IS NULL THEN
    v_lock_key := hashtextextended(
      COALESCE(p_id_dgeneral::text,  '-') || '|' ||
      COALESCE(p_id_dauxiliar::text, '-') || '|' ||
      COALESCE(p_id_fuente::text,    '-') || '|' ||
      COALESCE(p_id_proyecto::text,  '-') || '|' ||
      COALESCE(UPPER(TRIM(p_clave)), '-') || '|' ||
      COALESCE(p_ejercicio::text,    '-'),
      0
    );
    PERFORM pg_advisory_xact_lock(v_lock_key);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_lock_partida_para_saldo(integer, integer, integer, integer, varchar, integer) IS
  'Lock pesimista (FOR UPDATE o advisory xact lock) sobre la partida lógica. '
  'Llamar dentro de BEGIN antes de validar saldo y antes de INSERT que consuma '
  'presupuesto. Evita race condition que produce saldo negativo.';


-- ----------------------------------------------------------------
-- TODO (post-saneamiento):
--   - Añadir CHECK al menos sobre las columnas mensuales:
--       ALTER TABLE presupuesto_base_partidas
--         ADD CONSTRAINT chk_pbp_meses_no_neg
--         CHECK (ene >= 0 AND feb >= 0 AND ... AND dic >= 0);
--     ANTES verificar que no existan datos negativos heredados.
--   - Migrar los callers de seq_*_folio a fn_next_folio.
--   - Eliminar las sequences viejas tras 1 mes en producción sin uso.
-- ----------------------------------------------------------------
