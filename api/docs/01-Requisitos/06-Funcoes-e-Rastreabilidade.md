# 06-Funções e Rastreabilidade

## Lista de Funções (alto nível)

### Telas (UI)
- FNC-001: Tela de Agendamentos de Jobs (listar/criar/editar/habilitar/desabilitar)
- FNC-002: Tela de Disparo Manual (executar Passo 1 / Passo 2, com parâmetros)
- FNC-003: Tela de Histórico de Execuções (filtros, detalhes, logs, manual vs agendado)
- FNC-004: Tela de Conexões (CRUD de conexões API e Banco)
- FNC-005: Tela de Teste de Conexão (executar teste e exibir resultado)

### Jobs e Processamento
- FNC-006: Job Passo 1 — Captura de Pedidos (API ou scraping) + persistência
- FNC-007: Job Passo 2 — Envio de Pedidos para Encomendas (API) + idempotência + retry
- FNC-008: Orquestrador de Notificadores (disparo pós-job, prioridade, isolamento de falhas)

### APIs e Integrações
- FNC-009: API Administrativa (conexões, agendamentos, execuções, notificadores)
- FNC-010: Exportação/Relatório de Execuções (ex.: CSV/JSON para auditoria)

## Cruzamento (Rastreabilidade)

| Função | Requisitos Funcionais | Regras de Negócio | Requisitos Não Funcionais |
|---|---|---|---|
| FNC-001 Agendamentos | RF-012, RF-013 | RN-016, RN-017 | RNF-003, RNF-016 |
| FNC-002 Disparo Manual | RF-014, RF-015 | RN-016, RN-017 | RNF-003, RNF-004 |
| FNC-003 Histórico Execuções | RF-016, RF-017, RF-018 | RN-012 | RNF-003, RNF-004, RNF-005, RNF-016 |
| FNC-004 Conexões (CRUD) | RF-019, RF-020, RF-021 | RN-018, RN-019 | RNF-006, RNF-008 |
| FNC-005 Teste Conexão | RF-022 | RN-019 | RNF-005, RNF-016 |
| FNC-006 Job Passo 1 | RF-002, RF-003, RF-004, RF-024, RF-025 | RN-005, RN-006, RN-007, RN-008 | RNF-001, RNF-002, RNF-010 |
| FNC-007 Job Passo 2 | RF-005, RF-006, RF-007, RF-008 | RN-009, RN-010, RN-011, RN-012 | RNF-001, RNF-002, RNF-011 |
| FNC-008 Notificadores | RF-009, RF-010, RF-011 | RN-013, RN-014, RN-015 | RNF-001, RNF-003 |
| FNC-009 API Administrativa | RF-019, RF-020, RF-012, RF-016 | RN-018 | RNF-006, RNF-007, RNF-008, RNF-009 |
| FNC-010 Exportação Execuções | RF-010 (apoio operacional), RF-018 | RN-012 | RNF-004, RNF-005 |

## Observações
- A rastreabilidade acima é o “mínimo implementável” para iniciar a construção orientada a TDD: cada RF/RN/RNF deve possuir critérios de aceitação e testes associados na fase 05-Testes.
