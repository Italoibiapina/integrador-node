-- Migration: 003_api_integration_tables.sql
-- Description: Criação das tabelas para gestão de serviços de API e logs de execução

-- 1. Tabela de Serviços
CREATE TABLE IF NOT EXISTS api_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_run_at TIMESTAMPTZ,
    current_status TEXT DEFAULT 'idle', -- idle, running, error
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tabela de Configurações Técnicas
CREATE TABLE IF NOT EXISTS api_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES api_services(id) ON DELETE CASCADE,
    base_url TEXT NOT NULL,
    username TEXT,
    password TEXT,
    last_token TEXT,
    token_expires_at TIMESTAMPTZ,
    extra_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(service_id)
);

-- 3. Tabela de Endpoints
CREATE TABLE IF NOT EXISTS api_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES api_services(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    path TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    purpose TEXT, -- login, fetch_orders, order_details, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Tabela de Logs de Execução
CREATE TABLE IF NOT EXISTS service_execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES api_services(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL, -- success, failed, running
    error_message TEXT,
    raw_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_execution_logs_service_id ON service_execution_logs(service_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_started_at ON service_execution_logs(started_at DESC);

-- Inserir dados iniciais para o PowerStock (Exemplo)
INSERT INTO api_services (name, description) 
VALUES ('PowerStock Integration', 'Integração via API REST para coleta de pedidos e dados de clientes.')
ON CONFLICT DO NOTHING;

-- Nota: Os IDs de serviço seriam necessários para preencher as outras tabelas. 
-- Em um ambiente real, isso seria feito via UI ou script de seed.
