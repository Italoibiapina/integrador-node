-- Remove trigger que fazia a normalização automaticamente ao inserir/atualizar operacoes_raw
DROP TRIGGER IF EXISTS trg_operacoes_raw_normalizacao_operacoes ON operacoes_raw;

-- Remove a função de trigger (não será mais usada sem o trigger)
DROP FUNCTION IF EXISTS trg_operacoes_raw_chamar_normalizacao_operacoes();

-- Renomeia a função para um nome mais descritivo (mantendo o mesmo comportamento)
DO $$
BEGIN
  IF to_regprocedure('public.fn_normalizar_operacoes(bigint)') IS NOT NULL
     AND to_regprocedure('public.fn_processar_operacao_venda_powerstock(bigint)') IS NULL
  THEN
    ALTER FUNCTION public.fn_normalizar_operacoes(bigint)
      RENAME TO fn_processar_operacao_venda_powerstock;
  END IF;
END $$;
