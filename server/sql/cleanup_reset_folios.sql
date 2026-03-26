-- ================================================================
--  CONTROL PRESUPUESTAL MUNICIPAL
--  Script: Limpieza de tablas y reinicio de IDs y folios
--  Fecha: 2026-03-24
--  ATENCION: Este script borra datos de movimientos presupuestales.
--            No toca catálogos, usuarios ni presupuesto base.
--
--  Siguiente folio suficiencia: ECA-2026-03-SP-0002
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. Tablas de auditoría (on-demand, pueden no existir aún)
--    Se usa DO block para evitar error si la tabla no existe.
-- ----------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'auditoria_accesos') THEN
    TRUNCATE TABLE auditoria_accesos RESTART IDENTITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'auditoria_eventos') THEN
    TRUNCATE TABLE auditoria_eventos RESTART IDENTITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usuarios_audit') THEN
    TRUNCATE TABLE usuarios_audit RESTART IDENTITY;
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 2. Tablas de auditoría de suficiencias (sin hijos)
-- ----------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'suficiencias_audit') THEN
    TRUNCATE TABLE suficiencias_audit RESTART IDENTITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'suficiencia_detalle_audit') THEN
    TRUNCATE TABLE suficiencia_detalle_audit RESTART IDENTITY;
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 3. TRUNCATE de todas las tablas con FK entre sí en un solo comando
--    Orden no importa cuando se listan juntas; PostgreSQL las desactiva
--    y limpia en un solo paso atómico.
--
--    Grafo de dependencias:
--      suficiencias
--        ├── suficiencia_detalle
--        ├── comprometidos
--        │     ├── comprometido_detalle
--        │     └── devengados
--        │           └── devengado_detalle
--        └── expedientes_entrega (FK a las tres tablas principales)
-- ----------------------------------------------------------------
TRUNCATE TABLE
  suficiencias,
  suficiencia_detalle,
  comprometidos,
  comprometido_detalle,
  devengados,
  devengado_detalle,
  expedientes_entrega
RESTART IDENTITY;

-- ----------------------------------------------------------------
-- 4. Reiniciar secuencias de PKs a 1
--    setval(seq, 1, false) → el PRÓXIMO nextval() devuelve 1
-- ----------------------------------------------------------------

-- == Suficiencias ==
SELECT setval('suficiencias_id_seq',                    1, false);
SELECT setval('suficiencia_detalle_id_seq',             1, false);
SELECT setval('suficiencias_audit_audit_id_seq',        1, false);
SELECT setval('suficiencia_detalle_audit_audit_id_seq', 1, false);

-- == Comprometidos ==
SELECT setval('comprometidos_id_seq',        1, false);
SELECT setval('comprometido_detalle_id_seq', 1, false);

-- == Devengados ==
SELECT setval('devengados_id_seq',           1, false);
SELECT setval('devengado_detalle_id_seq',    1, false);

-- ----------------------------------------------------------------
-- 5. FOLIOS — ajuste para que el SIGUIENTE folio sea el correcto
--
--    SUFICIENCIAS → próximo folio: ECA-2026-03-SP-0002
--    -------------------------------------------------------
--    fn_next_folio_suficiencia() llama nextval('seq_suficiencia_folio')
--    El trigger fn_set_no_suficiencia usa suficiencias_folio_num_seq
--
--    setval(seq, 1, true)  → valor actual = 1, is_called = true
--                            → próximo nextval() devuelve 2  ← FOLIO 0002
--    setval(seq, 1, false) → próximo nextval() devuelve 1  ← FOLIO 0001 (incorrecto)
-- ----------------------------------------------------------------

-- Secuencia principal del folio (usada por Node.js y como fallback del trigger)
SELECT setval('seq_suficiencia_folio',       1, false);
-- SERIAL folio_num de la tabla suficiencias (usado por el trigger fn_set_no_suficiencia)
SELECT setval('suficiencias_folio_num_seq',  1, false);

-- Las demás secuencias de folio empiezan desde 0001 (primer registro = 0001)
SELECT setval('seq_comprometido_folio',      1, false);
SELECT setval('comprometidos_folio_seq',     1, false);
SELECT setval('seq_devengado_folio',         1, false);
SELECT setval('devengados_folio_seq',        1, false);
SELECT setval('seq_reconduccion_folio',      1, false);

COMMIT;
