-- Migration: 007_add_snapshot_to_batches.sql
-- Description: Adiciona campos de snapshot e campos de resultado à tabela api_batches.

ALTER TABLE api_batches ADD COLUMN name TEXT;
ALTER TABLE api_batches ADD COLUMN description TEXT;
ALTER TABLE api_batches ADD COLUMN is_active BOOLEAN;
ALTER TABLE api_batches ADD COLUMN endpoints JSONB DEFAULT '{}';
ALTER TABLE api_batches ADD COLUMN auth_config_id UUID; -- Referência opcional ou apenas registro do ID usado
ALTER TABLE api_batches ADD COLUMN error_message TEXT;
ALTER TABLE api_batches ADD COLUMN raw_response JSONB;
