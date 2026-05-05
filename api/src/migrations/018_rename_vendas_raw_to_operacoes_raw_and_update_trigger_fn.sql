-- 1) Renomeia tabela raw
DO $$
BEGIN
  IF to_regclass('public.operacoes_raw') IS NULL AND to_regclass('public.vendas_raw') IS NOT NULL THEN
    ALTER TABLE vendas_raw RENAME TO operacoes_raw;
  END IF;
END $$;

-- 2) Função de normalização com novo nome e tabela raw atualizada
CREATE OR REPLACE FUNCTION fn_normalizar_operacoes(venda_raw_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_payload JSONB;

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
BEGIN
  SELECT payload
  INTO v_payload
  FROM operacoes_raw
  WHERE id = venda_raw_id
  FOR UPDATE;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Registro operacoes_raw não encontrado para id=%', venda_raw_id;
  END IF;

  v_id_venda_externo := NULLIF(TRIM(COALESCE(v_payload->>'id', v_payload->>'idVenda', v_payload->>'id_venda_externo')), '');
  IF v_id_venda_externo IS NULL THEN
    RAISE EXCEPTION 'Payload sem id da venda (id/idVenda/id_venda_externo). venda_raw_id=%', venda_raw_id;
  END IF;

  v_id_cliente_externo := NULLIF(TRIM(COALESCE(v_payload#>>'{clienteObj,id}', v_payload#>>'{cliente,id}', v_payload->>'clienteId', v_payload->>'idCliente')), '');
  v_cliente_nome := NULLIF(TRIM(COALESCE(v_payload->>'cliente', v_payload#>>'{cliente,nome}', v_payload->>'nomeCliente', v_payload#>>'{clienteNome}')), '');
  v_cliente_email := NULLIF(LOWER(TRIM(COALESCE(v_payload->>'email', v_payload#>>'{cliente,email}', v_payload->>'emailCliente', v_payload#>>'{clienteEmail}'))), '');
  v_cliente_cpf := NULLIF(REGEXP_REPLACE(COALESCE(v_payload#>>'{cliente,cpf}', v_payload->>'cpfCliente', v_payload#>>'{clienteCpf}', ''), '[^0-9]', '', 'g'), '');
  v_cliente_telefone := NULLIF(TRIM(COALESCE(v_payload->>'telefone', v_payload#>>'{cliente,telefone}', v_payload->>'telefoneCliente', v_payload#>>'{clienteTelefone}')), '');

  v_caixa := NULLIF(TRIM(v_payload->>'caixa'), '');
  v_origem := NULLIF(TRIM(v_payload->>'origem'), '');
  v_cliente := NULLIF(TRIM(v_payload->>'cliente'), '');
  v_endereco := NULLIF(TRIM(v_payload->>'endereco'), '');
  v_observacao := NULLIF(TRIM(v_payload->>'observacao'), '');
  v_tabela_preco := NULLIF(TRIM(v_payload->>'tabelaPreco'), '');
  v_vendedor_nome := NULLIF(TRIM(v_payload->>'vendedorNome'), '');
  v_motivo_cancelamento := NULLIF(TRIM(v_payload->>'motivoCancelamento'), '');

  BEGIN v_status := NULLIF(TRIM(v_payload->>'status'), '')::integer; EXCEPTION WHEN OTHERS THEN v_status := NULL; END;
  BEGIN v_numero_operacao := NULLIF(TRIM(v_payload->>'numeroOperacao'), '')::bigint; EXCEPTION WHEN OTHERS THEN v_numero_operacao := NULL; END;
  BEGIN v_quantidade := NULLIF(TRIM(v_payload->>'quantidade'), '')::integer; EXCEPTION WHEN OTHERS THEN v_quantidade := NULL; END;
  BEGIN v_identificacao_tipo_operacao := NULLIF(TRIM(v_payload->>'identificacaoTipoOperacao'), '')::integer; EXCEPTION WHEN OTHERS THEN v_identificacao_tipo_operacao := NULL; END;
  BEGIN v_data_emissao := NULLIF(TRIM(v_payload->>'dataEmissao'), '')::timestamptz; EXCEPTION WHEN OTHERS THEN v_data_emissao := NULL; END;

  BEGIN v_frete := NULLIF(TRIM(v_payload->>'frete'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_frete := NULL; END;
  BEGIN v_troco := NULLIF(TRIM(v_payload->>'troco'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_troco := NULL; END;
  BEGIN v_subtotal := NULLIF(TRIM(v_payload->>'subtotal'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_subtotal := NULL; END;
  BEGIN v_valor_pago := NULLIF(TRIM(v_payload->>'valorPago'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_valor_pago := NULL; END;
  BEGIN v_acrescimos := NULLIF(TRIM(v_payload->>'acrescimos'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_acrescimos := NULL; END;
  BEGIN v_valor_total := NULLIF(TRIM(v_payload->>'valorTotal'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_valor_total := NULL; END;
  BEGIN v_desconto_itens := NULLIF(TRIM(v_payload->>'descontoItens'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_desconto_itens := NULL; END;
  BEGIN v_outras_despesas := NULLIF(TRIM(v_payload->>'outrasDespesas'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_outras_despesas := NULL; END;
  BEGIN v_total_descontos := NULLIF(TRIM(v_payload->>'totalDescontos'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_total_descontos := NULL; END;
  BEGIN v_total_acrescimos := NULLIF(TRIM(v_payload->>'totalAcrescimos'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_total_acrescimos := NULL; END;
  BEGIN v_desconto_adicional := NULLIF(TRIM(v_payload->>'descontoAdicional'), '')::numeric(14,2); EXCEPTION WHEN OTHERS THEN v_desconto_adicional := NULL; END;

  v_parcelas := COALESCE(v_payload->'parcelas', '[]'::jsonb);
  v_operacao_itens := COALESCE(v_payload->'operacaoItens', '[]'::jsonb);
  v_origem_plataforma := COALESCE(v_payload->'origemPlataforma', '{}'::jsonb);
  v_modelo_numero_fiscais := COALESCE(v_payload->'modeloNumeroFiscais', '[]'::jsonb);
  v_movimentacoes_financeiras := COALESCE(v_payload->'movimentacoesFinanceiras', '[]'::jsonb);

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
    id_venda_externo,
    cliente_id,
    caixa,
    email,
    frete,
    troco,
    origem,
    status,
    cliente,
    endereco,
    parcelas,
    subtotal,
    telefone,
    valor_pago,
    acrescimos,
    observacao,
    quantidade,
    valor_total,
    data_emissao,
    tabela_preco,
    vendedor_nome,
    desconto_itens,
    operacao_itens,
    numero_operacao,
    outras_despesas,
    total_descontos,
    total_acrescimos,
    origem_plataforma,
    desconto_adicional,
    motivo_cancelamento,
    modelo_numero_fiscais,
    movimentacoes_financeiras,
    identificacao_tipo_operacao,
    payload,
    atualizado_em
  )
  VALUES (
    v_id_venda_externo,
    v_cliente_id,
    v_caixa,
    v_cliente_email,
    v_frete,
    v_troco,
    v_origem,
    v_status,
    v_cliente,
    v_endereco,
    v_parcelas,
    v_subtotal,
    v_cliente_telefone,
    v_valor_pago,
    v_acrescimos,
    v_observacao,
    v_quantidade,
    v_valor_total,
    v_data_emissao,
    v_tabela_preco,
    v_vendedor_nome,
    v_desconto_itens,
    v_operacao_itens,
    v_numero_operacao,
    v_outras_despesas,
    v_total_descontos,
    v_total_acrescimos,
    v_origem_plataforma,
    v_desconto_adicional,
    v_motivo_cancelamento,
    v_modelo_numero_fiscais,
    v_movimentacoes_financeiras,
    v_identificacao_tipo_operacao,
    v_payload,
    now()
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

  FOR v_destino IN
    SELECT nome, endpoint_url, metodo, entidade_view
    FROM sistema_destino_config
    WHERE tabela_origem = 'operacoes'
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
      COALESCE(v_destino.entidade_view, 'operacoes'),
      COALESCE(v_destino.entidade_view, 'operacoes'),
      v_operacao_id,
      'pendente',
      0
    );
  END LOOP;

  UPDATE operacoes_raw
  SET status_processamento = 'processado',
      log_erro = NULL
  WHERE id = venda_raw_id;
EXCEPTION
  WHEN OTHERS THEN
    UPDATE operacoes_raw
    SET status_processamento = 'erro',
        log_erro = LEFT(SQLERRM, 2000)
    WHERE id = venda_raw_id;
END;
$$;

-- 3) Trigger e função de trigger no novo nome/tabela
DROP TRIGGER IF EXISTS trg_vendas_raw_normalizacao ON vendas_raw;
DROP TRIGGER IF EXISTS trg_vendas_raw_normalizacao_operacoes ON vendas_raw;
DROP TRIGGER IF EXISTS trg_vendas_raw_normalizacao ON operacoes_raw;
DROP TRIGGER IF EXISTS trg_vendas_raw_normalizacao_operacoes ON operacoes_raw;
DROP TRIGGER IF EXISTS trg_operacoes_raw_normalizacao_operacoes ON operacoes_raw;

CREATE OR REPLACE FUNCTION trg_operacoes_raw_chamar_normalizacao_operacoes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status_processamento = 'pendente' THEN
    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'fn_normalizar_operacoes'
        AND n.nspname = 'public'
    ) THEN
      EXECUTE 'SELECT fn_normalizar_operacoes($1)' USING NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_operacoes_raw_normalizacao_operacoes
AFTER INSERT OR UPDATE ON operacoes_raw
FOR EACH ROW
WHEN (NEW.status_processamento = 'pendente')
EXECUTE FUNCTION trg_operacoes_raw_chamar_normalizacao_operacoes();
