-- Migration: 030_create_api_integration_service_schedules.sql
-- Description: Agendamentos (cron) para execução de api_services (módulo api-integration).

CREATE TABLE IF NOT EXISTS api_integration_service_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_service_id UUID NOT NULL REFERENCES api_services(id) ON DELETE CASCADE,
  cron TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(api_service_id)
);

CREATE INDEX IF NOT EXISTS idx_api_integration_service_schedules_enabled
  ON api_integration_service_schedules(enabled);

CREATE INDEX IF NOT EXISTS idx_api_integration_service_schedules_service_id
  ON api_integration_service_schedules(api_service_id);
