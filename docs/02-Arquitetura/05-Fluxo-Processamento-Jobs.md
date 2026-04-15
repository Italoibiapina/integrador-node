# 05-Fluxo de Processamento de Jobs

## Visão Geral
O Integrador processa integrações por jobs, registrando cada execução e seus resultados. O fluxo padrão inclui:
- Passo 1: Captura (origem → banco Integrador)
- Evento interno: Passo 1 Concluído (sucesso)
- Notificadores: disparam ações configuradas (ex.: Passo 2)
- Passo 2: Envio (banco Integrador → API destino)

As configurações de “quais notificadores disparam após o Passo 1” são mantidas no banco (NotifierConfig) e gerenciadas via tela administrativa de Notificadores.

Implementação alvo:
- Fila/worker usando pg-boss (Postgres)
- Jobs Step1/Step2 e o dispatcher de notificadores como filas separadas
- Lock por (jobType, integrationId) usando advisory locks do Postgres

## Passo 1 — Captura de Pedidos (Sequência)
```mermaid
sequenceDiagram
  autonumber
  actor Operador
  participant UI as UI/Admin
  participant API as Integrator API
  participant JOB as Worker (pg-boss)
  participant SRC as Fonte (API/Scraping)
  participant DB as Banco Integrador

  Operador->>UI: Disparar Passo 1 (manual) / Agendamento
  UI->>API: POST /jobs/step1/run
  API->>DB: Criar Execution (status=Queued)
  API->>JOB: Enfileirar execução
  JOB->>DB: Atualizar Execution (Running)
  JOB->>SRC: Buscar pedidos (janela/checkpoint)
  SRC-->>JOB: Lista de pedidos/itens
  JOB->>DB: Upsert pedidos/itens + marcar origem (API/Scraping)
  JOB->>DB: Atualizar checkpoint (somente sucesso)
  JOB->>DB: Atualizar Execution (Success/Failed)
```

## Evento Interno — Passo 1 Concluído (Notificadores)
```mermaid
sequenceDiagram
  autonumber
  participant JOB as Worker (pg-boss)
  participant EVT as Fila pg-boss (notifier.dispatch)
  participant DB as Banco Integrador
  participant NOT as Notifier Dispatcher
  participant JOB2 as Worker (pg-boss) (Step 2)

  JOB->>EVT: Publicar JobCompleted(Step1, Success)
  EVT->>NOT: Entregar evento
  NOT->>DB: Carregar notificadores configurados p/ Step1
  loop Para cada notificador (por prioridade)
    NOT->>DB: Registrar disparo do notificador (Queued)
    NOT->>JOB2: Enfileirar Step2 (com contexto/correlationId)
    NOT->>DB: Registrar disparo do notificador (Success/Failed)
  end
```

## Passo 2 — Envio para Encomendas (Sequência)
```mermaid
sequenceDiagram
  autonumber
  participant JOB as Worker (pg-boss)
  participant DB as Banco Integrador
  participant DST as Destino (API Encomendas)

  JOB->>DB: Criar/Atualizar Execution (Running)
  JOB->>DB: Selecionar pedidos elegíveis (pendentes/alterados)
  loop Para cada pedido
    JOB->>DB: Criar SendAttempt (Queued)
    JOB->>DST: POST /encomendas (payload do pedido)
    alt Sucesso
      DST-->>JOB: 2xx + idDestino
      JOB->>DB: Atualizar pedido (sentAt, idDestino, hashPayload)
      JOB->>DB: Atualizar SendAttempt (Success)
    else Falha
      DST-->>JOB: 4xx/5xx/timeout
      JOB->>DB: Atualizar SendAttempt (Failed, erro)
    end
  end
  JOB->>DB: Atualizar Execution (Success/Failed)
```

## Controles Necessários (para confiabilidade)
- Lock por integração+job para evitar concorrência (default).
- Idempotência por:
  - chave natural (origem + idPedido) e/ou
  - hash do payload enviado + idDestino
- Retry com backoff e limite; após limite, manter como “falha” reprocessável via UI.
- Rate limit para proteger APIs externas.
