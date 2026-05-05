-- Cadastra serviços de orquestração no catálogo de api_services (idempotente)

INSERT INTO api_services (
  name,
  description,
  auth_config_id,
  endpoint_url,
  service_name,
  parametro_get,
  parametros,
  is_active,
  current_status,
  last_run_at
)
SELECT
  'Dispatcher Service',
  'Worker de envio de pendências para sistemas destino.',
  NULL,
  NULL,
  'DispatcherService',
  NULL,
  '{}'::jsonb,
  true,
  'idle',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM api_services WHERE service_name = 'DispatcherService'
);

INSERT INTO api_services (
  name,
  description,
  auth_config_id,
  endpoint_url,
  service_name,
  parametro_get,
  parametros,
  is_active,
  current_status,
  last_run_at
)
SELECT
  'Integrador Operacoes Loja PowerStock',
  'Orquestra PowerStockGetOperationsService e DispatcherService.',
  NULL,
  NULL,
  'IntegradorOperacoesLojaDoPowerStockService',
  NULL,
  '{}'::jsonb,
  true,
  'idle',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM api_services WHERE service_name = 'IntegradorOperacoesLojaDoPowerStockService'
);
