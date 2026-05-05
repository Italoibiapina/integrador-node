CREATE OR REPLACE VIEW vw_operacoes_dispatch AS
SELECT
  op.id,
  op.id_venda_externo,
  op.numero_operacao,
  op.identificacao_tipo_operacao,
  op.status,
  op.origem,
  op.data_emissao,
  op.valor_total,
  op.subtotal,
  op.desconto_adicional,
  op.total_descontos,
  op.total_acrescimos,
  op.outras_despesas,
  op.frete,
  op.troco,
  op.valor_pago,
  op.tabela_preco,
  op.vendedor_nome,
  op.observacao,
  op.endereco,
  jsonb_build_object(
    'id', cli.id,
    'idClienteExterno', cli.id_cliente_externo,
    'nome', cli.nome,
    'email', cli.email,
    'cpf', cli.cpf,
    'telefone', cli.telefone,
    'source', cli.source
  ) AS cliente,
  COALESCE(op.parcelas, '[]'::jsonb) AS parcelas,
  COALESCE(op.origem_plataforma, '{}'::jsonb) AS origem_plataforma,
  COALESCE(op.modelo_numero_fiscais, '[]'::jsonb) AS modelo_numero_fiscais,
  COALESCE(itens.operacao_itens, '[]'::jsonb) AS operacao_itens,
  COALESCE(fin.movimentacoes_financeiras, '[]'::jsonb) AS movimentacoes_financeiras,
  op.payload AS payload_origem,
  op.criado_em,
  op.atualizado_em
FROM operacoes op
LEFT JOIN clientes cli
  ON cli.id = op.cliente_id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
           jsonb_build_object(
             'id', x.id_item_externo,
             'cor', x.cor,
             'produto', x.produto,
             'tamanho', x.tamanho,
             'quantidade', x.quantidade,
             'valorUnitario', x.valor_unitario,
             'precoPromocional', x.preco_promocional,
             'valorDescontoItem', x.valor_desconto_item,
             'valorVendaOriginal', x.valor_venda_original,
             'campanhaPromocional', x.campanha_promocional,
             'valorItemComDesconto', x.valor_item_com_desconto,
             'informacoesComplementares', x.informacoes_complementares
           )
           ORDER BY x.id_item_externo
         ) AS operacao_itens
  FROM (
    SELECT DISTINCT ON (oi.id_item_externo)
      oi.id_item_externo,
      oi.cor,
      oi.produto,
      oi.tamanho,
      oi.quantidade,
      oi.valor_unitario,
      oi.preco_promocional,
      oi.valor_desconto_item,
      oi.valor_venda_original,
      oi.campanha_promocional,
      oi.valor_item_com_desconto,
      oi.informacoes_complementares
    FROM operacoes_itens oi
    WHERE oi.operacao_id = op.id
    ORDER BY oi.id_item_externo, oi.data_extracao DESC, oi.id DESC
  ) x
) itens ON TRUE
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
           jsonb_build_object(
             'id', y.id_movimentacao_externo,
             'valor', y.valor,
             'cupomTroca', y.cupom_troca,
             'dataVencimento', y.data_vencimento,
             'descricaoParcelas', y.descricao_parcelas,
             'descricaoFormaPagto', y.descricao_forma_pagto,
             'identificacaoAgrupamento', y.identificacao_agrupamento
           )
           ORDER BY y.id_movimentacao_externo
         ) AS movimentacoes_financeiras
  FROM (
    SELECT DISTINCT ON (ofn.id_movimentacao_externo)
      ofn.id_movimentacao_externo,
      ofn.valor,
      ofn.cupom_troca,
      ofn.data_vencimento,
      ofn.descricao_parcelas,
      ofn.descricao_forma_pagto,
      ofn.identificacao_agrupamento
    FROM operacoes_financeiras ofn
    WHERE ofn.operacao_id = op.id
    ORDER BY ofn.id_movimentacao_externo, ofn.data_extracao DESC, ofn.id DESC
  ) y
) fin ON TRUE;
