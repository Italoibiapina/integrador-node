CREATE TABLE IF NOT EXISTS vendas_raw (
  id SERIAL PRIMARY KEY,
  id_venda_externo TEXT NOT NULL,
  payload JSONB NOT NULL,
  hash_payload TEXT NOT NULL,
  status_processamento TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status_processamento IN ('pendente', 'processado', 'erro')),
  data_extracao TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendas_raw_id_venda_externo
  ON vendas_raw(id_venda_externo);

CREATE INDEX IF NOT EXISTS idx_vendas_raw_status_processamento
  ON vendas_raw(status_processamento);

CREATE TABLE IF NOT EXISTS integracao_pendente (
  id SERIAL PRIMARY KEY,
  sistema_nome TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  metodo TEXT NOT NULL DEFAULT 'POST',
  entidade TEXT NOT NULL,
  payload_id INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'enviado', 'erro')),
  tentativas INT NOT NULL DEFAULT 0,
  ultima_tentativa TIMESTAMPTZ NULL,
  log_erro TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_integracao_pendente_status
  ON integracao_pendente(status);

CREATE INDEX IF NOT EXISTS idx_integracao_pendente_entidade_payload
  ON integracao_pendente(entidade, payload_id);
