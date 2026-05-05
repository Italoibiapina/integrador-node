CREATE OR REPLACE FUNCTION trg_vendas_raw_chamar_normalizacao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status_processamento = 'pendente' THEN
    -- Chama a procedure/função de normalização quando estiver disponível.
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'fn_normalizar_venda'
    ) THEN
      EXECUTE 'SELECT fn_normalizar_venda($1)' USING NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendas_raw_normalizacao ON vendas_raw;

CREATE TRIGGER trg_vendas_raw_normalizacao
AFTER INSERT OR UPDATE ON vendas_raw
FOR EACH ROW
WHEN (NEW.status_processamento = 'pendente')
EXECUTE FUNCTION trg_vendas_raw_chamar_normalizacao();
