-- 1) Renomeia função antiga para o novo nome, preservando a implementação atual
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'fn_normalizar_venda'
      AND n.nspname = 'public'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'fn_normalizar_operacoes'
      AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION fn_normalizar_venda(bigint) RENAME TO fn_normalizar_operacoes;
  END IF;
END $$;

-- 2) Função do trigger atualizada para chamar a nova procedure/função
CREATE OR REPLACE FUNCTION trg_vendas_raw_chamar_normalizacao_operacoes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status_processamento = 'pendente' THEN
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'fn_normalizar_operacoes'
        AND n.nspname = 'public'
    ) THEN
      EXECUTE 'SELECT fn_normalizar_operacoes($1)' USING NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Trigger reconfigurado (mesmo evento/timing/filtro)
DROP TRIGGER IF EXISTS trg_vendas_raw_normalizacao ON vendas_raw;
DROP TRIGGER IF EXISTS trg_vendas_raw_normalizacao_operacoes ON vendas_raw;

CREATE TRIGGER trg_vendas_raw_normalizacao_operacoes
AFTER INSERT OR UPDATE ON vendas_raw
FOR EACH ROW
WHEN (NEW.status_processamento = 'pendente')
EXECUTE FUNCTION trg_vendas_raw_chamar_normalizacao_operacoes();
