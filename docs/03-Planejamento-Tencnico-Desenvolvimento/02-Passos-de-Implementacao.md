# 02-Passos de Implementação (ordem obrigatória)

## 1) Casos de uso / Regras de negócio
Entregáveis:
- Caso de uso: Capturar Pedidos (Passo 1)
- Caso de uso: Enviar Pedidos (Passo 2)
- Caso de uso: Disparar Notificadores pós-job
- Caso de uso: Agendar Job
- Caso de uso: Disparo Manual
- Caso de uso: Testar Conexão (API e Banco + SQL)

Critérios de aceitação:
- Regras RN-001..RN-019 cobertas por testes (unitários) sempre que possível.

## 2) Modelo de domínio e contratos de dados
Entregáveis:
- Entidades: Integration, Connection, Schedule, Execution, Order, OrderItem, SendAttempt, NotifierConfig
- Value Objects: IDs, status enums, tipos de conexão, tipo de job, trigger (manual/agendado)
- Contratos (DTOs):
  - `SalesOrderDto` (origem)
  - `ShippingOrderRequestDto` (destino)
  - `JobCompletedEvent` (evento interno)

Critérios de aceitação:
- Invariantes de domínio (unicidade, status, transições) com testes unitários.

## 3) Banco e repositórios
Entregáveis:
- Migrações iniciais do banco do Integrador
- Repositórios para: execuções, pedidos, tentativas de envio, conexões, agendamentos, notificadores
- Índices para:
  - (sourceSystem, sourceOrderId)
  - status de envio e timestamps
  - histórico de execuções por período

Critérios de aceitação:
- Testes de integração cobrindo persistência, upsert e consultas críticas.

## 4) Serviços
Entregáveis:
- Serviço de captura (API/scraping via connector)
- Serviço de envio (API destino)
- Serviço de idempotência (hash/payload/chaves naturais)
- Serviço de notificação/orquestração
- Serviços de segurança de segredos (proteção/mascaramento)

Critérios de aceitação:
- Retry básico e tratamento de falhas.
- Logs e auditoria mínimos (RNF-003..RNF-005).

## 5) Telas / frontend
Entregáveis:
- UI de Conexões + teste
- UI de Agendamentos
- UI de Disparo Manual
- UI de Histórico de Execuções (lista + detalhe)

Critérios de aceitação:
- Fluxos operacionais completos sem acesso ao servidor.

## 6) Integração e ajustes finais
Entregáveis:
- Ambiente de homologação (conexões reais)
- “Dry run” do Passo 1 e Passo 2 com volumes reais
- Ajustes de performance, paginação e rate limit

Critérios de aceitação:
- Suíte de regressão mínima passando (fase 05-Testes).
