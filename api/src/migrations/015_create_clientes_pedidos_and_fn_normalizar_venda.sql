-- Tabelas normalizadas
CREATE TABLE IF NOT EXISTS clientes (
  id BIGSERIAL PRIMARY KEY,
  id_cliente_externo TEXT NULL UNIQUE,
  nome TEXT NULL,
  email TEXT NULL UNIQUE,
  cpf TEXT NULL UNIQUE,
  telefone TEXT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clientes_source
  ON clientes(source);

CREATE TABLE IF NOT EXISTS pedidos (
  id BIGSERIAL PRIMARY KEY,
  id_venda_externo TEXT NOT NULL UNIQUE,
  cliente_id BIGINT NULL REFERENCES clientes(id),
  numero_operacao TEXT NULL,
  status TEXT NULL,
  valor_total NUMERIC(14,2) NULL,
  data_emissao TIMESTAMPTZ NULL,
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_id
  ON pedidos(cliente_id);

-- Ajustes de suporte ao fluxo
ALTER TABLE vendas_raw
  ADD COLUMN IF NOT EXISTS log_erro TEXT NULL;

ALTER TABLE integracao_pendente
  ADD COLUMN IF NOT EXISTS entidade_view TEXT NULL;

UPDATE integracao_pendente
SET entidade_view = entidade
WHERE entidade_view IS NULL;

ALTER TABLE integracao_pendente
  ALTER COLUMN payload_id TYPE BIGINT USING payload_id::bigint;

-- Procedure/Função de normalização
CREATE OR REPLACE FUNCTION fn_normalizar_venda(venda_raw_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_payload JSONB;
  v_itens JSONB;

  v_id_venda_externo TEXT;
  v_id_cliente_externo TEXT;
  v_cliente_nome TEXT;
  v_cliente_email TEXT;
  v_cliente_cpf TEXT;
  v_cliente_telefone TEXT;

  v_status TEXT;
  v_numero_operacao TEXT;
  v_data_emissao_text TEXT;
  v_data_emissao TIMESTAMPTZ;
  v_valor_total NUMERIC(14,2);

  v_cliente_id BIGINT;
  v_pedido_id BIGINT;

  v_destino RECORD;
BEGIN
  -- Passo A: leitura do raw
  SELECT payload
  INTO v_payload
  FROM vendas_raw
  WHERE id = venda_raw_id
  FOR UPDATE;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Registro vendas_raw não encontrado para id=%', venda_raw_id;
  END IF;

  -- Parsing e limpeza
  v_id_venda_externo := NULLIF(TRIM(COALESCE(
    v_payload->>'id',
    v_payload->>'idVenda',
    v_payload->>'id_venda_externo'
  )), '');

  v_id_cliente_externo := NULLIF(TRIM(COALESCE(
    v_payload#>>'{cliente,id}',
    v_payload->>'clienteId',
    v_payload->>'idCliente'
  )), '');

  v_cliente_nome := NULLIF(TRIM(COALESCE(
    v_payload#>>'{cliente,nome}',
    v_payload->>'nomeCliente',
    v_payload#>>'{clienteNome}'
  )), '');

  v_cliente_email := NULLIF(LOWER(TRIM(COALESCE(
    v_payload#>>'{cliente,email}',
    v_payload->>'emailCliente',
    v_payload#>>'{clienteEmail}'
  ))), '');

  v_cliente_cpf := NULLIF(REGEXP_REPLACE(COALESCE(
    v_payload#>>'{cliente,cpf}',
    v_payload->>'cpfCliente',
    v_payload#>>'{clienteCpf}',
    ''
  ), '[^0-9]', '', 'g'), '');

  v_cliente_telefone := NULLIF(TRIM(COALESCE(
    v_payload#>>'{cliente,telefone}',
    v_payload->>'telefoneCliente',
    v_payload#>>'{clienteTelefone}'
  )), '');

  v_status := NULLIF(TRIM(COALESCE(
    v_payload->>'status',
    v_payload->>'situacao'
  )), '');

  v_numero_operacao := NULLIF(TRIM(COALESCE(
    v_payload->>'numeroOperacao',
    v_payload->>'numero_operacao'
  )), '');

  v_data_emissao_text := NULLIF(TRIM(COALESCE(
    v_payload->>'dataEmissao',
    v_payload->>'data_emissao'
  )), '');

  IF v_data_emissao_text IS NOT NULL THEN
    BEGIN
      v_data_emissao := v_data_emissao_text::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_data_emissao := NULL;
    END;
  END IF;

  BEGIN
    v_valor_total := NULLIF(TRIM(COALESCE(
      v_payload->>'valorTotal',
      v_payload->>'valor_total',
      v_payload->>'valor'
    )), '')::numeric(14,2);
  EXCEPTION WHEN OTHERS THEN
    v_valor_total := NULL;
  END;

  v_itens := COALESCE(
    v_payload->'itens',
    v_payload->'items',
    v_payload->'itensPedido',
    '[]'::jsonb
  );

  IF v_id_venda_externo IS NULL THEN
    RAISE EXCEPTION 'Payload sem id da venda (id/idVenda/id_venda_externo). venda_raw_id=%', venda_raw_id;
  END IF;

  -- Normalização de Clientes
  IF v_cliente_cpf IS NOT NULL THEN
    INSERT INTO clientes (id_cliente_externo, nome, email, cpf, telefone, source, atualizado_em)
    VALUES (v_id_cliente_externo, v_cliente_nome, v_cliente_email, v_cliente_cpf, v_cliente_telefone, 'pedido_venda', now())
    ON CONFLICT (cpf)
    DO UPDATE SET
      id_cliente_externo = COALESCE(EXCLUDED.id_cliente_externo, clientes.id_cliente_externo),
      nome = COALESCE(EXCLUDED.nome, clientes.nome),
      email = COALESCE(EXCLUDED.email, clientes.email),
      telefone = COALESCE(EXCLUDED.telefone, clientes.telefone),
      source = 'pedido_venda',
      atualizado_em = now()
    RETURNING id INTO v_cliente_id;
  ELSIF v_cliente_email IS NOT NULL THEN
    INSERT INTO clientes (id_cliente_externo, nome, email, cpf, telefone, source, atualizado_em)
    VALUES (v_id_cliente_externo, v_cliente_nome, v_cliente_email, v_cliente_cpf, v_cliente_telefone, 'pedido_venda', now())
    ON CONFLICT (email)
    DO UPDATE SET
      id_cliente_externo = COALESCE(EXCLUDED.id_cliente_externo, clientes.id_cliente_externo),
      nome = COALESCE(EXCLUDED.nome, clientes.nome),
      cpf = COALESCE(EXCLUDED.cpf, clientes.cpf),
      telefone = COALESCE(EXCLUDED.telefone, clientes.telefone),
      source = 'pedido_venda',
      atualizado_em = now()
    RETURNING id INTO v_cliente_id;
  ELSIF v_id_cliente_externo IS NOT NULL THEN
    INSERT INTO clientes (id_cliente_externo, nome, email, cpf, telefone, source, atualizado_em)
    VALUES (v_id_cliente_externo, v_cliente_nome, v_cliente_email, v_cliente_cpf, v_cliente_telefone, 'pedido_venda', now())
    ON CONFLICT (id_cliente_externo)
    DO UPDATE SET
      nome = COALESCE(EXCLUDED.nome, clientes.nome),
      email = COALESCE(EXCLUDED.email, clientes.email),
      cpf = COALESCE(EXCLUDED.cpf, clientes.cpf),
      telefone = COALESCE(EXCLUDED.telefone, clientes.telefone),
      source = 'pedido_venda',
      atualizado_em = now()
    RETURNING id INTO v_cliente_id;
  ELSE
    v_cliente_id := NULL;
  END IF;

  -- Passo B: Persistência de pedido (upsert)
  INSERT INTO pedidos (
    id_venda_externo,
    cliente_id,
    numero_operacao,
    status,
    valor_total,
    data_emissao,
    itens,
    payload,
    atualizado_em
  )
  VALUES (
    v_id_venda_externo,
    v_cliente_id,
    v_numero_operacao,
    v_status,
    v_valor_total,
    v_data_emissao,
    COALESCE(v_itens, '[]'::jsonb),
    v_payload,
    now()
  )
  ON CONFLICT (id_venda_externo)
  DO UPDATE SET
    cliente_id = COALESCE(EXCLUDED.cliente_id, pedidos.cliente_id),
    numero_operacao = COALESCE(EXCLUDED.numero_operacao, pedidos.numero_operacao),
    status = COALESCE(EXCLUDED.status, pedidos.status),
    valor_total = COALESCE(EXCLUDED.valor_total, pedidos.valor_total),
    data_emissao = COALESCE(EXCLUDED.data_emissao, pedidos.data_emissao),
    itens = EXCLUDED.itens,
    payload = EXCLUDED.payload,
    atualizado_em = now()
  RETURNING id INTO v_pedido_id;

  -- Passo C: Outbox para todos destinos ativos de 'pedidos'
  FOR v_destino IN
    SELECT nome, endpoint_url, metodo, entidade_view
    FROM sistema_destino_config
    WHERE tabela_origem = 'pedidos'
      AND ativo = true
  LOOP
    INSERT INTO integracao_pendente (
      sistema_nome,
      endpoint_url,
      metodo,
      entidade,
      entidade_view,
      payload_id,
      status,
      tentativas
    )
    VALUES (
      v_destino.nome,
      v_destino.endpoint_url,
      COALESCE(v_destino.metodo, 'POST'),
      COALESCE(v_destino.entidade_view, 'pedidos'),
      COALESCE(v_destino.entidade_view, 'pedidos'),
      v_pedido_id,
      'pendente',
      0
    );
  END LOOP;

  -- Passo D: finalização com sucesso
  UPDATE vendas_raw
  SET status_processamento = 'processado',
      log_erro = NULL
  WHERE id = venda_raw_id;
EXCEPTION
  WHEN OTHERS THEN
    UPDATE vendas_raw
    SET status_processamento = 'erro',
        log_erro = LEFT(SQLERRM, 2000)
    WHERE id = venda_raw_id;
END;
$$;
