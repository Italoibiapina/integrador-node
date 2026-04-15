# 06-Artefatos Adicionais (recomendados)

## Catálogo de Eventos Internos
| Evento | Quando ocorre | Payload mínimo | Consumidores típicos |
|---|---|---|---|
| `JobCompleted` | Job finaliza (sucesso/falha) | jobType, executionId, status, correlationId, startedAt, finishedAt | Notifier Engine, Auditoria, Alertas |
| `OrderCaptured` | Pedido/itens persistidos no Passo 1 | sourceSystem, sourceOrderId, executionId, changedFields | Métricas, Alertas, Regras futuras |
| `OrderSent` | Envio ao destino bem-sucedido | destinationSystem, destinationId, sourceOrderId, sendAttemptId | Auditoria, Reconciliador |
| `OrderSendFailed` | Envio ao destino falha | erro, statusCode, sendAttemptId | Retentativas, Alertas |

## Contratos de Dados (versionamento)
- DTOs de origem e destino devem ter versionamento explícito (ex.: `v1`, `v2`) para suportar evolução sem quebrar integrações antigas.
- Mapas de campo devem ser configuráveis quando possível (ex.: status “entregue” pode variar entre sistemas).

## API Administrativa (sugestão de endpoints)
- Autenticação
  - `POST /auth/login`
- Conexões
  - `GET/POST/PUT/DELETE /connections`
  - `POST /connections/{id}/test`
- Integrações
  - `GET/POST/PUT /integrations`
- Agendamentos
  - `GET/POST/PUT /schedules`
  - `POST /schedules/{id}/enable`
  - `POST /schedules/{id}/disable`
- Execuções
  - `GET /executions?from=&to=&jobType=&status=&trigger=`
  - `GET /executions/{id}`
- Disparo Manual
  - `POST /jobs/step1/run`
  - `POST /jobs/step2/run`
- Notificadores
  - `GET/POST/PUT /notifiers`

## Metodologia de Desenvolvimento (TDD + regressão)
- Regra: para cada caso de uso (ex.: Capturar Pedidos, Enviar Pedidos, Disparar Notificadores) criar testes antes do código.
- Testes de integração devem cobrir:
  - Persistência (repositórios)
  - Idempotência
  - Retentativas e tratamento de falhas
- Após estabilização, criar suíte de regressão automatizada para fluxos completos.
