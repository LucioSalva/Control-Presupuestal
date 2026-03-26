-- Migración: FK y triggers en expedientes_entrega
-- Aplicada idempotentemente
-- NOTA: dgeneral no tiene columna 'descripcion'; se usa 'dependencia'.
--       devengados usa columna 'total' (no 'monto').
--       partidas.clave tiene UNIQUE INDEX uq_partidas_clave → FK #6 incluida.

-- 1. FK id_suficiencia → suficiencias(id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_expedientes_suficiencia'
    AND table_name = 'expedientes_entrega'
  ) THEN
    ALTER TABLE expedientes_entrega
      ADD CONSTRAINT fk_expedientes_suficiencia
      FOREIGN KEY (id_suficiencia) REFERENCES suficiencias(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. FK id_comprometido → comprometidos(id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_expedientes_comprometido'
    AND table_name = 'expedientes_entrega'
  ) THEN
    ALTER TABLE expedientes_entrega
      ADD CONSTRAINT fk_expedientes_comprometido
      FOREIGN KEY (id_comprometido) REFERENCES comprometidos(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. FK id_devengado → devengados(id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_expedientes_devengado'
    AND table_name = 'expedientes_entrega'
  ) THEN
    ALTER TABLE expedientes_entrega
      ADD CONSTRAINT fk_expedientes_devengado
      FOREIGN KEY (id_devengado) REFERENCES devengados(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. FK id_dgeneral → dgeneral(id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_expedientes_dgeneral'
    AND table_name = 'expedientes_entrega'
  ) THEN
    ALTER TABLE expedientes_entrega
      ADD CONSTRAINT fk_expedientes_dgeneral
      FOREIGN KEY (id_dgeneral) REFERENCES dgeneral(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 5. FK id_dauxiliar → dauxiliar(id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_expedientes_dauxiliar'
    AND table_name = 'expedientes_entrega'
  ) THEN
    ALTER TABLE expedientes_entrega
      ADD CONSTRAINT fk_expedientes_dauxiliar
      FOREIGN KEY (id_dauxiliar) REFERENCES dauxiliar(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 6. FK partida_clave → partidas(clave)
--    Incluida: partidas.clave tiene UNIQUE INDEX uq_partidas_clave
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_expedientes_partida_clave'
    AND table_name = 'expedientes_entrega'
  ) THEN
    ALTER TABLE expedientes_entrega
      ADD CONSTRAINT fk_expedientes_partida_clave
      FOREIGN KEY (partida_clave) REFERENCES partidas(clave) ON DELETE SET NULL;
  END IF;
END $$;

-- 7. Función trigger: auto-poblar dependencia, concepto, importe
--    Correcciones aplicadas:
--      - dgeneral.dependencia (no 'descripcion', esa columna no existe)
--      - devengados.total     (no 'monto', esa columna no existe)
CREATE OR REPLACE FUNCTION fn_expedientes_entrega_auto_populate()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-poblar dependencia desde dgeneral.dependencia
  IF NEW.id_dgeneral IS NOT NULL THEN
    SELECT dependencia INTO NEW.dependencia FROM dgeneral WHERE id = NEW.id_dgeneral;
  END IF;

  -- Auto-poblar concepto desde partidas.descripcion
  IF NEW.partida_clave IS NOT NULL THEN
    SELECT descripcion INTO NEW.concepto FROM partidas WHERE clave = NEW.partida_clave;
  END IF;

  -- Auto-poblar importe desde devengados.total
  IF NEW.id_devengado IS NOT NULL THEN
    SELECT total INTO NEW.importe FROM devengados WHERE id = NEW.id_devengado;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Crear trigger (idempotente)
DROP TRIGGER IF EXISTS trg_expedientes_entrega_auto_populate ON expedientes_entrega;
CREATE TRIGGER trg_expedientes_entrega_auto_populate
  BEFORE INSERT OR UPDATE ON expedientes_entrega
  FOR EACH ROW EXECUTE FUNCTION fn_expedientes_entrega_auto_populate();
