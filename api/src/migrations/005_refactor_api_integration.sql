-- Migration: 005_refactor_api_integration.sql
-- Description: Refatora a estrutura para simplificar tabelas, adicionar snapshots e renomear logs.

-- 1. Incorporar api_configs e api_endpoints na api_services
ALTER TABLE api_services ADD COLUMN base_url TEXT;
ALTER TABLE api_services ADD COLUMN username TEXT;
ALTER TABLE api_services ADD COLUMN password TEXT;
ALTER TABLE api_services ADD COLUMN last_token TEXT;
ALTER TABLE api_services ADD COLUMN token_expires_at TIMESTAMPTZ;
ALTER TABLE api_services ADD COLUMN extra_headers JSONB DEFAULT '{}';
ALTER TABLE api_services ADD COLUMN endpoints JSONB DEFAULT '{}';

-- 2. Migrar dados existentes (se houver) - Opcional se for ambiente dev
-- (Pular migração de dados complexa pois estamos em fase de design inicial)

-- 3. Renomear a tabela de lotes (Execução Total)
-- O usuário sugeriu que o nome da "execução total" ou do log pudesse ser api_service_execution.
-- Para clareza, chamaremos a Total de 'api_batches' e o log individual de 'api_service_executions'.
ALTER TABLE api_execution_batches RENAME TO api_batches;

-- 4. Renomear e refatorar a tabela de logs (api_service_executions)
-- Vamos recriar para garantir a estrutura limpa com snapshot
DROP TABLE IF EXISTS service_execution_logs;

CREATE TABLE api_service_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES api_batches(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES api_services(id) ON DELETE CASCADE,
    
    -- Snapshot da configuração no momento da execução
    snapshot_config JSONB NOT NULL, 
    
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',
    error_message TEXT,
    raw_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Remover tabelas obsoletas
DROP TABLE IF EXISTS api_configs;
DROP TABLE IF EXISTS api_endpoints;

-- 6. Índices para performance
CREATE INDEX idx_service_executions_batch_id ON api_service_executions(batch_id);
CREATE INDEX idx_service_executions_service_id ON api_service_executions(service_id);
