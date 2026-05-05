CREATE TABLE IF NOT EXISTS sistema_destino_config (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  tabela_origem TEXT NOT NULL,
  entidade_view TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  metodo TEXT NOT NULL DEFAULT 'POST',
  ativo BOOLEAN NOT NULL DEFAULT true,
  conexao_api_id UUID NOT NULL REFERENCES api_auth_configs(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sistema_destino_config_tabela_origem
  ON sistema_destino_config(tabela_origem);

CREATE INDEX IF NOT EXISTS idx_sistema_destino_config_ativo
  ON sistema_destino_config(ativo);
