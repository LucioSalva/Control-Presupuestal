-- ================================================================
--  CONTROL PRESUPUESTAL MUNICIPAL
--  Migración: Corrección de fn_saldo_disponible_partida
--  Archivo:   2026_05_21_fn_saldo_fix.sql
--  Fecha:     2026-05-21
--
--  Motivo (auditoría B-4):
--    La definición previa en 2026_03_11_fn_saldo_partida.sql lee
--    columnas que NO existen en el esquema real:
--      - presupuesto_base_partidas.monto   → NO existe (hay ene..dic)
--      - presupuesto_base_partidas.clave   → NO existe (hay id_partida FK)
--      - suficiencias.monto                → NO existe (la columna real es 'total')
--      - comprometidos.monto               → NO existe (la columna real es 'total')
--    Esto provoca que la función actual devuelva siempre 0 en
--    presupuesto_base y reservado_suficiencias, o falle silente
--    si la query enmascara el error.
--
--  Corrección:
--    - presupuesto_base = suma de la columna mensual correspondiente
--      en presupuesto_base_partidas para esa partida (lookup vía
--      JOIN con partidas.clave).
--    - reservado_suficiencias = SUM(sd.importe) sobre suficiencia_detalle
--      filtrado por la cabecera (DG/DA/fuente/proyecto/mes/ejercicio/clave)
--      excluyendo suficiencias ya cerradas por un comprometido vigente.
--    - comprometido_vigente = SUM(cd.importe) sobre comprometido_detalle.
--    - devengado_en_cerrados = SUM(dd.importe) sobre devengado_detalle.
--
--  Idempotente: CREATE OR REPLACE FUNCTION.
--  No rompe llamadores: misma firma, mismo orden de columnas de salida.
-- ================================================================

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
  v_clave_norm         varchar := UPPER(TRIM(p_clave));
  v_mes_norm           varchar := UPPER(TRIM(p_mes_pago));
  v_presupuesto        numeric := 0;
  v_reservado_suf      numeric := 0;
  v_comprometido       numeric := 0;
  v_devengado_cerrados numeric := 0;
  v_saldo              numeric := 0;
BEGIN
  -- ============================================================
  -- 1) Presupuesto base — lee la columna mensual correspondiente
  --    de presupuesto_base_partidas, identificada por id_partida.
  -- ============================================================
  SELECT COALESCE(SUM(
    CASE v_mes_norm
      WHEN 'ENERO'      THEN pb.ene
      WHEN 'FEBRERO'    THEN pb.feb
      WHEN 'MARZO'      THEN pb.mar
      WHEN 'ABRIL'      THEN pb.abr
      WHEN 'MAYO'       THEN pb.may
      WHEN 'JUNIO'      THEN pb.jun
      WHEN 'JULIO'      THEN pb.jul
      WHEN 'AGOSTO'     THEN pb.ago
      WHEN 'SEPTIEMBRE' THEN pb.sep
      WHEN 'OCTUBRE'    THEN pb.oct
      WHEN 'NOVIEMBRE'  THEN pb.nov
      WHEN 'DICIEMBRE'  THEN pb.dic
      ELSE 0
    END
  ), 0)
    INTO v_presupuesto
    FROM public.presupuesto_base_partidas pb
    JOIN public.partidas pa ON pa.id = pb.id_partida
   WHERE pb.id_dgeneral  = p_id_dgeneral
     AND pb.id_dauxiliar = p_id_dauxiliar
     AND pb.id_fuente    = p_id_fuente
     AND (
           (p_id_proyecto IS NULL AND pb.id_proyecto IS NULL)
        OR pb.id_proyecto = p_id_proyecto
     )
     AND UPPER(TRIM(pa.clave)) = v_clave_norm
     AND pb.ejercicio    = p_ejercicio;

  -- ============================================================
  -- 2) Reservado por suficiencias — suma importe del DETALLE
  --    de las suficiencias del mismo lookup lógico que aún NO
  --    fueron cerradas por un comprometido vigente.
  -- ============================================================
  SELECT COALESCE(SUM(sd.importe), 0)
    INTO v_reservado_suf
    FROM public.suficiencias s
    JOIN public.suficiencia_detalle sd ON sd.id_suficiencia = s.id
   WHERE s.id_dgeneral  = p_id_dgeneral
     AND s.id_dauxiliar = p_id_dauxiliar
     AND s.id_fuente    = p_id_fuente
     AND s.id_proyecto  = p_id_proyecto
     AND UPPER(s.mes_pago) = v_mes_norm
     AND s.ejercicio    = p_ejercicio
     AND UPPER(TRIM(sd.clave)) = v_clave_norm
     AND COALESCE(s.estatus, 'ACTIVO') NOT IN ('CANCELADA', 'CANCELADO', 'RECHAZADA')
     AND NOT EXISTS (
       SELECT 1
         FROM public.comprometidos c
        WHERE c.id_suficiencia = s.id
          AND COALESCE(c.estatus, 'ACTIVO') NOT IN ('CANCELADO', 'CANCELADA')
     );

  -- ============================================================
  -- 3) Comprometido vigente — suma importe del DETALLE de los
  --    comprometidos no cancelados, atados a una suficiencia que
  --    coincide con el lookup lógico.
  -- ============================================================
  SELECT COALESCE(SUM(cd.importe), 0)
    INTO v_comprometido
    FROM public.comprometidos c
    JOIN public.suficiencias  s  ON s.id  = c.id_suficiencia
    JOIN public.comprometido_detalle cd ON cd.id_comprometido = c.id
   WHERE s.id_dgeneral  = p_id_dgeneral
     AND s.id_dauxiliar = p_id_dauxiliar
     AND s.id_fuente    = p_id_fuente
     AND s.id_proyecto  = p_id_proyecto
     AND UPPER(s.mes_pago) = v_mes_norm
     AND s.ejercicio    = p_ejercicio
     AND UPPER(TRIM(cd.clave)) = v_clave_norm
     AND COALESCE(c.estatus, 'ACTIVO') NOT IN ('CANCELADO', 'CANCELADA');

  -- ============================================================
  -- 4) Devengado en cerrados — suma importe del DETALLE de los
  --    devengados no cancelados.
  -- ============================================================
  SELECT COALESCE(SUM(dd.importe), 0)
    INTO v_devengado_cerrados
    FROM public.devengados d
    JOIN public.comprometidos c ON c.id = d.id_comprometido
    JOIN public.suficiencias  s ON s.id = c.id_suficiencia
    JOIN public.devengado_detalle dd ON dd.id_devengado = d.id
   WHERE s.id_dgeneral  = p_id_dgeneral
     AND s.id_dauxiliar = p_id_dauxiliar
     AND s.id_fuente    = p_id_fuente
     AND s.id_proyecto  = p_id_proyecto
     AND UPPER(s.mes_pago) = v_mes_norm
     AND s.ejercicio    = p_ejercicio
     AND UPPER(TRIM(dd.clave)) = v_clave_norm
     AND COALESCE(d.estatus, 'ACTIVO') NOT IN ('CANCELADO', 'CANCELADA');

  -- ============================================================
  -- 5) Saldo disponible
  --    Nota: comprometido y devengado_cerrados NO se suman entre
  --    sí porque cada devengado consume del comprometido al que
  --    pertenece (el cap del devengado está validado en código).
  --    Para saldo disponible solo descontamos suficiencias abiertas
  --    + comprometidos vigentes (que ya engloban sus devengados).
  --    devengado_en_cerrados se devuelve solo como información.
  -- ============================================================
  v_saldo := v_presupuesto - v_reservado_suf - v_comprometido;

  presupuesto_base       := v_presupuesto;
  reservado_suficiencias := v_reservado_suf;
  comprometido_vigente   := v_comprometido;
  devengado_en_cerrados  := v_devengado_cerrados;
  saldo_disponible       := v_saldo;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.fn_saldo_disponible_partida(
  integer, integer, integer, integer, varchar, varchar, integer
) IS
  'Saldo disponible por partida en una (DG/DA/Fuente/Proyecto/Clave/Mes/Ejercicio). '
  'Lee presupuesto desde columnas mensuales (ene..dic) de presupuesto_base_partidas '
  'y suma importes de las tablas *_detalle. Reemplaza versión 2026-03-11 con esquema correcto.';
