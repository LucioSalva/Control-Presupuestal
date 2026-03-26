-- =====================================================
--  Migración: función fn_saldo_disponible_partida
--  Fecha: 2026-03-11
--  Calcula el saldo disponible de una partida evitando
--  doble conteo entre fases (suficiencia → comprometido → devengado)
--  Idempotente: usa CREATE OR REPLACE FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION public.fn_saldo_disponible_partida(
  p_id_dgeneral   integer,
  p_id_dauxiliar  integer,
  p_id_fuente     integer,
  p_id_proyecto   integer,
  p_clave         varchar,
  p_mes_pago      varchar,
  p_ejercicio     integer
)
RETURNS TABLE (
  presupuesto_base        numeric,
  reservado_suficiencias  numeric,
  comprometido_vigente    numeric,
  devengado_en_cerrados   numeric,
  saldo_disponible        numeric
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_presupuesto        numeric := 0;
  v_reservado_suf      numeric := 0;
  v_comprometido       numeric := 0;
  v_devengado_cerrados numeric := 0;
  v_saldo              numeric := 0;
BEGIN
  -- Presupuesto base de la partida
  SELECT COALESCE(pb.monto, 0)
    INTO v_presupuesto
    FROM public.presupuesto_base_partidas pb
   WHERE pb.id_dgeneral  = p_id_dgeneral
     AND pb.id_dauxiliar = p_id_dauxiliar
     AND pb.id_fuente    = p_id_fuente
     AND pb.id_proyecto  = p_id_proyecto
     AND UPPER(TRIM(pb.clave)) = UPPER(TRIM(p_clave))
     AND pb.ejercicio    = p_ejercicio
   LIMIT 1;

  -- Suficiencias abiertas (PENDIENTE o AUTORIZADA) no cerradas por comprometido
  SELECT COALESCE(SUM(s.monto), 0)
    INTO v_reservado_suf
    FROM public.suficiencias s
   WHERE s.id_dgeneral   = p_id_dgeneral
     AND s.id_dauxiliar  = p_id_dauxiliar
     AND s.id_fuente     = p_id_fuente
     AND s.id_proyecto   = p_id_proyecto
     AND UPPER(TRIM(s.clave)) = UPPER(TRIM(p_clave))
     AND UPPER(s.mes_pago)    = UPPER(p_mes_pago)
     AND s.ejercicio          = p_ejercicio
     AND s.estatus IN ('PENDIENTE', 'AUTORIZADA')
     AND NOT EXISTS (
       SELECT 1 FROM public.comprometidos c
        WHERE c.id_suficiencia = s.id
          AND c.estatus NOT IN ('CANCELADO')
     );

  -- Comprometidos vigentes (no cancelados)
  SELECT COALESCE(SUM(c.monto), 0)
    INTO v_comprometido
    FROM public.comprometidos c
    JOIN public.suficiencias  s ON s.id = c.id_suficiencia
   WHERE s.id_dgeneral   = p_id_dgeneral
     AND s.id_dauxiliar  = p_id_dauxiliar
     AND s.id_fuente     = p_id_fuente
     AND s.id_proyecto   = p_id_proyecto
     AND UPPER(TRIM(s.clave)) = UPPER(TRIM(p_clave))
     AND UPPER(s.mes_pago)    = UPPER(p_mes_pago)
     AND s.ejercicio          = p_ejercicio
     AND c.estatus NOT IN ('CANCELADO');

  -- Devengados en comprometidos cerrados
  SELECT COALESCE(SUM(d.total), 0)
    INTO v_devengado_cerrados
    FROM public.devengados  d
    JOIN public.comprometidos c ON c.id = d.id_comprometido
    JOIN public.suficiencias  s ON s.id = c.id_suficiencia
   WHERE s.id_dgeneral   = p_id_dgeneral
     AND s.id_dauxiliar  = p_id_dauxiliar
     AND s.id_fuente     = p_id_fuente
     AND s.id_proyecto   = p_id_proyecto
     AND UPPER(TRIM(s.clave)) = UPPER(TRIM(p_clave))
     AND UPPER(s.mes_pago)    = UPPER(p_mes_pago)
     AND s.ejercicio          = p_ejercicio
     AND d.estatus NOT IN ('CANCELADO');

  -- Saldo disponible
  v_saldo := v_presupuesto
             - v_reservado_suf
             - v_comprometido
             - v_devengado_cerrados;

  presupuesto_base       := v_presupuesto;
  reservado_suficiencias := v_reservado_suf;
  comprometido_vigente   := v_comprometido;
  devengado_en_cerrados  := v_devengado_cerrados;
  saldo_disponible       := v_saldo;

  RETURN NEXT;
END;
$$;
