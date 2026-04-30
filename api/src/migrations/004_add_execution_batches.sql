-- Migration: 004_add_execution_batches.sql
-- Description: Adiciona a tabela de lotes de execução (api_execution_batches) para agrupar múltiplas chamadas de serviços.

-- 1. Criar a tabela de lotes (batches)
CREATE TABLE IF NOT EXISTS api_execution_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running', -- running, success, failed, partial
    trigger_type TEXT NOT NULL DEFAULT 'manual', -- manual, scheduled
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Alterar a tabela service_execution_logs para incluir a referência ao lote
ALTER TABLE service_execution_logs 
ADD COLUMN batch_id UUID REFERENCES api_execution_batches(id) ON DELETE CASCADE;

-- 3. Criar índice para a nova coluna
CREATE INDEX IF NOT EXISTS idx_execution_logs_batch_id ON service_execution_logs(batch_id);
