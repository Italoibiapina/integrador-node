# 01-MVP

## Proposta
Adotar MVP para reduzir risco e entregar valor rápido, mantendo a arquitetura extensível.

## MVP (escopo mínimo para “Pedidos → Encomendas”)

### Inclui
- Passo 1 (captura) por 1 conector inicial:
  - Preferência: API de Vendas
  - Contingência: scraping (se API não existir/for limitada)
- Passo 2 (envio) via API do Controle de Encomendas
- Banco do Integrador com tabelas de:
  - pedidos/itens (staging)
  - execuções
  - tentativas de envio
  - conexões
  - agendamentos
  - notificadores (mínimo: “Step1 sucesso → Step2”)
- UI mínima:
  - Disparo manual (Step1/Step2)
  - Histórico de execuções (lista + detalhe)
  - Conexões (CRUD + teste)
  - Agendamentos (CRUD + habilitar/desabilitar)

### Exclui (pós-MVP)
- Integrações adicionais (WhatsApp → CRM, etc.)
- Dashboards avançados/KPIs e alertas sofisticados
- Motor de mapeamento de campos totalmente configurável por usuário final (inicialmente fixo, parametrizando o essencial)
- Multi-tenant completo (caso necessário no futuro)

## Critérios de Aceitação do MVP
- Pedidos capturados aparecem no banco do Integrador com rastreabilidade por execução.
- Envio para o destino funciona com idempotência e retry básico.
- Operador consegue:
  - cadastrar conexões e testá-las
  - agendar e disparar jobs
  - auditar execuções e falhas na UI
