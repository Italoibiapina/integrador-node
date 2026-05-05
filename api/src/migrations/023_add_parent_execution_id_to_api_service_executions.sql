ALTER TABLE api_service_executions
ADD COLUMN IF NOT EXISTS parent_execution_id UUID NULL REFERENCES api_service_executions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_service_executions_parent_execution_id
  ON api_service_executions(parent_execution_id);
