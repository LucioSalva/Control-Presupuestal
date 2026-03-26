-- =====================================================
--  Migración: normalización e índices de presupuesto_db
--  Fecha: 2026-03-11
--  Idempotente: usa CREATE INDEX IF NOT EXISTS
-- =====================================================

-- Índice principal para cálculo de saldo (usado por fn_saldo_disponible_partida)
CREATE INDEX IF NOT EXISTS idx_suf_saldo_lookup
  ON public.suficiencias (id_dgeneral, id_dauxiliar, id_fuente, id_proyecto, clave, mes_pago, ejercicio, estatus);

-- Índices de comprometidos
CREATE INDEX IF NOT EXISTS idx_comp_suficiencia
  ON public.comprometidos (id_suficiencia, estatus);

-- Índices de devengados
CREATE INDEX IF NOT EXISTS idx_dev_comprometido
  ON public.devengados (id_comprometido, estatus);

-- Índices de reconducciones
CREATE INDEX IF NOT EXISTS idx_recon_estatus
  ON public.reconducciones (estatus, ejercicio);

CREATE INDEX IF NOT EXISTS idx_recon_lados_recon
  ON public.reconducciones_lados (id_reconduccion, lado);

CREATE INDEX IF NOT EXISTS idx_recon_recursos_recon
  ON public.reconducciones_recursos (id_reconduccion, lado);

-- Índice único en partidas.clave (requerido por FK en expedientes_entrega)
CREATE UNIQUE INDEX IF NOT EXISTS uq_partidas_clave
  ON public.partidas (clave);
