-- Migration: 006_restore_auth_configs.sql
-- Description: Restaura a tabela de configurações de autenticação para permitir o compartilhamento entre múltiplos serviços.

-- 1. Criar a tabela de configurações de autenticação (api_auth_configs)
CREATE TABLE IF NOT EXISTS api_auth_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    username TEXT,
    password TEXT,
    last_token TEXT,
    token_expires_at TIMESTAMPTZ,
    extra_headers JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Alterar api_services para referenciar api_auth_configs
ALTER TABLE api_services ADD COLUMN auth_config_id UUID REFERENCES api_auth_configs(id) ON DELETE SET NULL;

-- 3. Remover colunas redundantes que foram movidas para api_auth_configs
-- Nota: Mantemos 'endpoints' em api_services pois cada serviço pode ter caminhos diferentes 
-- mesmo usando a mesma base_url/login.
ALTER TABLE api_services DROP COLUMN IF EXISTS base_url;
ALTER TABLE api_services DROP COLUMN IF EXISTS username;
ALTER TABLE api_services DROP COLUMN IF EXISTS password;
ALTER TABLE api_services DROP COLUMN IF EXISTS last_token;
ALTER TABLE api_services DROP COLUMN IF EXISTS token_expires_at;
ALTER TABLE api_services DROP COLUMN IF EXISTS extra_headers;

-- 4. Índice para a FK
CREATE INDEX IF NOT EXISTS idx_api_services_auth_config_id ON api_services(auth_config_id);
