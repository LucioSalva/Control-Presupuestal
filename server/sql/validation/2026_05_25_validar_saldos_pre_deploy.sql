-- ================================================================
--  CONTROL PRESUPUESTAL MUNICIPAL
--  Script de VALIDACIÓN pre-deploy (R-7)
--  Archivo: sql/validation/2026_05_25_validar_saldos_pre_deploy.sql
--  Fecha:   2026-05-25
--
--  OBJETIVO
--  --------
--  Ejecutar SOBRE UNA RÉPLICA de la BD productiva, DESPUÉS de
--  aplicar la migración 2026_05_21_fn_saldo_fix.sql.
--
--  Sirve para responder 4 preguntas antes de habilitar el fix en prod:
--
--    P1. ¿La nueva fn_saldo_disponible_partida está siquiera leyendo
--        valores > 0 desde presupuesto_base_partidas? (Antes leía
--        columnas inexistentes y devolvía 0.)
--
--    P2. ¿Cuántas combinaciones DG/DA/Fuente/Proyecto/Clave/Mes/Año
--        quedan con SALDO NEGATIVO con el nuevo cálculo? (Sobre-ejercicio
--        oculto por el bug previo.)
--
--    P3. ¿Hay suficiencias / comprometidos huérfanos (sin presupuesto
--        base) que la versión vieja escondía?
--
--    P4. Diff por partida del top-20 de mayor variación absoluta
--        (saldo NUEVO vs saldo ESTIMADO con la fórmula vieja).
--
--  MODO DE USO
--  -----------
--  En la réplica:
--    psql "$DATABASE_URL_REPLICA" -f sql/validation/2026_05_25_validar_saldos_pre_deploy.sql > validacion.out
--
--  Revisar validacion.out con contraloría / tesorería antes de aplicar
--  la migración en producción.
--
--  ESTE SCRIPT NO MODIFICA DATOS — solo SELECT.
-- ================================================================

\timing on
\pset pager off

-- ----------------------------------------------------------------
-- 0) Verificación: la función nueva existe y devuelve la firma
--    esperada.
-- ----------------------------------------------------------------
SELECT '0. Firma de fn_saldo_disponible_partida' AS bloque;
SELECT proname,
       pg_get_function_arguments(oid)            AS args,
       pg_get_function_result(oid)               AS returns
  FROM pg_proc
 WHERE proname = 'fn_saldo_disponible_partida';

-- ----------------------------------------------------------------
-- 1) Materializar el universo de combinaciones lógicas que aparecen
--    en suficiencias activas. Estas son las celdas que el sistema
--    consulta cada vez que un usuario abre el módulo de suficiencias.
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS tmp_universo_saldos;
CREATE TEMP TABLE tmp_universo_saldos AS
SELECT DISTINCT
       s.id_dgeneral,
       s.id_dauxiliar,
       s.id_fuente,
       s.id_proyecto,
       UPPER(TRIM(sd.clave)) AS clave,
       UPPER(s.mes_pago)     AS mes_pago,
       s.ejercicio
  FROM public.suficiencias        s
  JOIN public.suficiencia_detalle sd ON sd.id_suficiencia = s.id
 WHERE COALESCE(s.estatus, 'ACTIVO') NOT IN ('CANCELADA', 'CANCELADO', 'RECHAZADA');

SELECT '1. Universo' AS bloque, COUNT(*) AS combinaciones FROM tmp_universo_saldos;

-- ----------------------------------------------------------------
-- 2) Calcular saldos NUEVOS para todo el universo.
--    LATERAL para invocar la función fila por fila.
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS tmp_saldos_nuevos;
CREATE TEMP TABLE tmp_saldos_nuevos AS
SELECT u.*,
       s.presupuesto_base,
       s.reservado_suficiencias,
       s.comprometido_vigente,
       s.devengado_en_cerrados,
       s.saldo_disponible
  FROM tmp_universo_saldos u
  CROSS JOIN LATERAL public.fn_saldo_disponible_partida(
       u.id_dgeneral,
       u.id_dauxiliar,
       u.id_fuente,
       u.id_proyecto,
       u.clave,
       u.mes_pago,
       u.ejercicio
  ) s;

-- ----------------------------------------------------------------
-- P1 — ¿Cuántas combinaciones leen presupuesto_base > 0?
--      Si todo sale en 0, la función NUEVA tampoco funciona.
-- ----------------------------------------------------------------
SELECT 'P1. Lecturas de presupuesto base' AS bloque;
SELECT
  COUNT(*)                                       AS total_combinaciones,
  COUNT(*) FILTER (WHERE presupuesto_base > 0)   AS con_presupuesto,
  COUNT(*) FILTER (WHERE presupuesto_base = 0)   AS sin_presupuesto,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE presupuesto_base > 0) / NULLIF(COUNT(*), 0),
    2
  )                                              AS pct_con_presupuesto
FROM tmp_saldos_nuevos;

-- ----------------------------------------------------------------
-- P2 — Saldos negativos: combinaciones donde se gastó MÁS de lo
--      presupuestado. Antes del fix esto quedaba oculto.
--      Detalle hasta 100 filas, ordenadas por magnitud del negativo.
-- ----------------------------------------------------------------
SELECT 'P2. Combinaciones con saldo NEGATIVO (sobre-ejercicio)' AS bloque;
SELECT
  COUNT(*) FILTER (WHERE saldo_disponible <  0)  AS combinaciones_negativas,
  COALESCE(SUM(saldo_disponible) FILTER (WHERE saldo_disponible < 0), 0) AS magnitud_total
FROM tmp_saldos_nuevos;

SELECT 'P2. Detalle top-100 negativos' AS bloque;
SELECT
  id_dgeneral, id_dauxiliar, id_fuente, id_proyecto,
  clave, mes_pago, ejercicio,
  presupuesto_base, reservado_suficiencias,
  comprometido_vigente, devengado_en_cerrados,
  saldo_disponible
FROM tmp_saldos_nuevos
WHERE saldo_disponible < 0
ORDER BY saldo_disponible ASC
LIMIT 100;

-- ----------------------------------------------------------------
-- P3 — Huérfanos: hay reserva/compromiso pero presupuesto_base = 0.
--      Indica suficiencias capturadas sobre un proyecto/clave sin
--      presupuesto base cargado. Antes del fix se mostraban como
--      "todo bien".
-- ----------------------------------------------------------------
SELECT 'P3. Huérfanos sin presupuesto base' AS bloque;
SELECT
  COUNT(*) AS huerfanos,
  SUM(reservado_suficiencias + comprometido_vigente) AS consumo_sin_respaldo
FROM tmp_saldos_nuevos
WHERE presupuesto_base = 0
  AND (reservado_suficiencias > 0 OR comprometido_vigente > 0);

SELECT 'P3. Detalle top-100 huérfanos' AS bloque;
SELECT
  id_dgeneral, id_dauxiliar, id_fuente, id_proyecto,
  clave, mes_pago, ejercicio,
  reservado_suficiencias, comprometido_vigente,
  devengado_en_cerrados
FROM tmp_saldos_nuevos
WHERE presupuesto_base = 0
  AND (reservado_suficiencias > 0 OR comprometido_vigente > 0)
ORDER BY (reservado_suficiencias + comprometido_vigente) DESC
LIMIT 100;

-- ----------------------------------------------------------------
-- P4 — Diff vs cálculo VIEJO simulado.
--    La función vieja leía monto/clave de presupuesto_base_partidas
--    (columnas inexistentes), así que en la práctica devolvía 0 en
--    presupuesto_base. Para no inventar el comportamiento real del
--    bug, aquí solo reportamos cuántos casos verán cifras nuevas
--    NO-cero donde antes la UI mostraba "sin presupuesto".
-- ----------------------------------------------------------------
SELECT 'P4. Casos que cambian de comportamiento UI tras el fix' AS bloque;
SELECT
  COUNT(*) FILTER (WHERE presupuesto_base > 0) AS casos_que_ahora_muestran_presupuesto,
  COUNT(*) FILTER (
    WHERE presupuesto_base > 0 AND saldo_disponible < 0
  )                                            AS casos_que_pasan_de_oculto_a_negativo
FROM tmp_saldos_nuevos;

-- ----------------------------------------------------------------
-- BONUS — Top-20 partidas por mayor presupuesto base detectado.
--    Útil para que tesorería confirme con una hoja maestra externa.
-- ----------------------------------------------------------------
SELECT 'BONUS. Top-20 mayor presupuesto base' AS bloque;
SELECT
  id_dgeneral, id_dauxiliar, id_fuente, id_proyecto,
  clave, mes_pago, ejercicio,
  presupuesto_base, saldo_disponible
FROM tmp_saldos_nuevos
ORDER BY presupuesto_base DESC NULLS LAST
LIMIT 20;

-- ----------------------------------------------------------------
-- LIMPIEZA
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS tmp_saldos_nuevos;
DROP TABLE IF EXISTS tmp_universo_saldos;

SELECT 'FIN. Validación completada' AS bloque;
