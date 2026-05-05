-- 1) Tabela de movimentações financeiras da operação (histórico por hash)
CREATE TABLE IF NOT EXISTS operacoes_financeiras (
  id BIGSERIAL PRIMARY KEY,
  operacao_id BIGINT NOT NULL REFERENCES operacoes(id) ON DELETE CASCADE,
  id_venda_externo TEXT NOT NULL,
  id_movimentacao_externo TEXT NOT NULL,
  valor NUMERIC(14,2) NULL,
  cupom_troca BOOLEAN NULL,
  data_vencimento TIMESTAMPTZ NULL,
  descricao_parcelas TEXT NULL,
  descricao_forma_pagto TEXT NULL,
  identificacao_agrupamento TEXT NULL,
  payload JSONB NOT NULL,
  hash_payload TEXT NOT NULL,
  data_extracao TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operacoes_financeiras_operacao_id
  ON operacoes_financeiras(operacao_id);

CREATE INDEX IF NOT EXISTS idx_operacoes_financeiras_id_venda_externo
  ON operacoes_financeiras(id_venda_externo);

CREATE INDEX IF NOT EXISTS idx_operacoes_financeiras_id_mov_externo
  ON operacoes_financeiras(id_movimentacao_externo);

CREATE INDEX IF NOT EXISTS idx_operacoes_financeiras_data_extracao
  ON operacoes_financeiras(data_extracao DESC, id DESC);

-- 2) Procedure de normalização incluindo carga de operacoes_financeiras com deduplicação por hash
CREATE OR REPLACE FUNCTION fn_normalizar_operacoes(venda_raw_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_payload JSONB;
  v_payload_base JSONB;

  v_id_venda_externo TEXT;
  v_id_cliente_externo TEXT;
  v_cliente_nome TEXT;
  v_cliente_email TEXT;
  v_cliente_cpf TEXT;
  v_cliente_telefone TEXT;

  v_caixa TEXT;
  v_origem TEXT;
  v_status INTEGER;
  v_cliente TEXT;
  v_endereco TEXT;
  v_observacao TEXT;
  v_tabela_preco TEXT;
  v_vendedor_nome TEXT;
  v_motivo_cancelamento TEXT;

  v_frete NUMERIC(14,2);
  v_troco NUMERIC(14,2);
  v_subtotal NUMERIC(14,2);
  v_valor_pago NUMERIC(14,2);
  v_acrescimos NUMERIC(14,2);
  v_valor_total NUMERIC(14,2);
  v_desconto_itens NUMERIC(14,2);
  v_outras_despesas NUMERIC(14,2);
  v_total_descontos NUMERIC(14,2);
  v_total_acrescimos NUMERIC(14,2);
  v_desconto_adicional NUMERIC(14,2);

  v_quantidade INTEGER;
  v_numero_operacao BIGINT;
  v_identificacao_tipo_operacao INTEGER;
  v_data_emissao TIMESTAMPTZ;

  v_parcelas JSONB;
  v_operacao_itens JSONB;
  v_origem_plataforma JSONB;
  v_modelo_numero_fiscais JSONB;
  v_movimentacoes_financeiras JSONB;

  v_cliente_id BIGINT;
  v_operacao_id BIGINT;
  v_destino RECORD;

  v_item JSONB;
  v_item_id_externo TEXT;
  v_item_cor TEXT;
  v_item_produto TEXT;
  v_item_tamanho TEXT;
  v_item_quantidade NUMERIC(14,4);
  v_item_valor_unitario NUMERIC(14,2);
  v_item_preco_promocional BOOLEAN;
  v_item_valor_desconto NUMERIC(14,2);
  v_item_valor_original NUMERIC(14,2);
  v_item_campanha JSONB;
  v_item_valor_com_desconto NUMERIC(14,2);
  v_item_info_complementares TEXT;
  v_item_hash TEXT;

  v_fin JSONB;
  v_fin_id_externo TEXT;
  v_fin_valor NUMERIC(14,2);
  v_fin_cupom_troca BOOLEAN;
  v_fin_data_vencimento TIMESTAMPTZ;
  v_fin_desc_parcelas TEXT;
  v_fin_desc_forma_pagto TEXT;
  v_fin_identificacao_agrupamento TEXT;
  v_fin_hash TEXT;
BEGIN
  SELECT payload
  INTO v_payload
  FROM operacoes_raw
  WHERE id = venda_raw_id
  FOR UPDATE;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Registro operacoes_raw não encontrado para id=%', venda_raw_id;
  END IF;

  v_payload_base := CASE
    WHEN jsonb_typeof(v_payload->'dados') = 'object' THEN v_payload->'dados'
    ELSE v_payload
  END;

  v_id_venda_externo := NULLIF(TRIM(COALESCE(v_payload_base->>'id', v_payload_base->>'idVenda', v_payload_base->>'id_venda_externo')), '');
  IF v_id_venda_externo IS NULL THEN
    RAISE EXCEPTION 'Payload sem id da venda (id/idVenda/id_venda_externo). venda_raw_id=%', venda_raw_id;
  END IF;

  v_id_cliente_externo := NULLIF(TRIM(COALESCE(v_payload_base#>>'{clienteObj,id}', v_payload_base#>>'{cliente,id}', v_payload_base->>'clienteId', v_payload_base->>'idCliente')), '');
  v_cliente_nome := NULLIF(TRIM(COALESCE(v_payload_base->>'cliente', v_payload_base#>>'{cliente,nome}', v_payload_base->>'nomeCliente', v_payload_base#>>'{clienteNome}')), '');
  v_cliente_email := NULLIF(LOWER(TRIM(COALESCE(v_payload_base->>'email', v_payload_base#>>'{cliente,email}', v_payload_base->>'emailCliente', v_payload_base#>>'{clienteEmail}'))), '');
  v_cliente_cpf := NULLIF(REGEXP_REPLACE(COALESCE(v_payload_base#>>'{cliente,cpf}', v_payload_base->>'cpfCliente', v_payload_base#>>'{clienteCpf}', ''), '[^0-9]', '', 'g'), '');
  v_cliente_telefone := NULLIF(TRIM(COALESCE(v_payload_base->>'telefone', v_payload_base#>>'{cliente,telefone}', v_payload_base->>'telefoneCliente', v_payload_base#>>'{clienteTelefone}')), '');

  v_caixa := NULLIF(TRIM(v_payload_base->>'caixa'), '');
  v_origem := NULLIF(TRIM(v_payload_base->>'origem'), '');
  v_cliente := NULLIF(TRIM(v_payload_base->>'cliente'), '');
  v_endereco := NULLIF(TRIM(v_payload_base->>'endereco'), '');
  v_observacao := NULLIF(TRIM(v_payload_base->>'observacao'), '');
  v_tabela_preco := NULLIF(TRIM(v_payload_base->>'tabelaPreco'), '');
  v_vendedor_nome := NULLIF(TRIM(v_payload_base->>'vendedorNome'), '');
  v_motivo_cancelamento := NULLIF(TRIM(v_payload_base->>'motivoCancelamento'), '');

  BEGIN v_status := NULLIF(TRIM(v_payload_base->>'status'), '')::integer; EXCEPTION WHEN OTHERS THEN v_status := NULL; END;
  BEGIN v_numero_operacao := NULLIF(TRIM(v_payload_base->>'numeroOperacao'), '')::bigint; EXCEPTION WHEN OTHERS THEN v_numero_operacao := NULL; END;
  BEGIN v_quantidade := NULLIF(TRIM(v_payload_base->>'quantidade'), '')::integer; EXCEPTION WHEN OTHERS THEN v_quantidade := NULL; END;
  BEGIN v_identificacao_tipo_operacao := NULLIF(TRIM(v_payload_base->>'identificacaoTipoOperacao'), '')::integer; EXCEPTION WHEN OTHERS THEN v_identificacao_tipo_operacao := NULL; END;
  BEGIN v_data_emissao := NULLIF(TRIM(v_payload_base->>'dataEmissao'), '')::timestamptz; EXCEPTION WHEN OTHERS THEN v_data_emissao := NULL; END;

  BEGIN v_frete := NULLIF(TRIM(v_payload_base->>'frete'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_frete := NULL; END;
  BEGIN v_troco := NULLIF(TRIM(v_payload_base->>'troco'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_troco := NULL; END;
  BEGIN v_subtotal := NULLIF(TRIM(v_payload_base->>'subtotal'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_subtotal := NULL; END;
  BEGIN v_valor_pago := NULLIF(TRIM(v_payload_base->>'valorPago'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_valor_pago := NULL; END;
  BEGIN v_acrescimos := NULLIF(TRIM(v_payload_base->>'acrescimos'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_acrescimos := NULL; END;
  BEGIN v_valor_total := NULLIF(TRIM(v_payload_base->>'valorTotal'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_valor_total := NULL; END;
  BEGIN v_desconto_itens := NULLIF(TRIM(v_payload_base->>'descontoItens'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_desconto_itens := NULL; END;
  BEGIN v_outras_despesas := NULLIF(TRIM(v_payload_base->>'outrasDespesas'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_outras_despesas := NULL; END;
  BEGIN v_total_descontos := NULLIF(TRIM(v_payload_base->>'totalDescontos'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_total_descontos := NULL; END;
  BEGIN v_total_acrescimos := NULLIF(TRIM(v_payload_base->>'totalAcrescimos'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_total_acrescimos := NULL; END;
  BEGIN v_desconto_adicional := NULLIF(TRIM(v_payload_base->>'descontoAdicional'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_desconto_adicional := NULL; END;

  v_parcelas := COALESCE(v_payload_base->'parcelas', '[]'::jsonb);
  v_operacao_itens := COALESCE(v_payload_base->'operacaoItens', '[]'::jsonb);
  v_origem_plataforma := COALESCE(v_payload_base->'origemPlataforma', '{}'::jsonb);
  v_modelo_numero_fiscais := COALESCE(v_payload_base->'modeloNumeroFiscais', '[]'::jsonb);
  v_movimentacoes_financeiras := COALESCE(v_payload_base->'movimentacoesFinanceiras', '[]'::jsonb);

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
  ELSIF v_cliente_nome IS NOT NULL THEN
    INSERT INTO clientes (id_cliente_externo, nome, email, cpf, telefone, source, atualizado_em)
    VALUES (NULL, v_cliente_nome, v_cliente_email, v_cliente_cpf, v_cliente_telefone, 'pedido_venda', now())
    RETURNING id INTO v_cliente_id;
  ELSE
    v_cliente_id := NULL;
  END IF;

  INSERT INTO operacoes (
    id_venda_externo, cliente_id, caixa, email, frete, troco, origem, status, cliente, endereco, parcelas,
    subtotal, telefone, valor_pago, acrescimos, observacao, quantidade, valor_total, data_emissao, tabela_preco,
    vendedor_nome, desconto_itens, operacao_itens, numero_operacao, outras_despesas, total_descontos,
    total_acrescimos, origem_plataforma, desconto_adicional, motivo_cancelamento, modelo_numero_fiscais,
    movimentacoes_financeiras, identificacao_tipo_operacao, payload, atualizado_em
  )
  VALUES (
    v_id_venda_externo, v_cliente_id, v_caixa, v_cliente_email, v_frete, v_troco, v_origem, v_status, v_cliente, v_endereco, v_parcelas,
    v_subtotal, v_cliente_telefone, v_valor_pago, v_acrescimos, v_observacao, v_quantidade, v_valor_total, v_data_emissao, v_tabela_preco,
    v_vendedor_nome, v_desconto_itens, v_operacao_itens, v_numero_operacao, v_outras_despesas, v_total_descontos,
    v_total_acrescimos, v_origem_plataforma, v_desconto_adicional, v_motivo_cancelamento, v_modelo_numero_fiscais,
    v_movimentacoes_financeiras, v_identificacao_tipo_operacao, v_payload_base, now()
  )
  ON CONFLICT (id_venda_externo)
  DO UPDATE SET
    cliente_id = COALESCE(EXCLUDED.cliente_id, operacoes.cliente_id),
    caixa = COALESCE(EXCLUDED.caixa, operacoes.caixa),
    email = COALESCE(EXCLUDED.email, operacoes.email),
    frete = COALESCE(EXCLUDED.frete, operacoes.frete),
    troco = COALESCE(EXCLUDED.troco, operacoes.troco),
    origem = COALESCE(EXCLUDED.origem, operacoes.origem),
    status = COALESCE(EXCLUDED.status, operacoes.status),
    cliente = COALESCE(EXCLUDED.cliente, operacoes.cliente),
    endereco = COALESCE(EXCLUDED.endereco, operacoes.endereco),
    parcelas = COALESCE(EXCLUDED.parcelas, operacoes.parcelas),
    subtotal = COALESCE(EXCLUDED.subtotal, operacoes.subtotal),
    telefone = COALESCE(EXCLUDED.telefone, operacoes.telefone),
    valor_pago = COALESCE(EXCLUDED.valor_pago, operacoes.valor_pago),
    acrescimos = COALESCE(EXCLUDED.acrescimos, operacoes.acrescimos),
    observacao = COALESCE(EXCLUDED.observacao, operacoes.observacao),
    quantidade = COALESCE(EXCLUDED.quantidade, operacoes.quantidade),
    valor_total = COALESCE(EXCLUDED.valor_total, operacoes.valor_total),
    data_emissao = COALESCE(EXCLUDED.data_emissao, operacoes.data_emissao),
    tabela_preco = COALESCE(EXCLUDED.tabela_preco, operacoes.tabela_preco),
    vendedor_nome = COALESCE(EXCLUDED.vendedor_nome, operacoes.vendedor_nome),
    desconto_itens = COALESCE(EXCLUDED.desconto_itens, operacoes.desconto_itens),
    operacao_itens = COALESCE(EXCLUDED.operacao_itens, operacoes.operacao_itens),
    numero_operacao = COALESCE(EXCLUDED.numero_operacao, operacoes.numero_operacao),
    outras_despesas = COALESCE(EXCLUDED.outras_despesas, operacoes.outras_despesas),
    total_descontos = COALESCE(EXCLUDED.total_descontos, operacoes.total_descontos),
    total_acrescimos = COALESCE(EXCLUDED.total_acrescimos, operacoes.total_acrescimos),
    origem_plataforma = COALESCE(EXCLUDED.origem_plataforma, operacoes.origem_plataforma),
    desconto_adicional = COALESCE(EXCLUDED.desconto_adicional, operacoes.desconto_adicional),
    motivo_cancelamento = COALESCE(EXCLUDED.motivo_cancelamento, operacoes.motivo_cancelamento),
    modelo_numero_fiscais = COALESCE(EXCLUDED.modelo_numero_fiscais, operacoes.modelo_numero_fiscais),
    movimentacoes_financeiras = COALESCE(EXCLUDED.movimentacoes_financeiras, operacoes.movimentacoes_financeiras),
    identificacao_tipo_operacao = COALESCE(EXCLUDED.identificacao_tipo_operacao, operacoes.identificacao_tipo_operacao),
    payload = EXCLUDED.payload,
    atualizado_em = now()
  RETURNING id INTO v_operacao_id;

  -- Itens (mantido)
  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_operacao_itens, '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      CONTINUE;
    END IF;

    v_item_id_externo := NULLIF(TRIM(COALESCE(v_item->>'id', v_item->>'itemId')), '');
    IF v_item_id_externo IS NULL THEN
      CONTINUE;
    END IF;

    v_item_hash := md5(v_item::text);

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT hash_payload
        FROM operacoes_itens
        WHERE id_item_externo = v_item_id_externo
        ORDER BY data_extracao DESC, id DESC
        LIMIT 1
      ) ult
      WHERE ult.hash_payload = v_item_hash
    ) THEN
      CONTINUE;
    END IF;

    v_item_cor := NULLIF(TRIM(v_item->>'cor'), '');
    v_item_produto := NULLIF(TRIM(v_item->>'produto'), '');
    v_item_tamanho := NULLIF(TRIM(v_item->>'tamanho'), '');
    v_item_info_complementares := NULLIF(TRIM(v_item->>'informacoesComplementares'), '');
    v_item_campanha := v_item->'campanhaPromocional';
    BEGIN v_item_quantidade := NULLIF(TRIM(v_item->>'quantidade'), '')::numeric(14,4); EXCEPTION WHEN OTHERS THEN v_item_quantidade := NULL; END;
    BEGIN v_item_valor_unitario := NULLIF(TRIM(v_item->>'valorUnitario'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_item_valor_unitario := NULL; END;
    BEGIN v_item_preco_promocional := NULLIF(TRIM(v_item->>'precoPromocional'), '')::boolean; EXCEPTION WHEN OTHERS THEN v_item_preco_promocional := NULL; END;
    BEGIN v_item_valor_desconto := NULLIF(TRIM(v_item->>'valorDescontoItem'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_item_valor_desconto := NULL; END;
    BEGIN v_item_valor_original := NULLIF(TRIM(v_item->>'valorVendaOriginal'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_item_valor_original := NULL; END;
    BEGIN v_item_valor_com_desconto := NULLIF(TRIM(v_item->>'valorItemComDesconto'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_item_valor_com_desconto := NULL; END;

    INSERT INTO operacoes_itens (
      operacao_id, id_venda_externo, id_item_externo, cor, produto, tamanho, quantidade, valor_unitario,
      preco_promocional, valor_desconto_item, valor_venda_original, campanha_promocional, valor_item_com_desconto,
      informacoes_complementares, payload, hash_payload
    )
    VALUES (
      v_operacao_id, v_id_venda_externo, v_item_id_externo, v_item_cor, v_item_produto, v_item_tamanho, v_item_quantidade, v_item_valor_unitario,
      v_item_preco_promocional, v_item_valor_desconto, v_item_valor_original, v_item_campanha, v_item_valor_com_desconto,
      v_item_info_complementares, v_item, v_item_hash
    );
  END LOOP;

  -- Movimentações financeiras (novo)
  FOR v_fin IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_movimentacoes_financeiras, '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_fin) <> 'object' THEN
      CONTINUE;
    END IF;

    v_fin_identificacao_agrupamento := NULLIF(TRIM(v_fin->>'identificacaoAgrupamento'), '');
    v_fin_desc_forma_pagto := NULLIF(TRIM(v_fin->>'descricaoFormaPagto'), '');
    BEGIN v_fin_data_vencimento := NULLIF(TRIM(v_fin->>'dataVencimento'), '')::timestamptz; EXCEPTION WHEN OTHERS THEN v_fin_data_vencimento := NULL; END;
    BEGIN v_fin_valor := NULLIF(TRIM(v_fin->>'valor'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_fin_valor := NULL; END;

    v_fin_id_externo := COALESCE(
      v_fin_identificacao_agrupamento,
      NULLIF(TRIM(v_fin->>'id'), ''),
      md5(COALESCE(v_fin_desc_forma_pagto, '') || '|' || COALESCE(v_fin_data_vencimento::text, '') || '|' || COALESCE(v_fin_valor::text, ''))
    );

    IF v_fin_id_externo IS NULL THEN
      CONTINUE;
    END IF;

    v_fin_hash := md5(v_fin::text);

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT hash_payload
        FROM operacoes_financeiras
        WHERE id_movimentacao_externo = v_fin_id_externo
        ORDER BY data_extracao DESC, id DESC
        LIMIT 1
      ) ult
      WHERE ult.hash_payload = v_fin_hash
    ) THEN
      CONTINUE;
    END IF;

    BEGIN v_fin_cupom_troca := NULLIF(TRIM(v_fin->>'cupomTroca'), '')::boolean; EXCEPTION WHEN OTHERS THEN v_fin_cupom_troca := NULL; END;
    v_fin_desc_parcelas := NULLIF(TRIM(v_fin->>'descricaoParcelas'), '');

    INSERT INTO operacoes_financeiras (
      operacao_id,
      id_venda_externo,
      id_movimentacao_externo,
      valor,
      cupom_troca,
      data_vencimento,
      descricao_parcelas,
      descricao_forma_pagto,
      identificacao_agrupamento,
      payload,
      hash_payload
    )
    VALUES (
      v_operacao_id,
      v_id_venda_externo,
      v_fin_id_externo,
      v_fin_valor,
      v_fin_cupom_troca,
      v_fin_data_vencimento,
      v_fin_desc_parcelas,
      v_fin_desc_forma_pagto,
      v_fin_identificacao_agrupamento,
      v_fin,
      v_fin_hash
    );
  END LOOP;

  FOR v_destino IN
    SELECT nome, endpoint_url, metodo, entidade_view
    FROM sistema_destino_config
    WHERE tabela_origem = 'operacoes'
      AND ativo = true
  LOOP
    INSERT INTO integracao_pendente (sistema_nome, endpoint_url, metodo, entidade, entidade_view, payload_id, status, tentativas)
    VALUES (
      v_destino.nome,
      v_destino.endpoint_url,
      COALESCE(v_destino.metodo, 'POST'),
      COALESCE(v_destino.entidade_view, 'operacoes'),
      COALESCE(v_destino.entidade_view, 'operacoes'),
      v_operacao_id,
      'pendente',
      0
    );
  END LOOP;

  UPDATE operacoes_raw
  SET status_processamento = 'processado', log_erro = NULL
  WHERE id = venda_raw_id;
EXCEPTION
  WHEN OTHERS THEN
    UPDATE operacoes_raw
    SET status_processamento = 'erro',
        log_erro = LEFT(SQLERRM, 2000)
    WHERE id = venda_raw_id;
END;
$$;
