# 03-Lista de Requisitos Funcionais

## Integração (Pedidos)
- RF-001: O sistema deve permitir cadastrar uma integração do tipo “Pedidos Vendas → Encomendas”.
- RF-002: O sistema deve executar o Passo 1 para buscar pedidos no Sistema de Vendas por API quando configurado.
- RF-003: O sistema deve executar o Passo 1 para buscar pedidos no Sistema de Vendas por web scraping quando configurado.
- RF-004: O sistema deve persistir no banco do Integrador os pedidos capturados (cabeçalho + itens + status por item).
- RF-005: O sistema deve executar o Passo 2 para enviar pedidos persistidos para o Sistema de Controle de Encomendas via API.
- RF-006: O sistema deve registrar o resultado do envio por pedido (sucesso/erro, payload, resposta, código HTTP quando aplicável).
- RF-007: O sistema deve suportar reprocessamento (retry) do Passo 2 para pedidos com falha, preservando histórico.
- RF-008: O sistema deve garantir idempotência no envio (não criar duplicados no destino quando o mesmo pedido for reenviado).

## Orquestração e Notificadores
- RF-009: O sistema deve permitir configurar “notificadores” associados ao término de um job (ex.: ao finalizar Passo 1, disparar Passo 2).
- RF-010: O sistema deve permitir múltiplos notificadores por job (ex.: Passo 1 pode disparar Passo 2 e um job de auditoria no futuro).
- RF-011: O sistema deve registrar quais notificadores foram disparados em cada execução e seus resultados.

## Agendamento e Execução Manual
- RF-012: O sistema deve permitir configurar agendamentos para jobs (cron/intervalo) por integração.
- RF-013: O sistema deve permitir habilitar/desabilitar um agendamento sem perder sua configuração.
- RF-014: O sistema deve permitir disparar jobs manualmente (Passo 1 e Passo 2).
- RF-015: O sistema deve registrar se uma execução foi manual ou agendada.

## Histórico, Observabilidade e Auditoria Operacional
- RF-016: O sistema deve manter histórico de execuções com status (em fila, rodando, sucesso, falha, cancelado), horário de início/fim e duração.
- RF-017: O sistema deve permitir filtrar histórico por período, job, status e origem (manual/agendado).
- RF-018: O sistema deve exibir detalhes de execução (logs, erros, quantidades processadas e correlacionamento com pedidos afetados).

## Conexões (Banco e API) + Testes
- RF-019: O sistema deve permitir cadastrar conexões do tipo API (base URL, headers, autenticação, timeouts).
- RF-020: O sistema deve permitir cadastrar conexões do tipo Banco de Dados (driver, host, porta, base, usuário/segredo, SSL).
- RF-021: Para conexões de banco, o sistema deve permitir informar um SQL para teste/consulta (ex.: listar pedidos do dia).
- RF-022: O sistema deve permitir testar uma conexão cadastrada e exibir o resultado (sucesso/erro, mensagem).

## Configuração e Mapeamento de Dados
- RF-023: O sistema deve permitir configurar mapeamento/campos mínimos entre origem e destino (ex.: identificador do pedido, data, cliente, itens, status por item).
- RF-024: O sistema deve permitir parametrizar janelas de captura (ex.: últimos N dias / desde último checkpoint).
- RF-025: O sistema deve manter checkpoint da última captura bem-sucedida do Passo 1 por integração.

## Segurança e Acessos (funcional)
- RF-026: O sistema deve exigir autenticação para acesso às telas administrativas.
- RF-027: O sistema deve aplicar perfis de acesso (mínimo: Admin e Operador).
