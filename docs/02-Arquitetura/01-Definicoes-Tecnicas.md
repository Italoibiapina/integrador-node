# 01-Definições Técnicas (BD, Tecnologias)

## Premissas
- O Integrador será um produto reutilizável para múltiplas integrações (não só “Pedidos → Encomendas”).
- O núcleo deve ser estável (orquestração, histórico, agendamento, segurança).
- Conectores devem ser plugáveis (API, scraping, banco, mensageria).

## Stack Recomendada (implementável e extensível)

### Backend (API + Orquestração)
- Linguagem/Framework (decisão: Node.js por escalabilidade e padronização):
  - Node.js + TypeScript + NestJS (ou Fastify + plugins)
- Web scraping (quando API não existir/for insuficiente):
  - Playwright (Node) para automação e extração controlada (incluindo páginas dinâmicas)
- Jobs/Agendamento (opções equivalentes, escolhendo pelo nível de complexidade):
  - Opção A (mais simples): agendamento no app + lock no banco + tabelas de `schedules` e `executions`
  - Opção B (fila de jobs): worker dedicado + fila no Postgres + retry/backoff
    - Node: pg-boss (Postgres) (escolha inicial)
- Persistência: ORM conforme stack (ex.: Prisma/TypeORM no Node) ou SQL direto para rotas críticas

### Banco de Dados
- PostgreSQL
- Motivos: robusto para workloads transacionais e históricos; bom suporte a JSONB quando necessário; fácil operação.

### Cache/Fila (opcional)
- Redis (não é obrigatório)
- Uso típico quando adotamos fila e/ou precisamos de performance operacional:
  - Fila de jobs e agendamentos (quando não for Postgres)
  - Locks distribuídos (evitar duas execuções concorrentes do mesmo job/integração)
  - Rate limit (proteção de APIs externas)
  - Cache de tokens/sessões e resultados de “test connection”
- Alternativa sem Redis:
  - fila e agendamento persistidos no próprio Postgres (ex.: pg-boss/graphile-worker) + locks via advisory locks
  - rate limit e locks via Postgres (com cuidado para não sobrecarregar)

### Frontend (Telas Administrativas)
- React + TypeScript
- Autenticação: JWT (ou cookie + sessão, conforme padrão corporativo)

## Padrões Arquiteturais
- Modular Monolith (primeiro estágio), com módulos bem definidos e portas/adaptadores.
- DDD leve (domínio central para integrações, execuções, eventos e conectores).
- Arquitetura Hexagonal (Ports & Adapters):
  - Ports: interfaces de “SourceConnector”, “DestinationConnector”, “Notifier”
  - Adapters: API client, scraping, banco externo, etc.

## Execução de Jobs com Postgres (pg-boss) — Detalhamento

### Componentes de Runtime
- API (NestJS/Fastify)
  - expõe endpoints para disparo manual, cadastro de agendamentos, conexões e notificadores
  - grava/consulta no banco: `executions`, `schedules`, `notifier_configs`, etc.
- Worker (processo separado)
  - inicializa o `pg-boss` e registra handlers de filas (Step1, Step2, Notify, etc.)
  - executa jobs, atualiza histórico e resultados no banco do Integrador

### Filas (nomes sugeridos)
- `step1.captureOrders`
- `step2.sendOrders`
- `notifier.dispatch`

### Payload padrão de job (data mínima)
- `integrationId`
- `jobType` (Step1/Step2/Notifier)
- `executionId`
- `trigger` (manual/agendado)
- `correlationId`
- `requestedBy` (quando manual)
- `params` (janela de captura, flags de reprocessamento, etc.)

### Agendamento (como a UI controla o cron)
O sistema mantém `schedules` como fonte de verdade (UI) e usa o pg-boss para executar:
- Ao habilitar um agendamento:
  - persistir `schedules` (cron, jobType, integrationId, habilitado)
  - registrar/atualizar o agendamento no pg-boss (schedule) usando um nome determinístico:
    - `scheduleName = {jobType}:{integrationId}`
- Ao desabilitar um agendamento:
  - marcar `schedules` como desabilitado
  - cancelar/remover o schedule correspondente no pg-boss

### Concorrência (lock por integração + job)
Regra padrão: não permitir duas execuções simultâneas do mesmo job para a mesma integração.
- No início da execução no Worker, adquirir um lock no Postgres:
  - advisory lock derivado de `(jobType, integrationId)`
- Se não conseguir lock:
  - finalizar o job como “skipped” (ou re-enfileirar com pequeno delay), sem processar dados
- Ao finalizar (sucesso/falha), liberar o lock

### Retry e Backoff
Para falhas transitórias (API fora, timeout, etc.), usar as capacidades do pg-boss:
- definir `retryLimit` e `retryDelay` por tipo de job (Step1 e Step2 podem ter políticas diferentes)
- registrar cada tentativa no histórico (`executions` e/ou `send_attempts`)
- quando exceder o limite:
  - manter como falha reprocessável via UI (disparo manual)

### Idempotência (mínimo necessário)
- Step1 (captura):
  - upsert por chave natural (`sourceSystem`, `sourceOrderId`)
  - versionar alterações relevantes (hash do payload ou timestamps de origem)
- Step2 (envio):
  - não reenviar se não houve mudança desde o último envio bem-sucedido (hash do payload mapeado)
  - registrar tentativas de envio (`send_attempts`) sempre que chamar o destino

### Notificadores pós-Step1 (sem barrar a execução do Step1)
- Ao finalizar Step1 com sucesso:
  - gravar `execution` como Success
  - enfileirar `notifier.dispatch` com `executionId` e `jobType=Step1`
- O handler `notifier.dispatch`:
  - carrega `notifier_configs` habilitados para o evento (ex.: Step1 Success)
  - para cada notificador (ordem por prioridade), enfileira o job de destino (ex.: Step2) com o mesmo `correlationId`
  - registra sucesso/falha de cada notificador sem impedir os demais

## Conectores Parametrizáveis (API e Scraping)

### API Connector (origem e destino)
Sim, dá para deixar parametrizável por integração, evitando criar um “código por API” em muitos casos. Na prática, o integrador terá:
- Um conector genérico HTTP configurável (baseUrl, autenticação, headers, timeout, retry).
- Configuração por integração contendo:
  - endpoint e método (ex.: `GET /orders`, `POST /shipments`)
  - estratégia de paginação (page/size, cursor, offset/limit)
  - mapeamento leve de caminhos (JSONPath/paths) para extrair o identificador do pedido e itens, quando necessário

Limite: quando a API tem regras específicas (ex.: múltiplas chamadas correlacionadas, tokenização incomum, assinatura HMAC, ou contrato muito diferente), ainda será necessário um adapter dedicado para aquele sistema.

### Web Scraping (Playwright)
Para scraping, é esperado que exista implementação por sistema (adapter), mas com parâmetros configuráveis por conexão:
- Credenciais e dados de acesso: login, senha e eventualmente passos extras (ex.: tenant, unidade, perfil)
- URLs, selectors principais e opções de navegação podem ser parametrizados para reduzir hardcode

Limite: mudanças de HTML, regras anti-bot, CAPTCHA e fluxos dinâmicos geralmente exigem manutenção no adapter. O cadastro de credenciais e parâmetros não elimina a necessidade de código de scraping, mas reduz acoplamento e facilita operação.

## Configuração Operacional por Integração
Sim, as regras operacionais devem ser cadastráveis por integração (e por job), por exemplo:
- janela de captura (desde checkpoint, últimos N dias, intervalo fixo)
- concorrência (permitir/bloquear paralelo por job+integração)
- políticas de retry/backoff (por job)
- rate limit (por integração/destino)

Essas configurações ficam em tabelas de `integrations`/`integration_settings` e são aplicadas pelos handlers do Worker.

## Autenticação e Sessão (UI)
Padrão recomendado:
- JWT em cookie HttpOnly (não em localStorage)
- Cookie com `Secure` e `SameSite` adequado ao modo de deploy
- Proteção contra CSRF (ex.: double submit cookie ou token anti-CSRF por header) quando necessário

Isso melhora segurança contra XSS e mantém UX boa para a UI administrativa.

## Modelo de Dados (visão conceitual)
- Integração
  - define origem, destino, configurações e parâmetros de janela/checkpoint
- Conexão
  - API: baseUrl, auth, headers, timeout
  - Banco: driver, host, base, credenciais, sqlTeste
- JobDefinition
  - Passo 1, Passo 2, ou futuros jobs
- Schedule
  - cron/intervalo + habilitado
- Execution
  - status, início/fim, gatilho (manual/agendado), correlationId, logs
- NotifierConfig
  - evento “job concluído com sucesso” → lista de ações/jobs a disparar, prioridade
- Order (staging do integrador)
  - identificador de origem, dados de cliente, datas, total, etc.
- OrderItem
  - produto, quantidade, statusEntrega, timestamps
- SendAttempt
  - tentativas de envio ao destino (payload/response, status, erro)

## Estratégia de Armazenamento dos Dados Capturados (Passo 1)
Para manter o Integrador extensível (múltiplas origens com campos diferentes), a abordagem recomendada é híbrida:
- Colunas “core” normalizadas para consulta e operação:
  - `sourceSystem`, `sourceOrderId`, timestamps, status de envio, `executionId`, `correlationId`
- Payload bruto e/ou mapeado em JSONB:
  - `sourcePayload` (JSONB) para guardar o retorno da origem (API/scraping) sem depender de schema fixo
  - `mappedPayload` (JSONB) opcional para guardar o que será enviado ao destino (antes de enviar)

Isso evita “criar uma tabela para cada arquivo/origem” e ainda permite filtros eficientes pelos campos core.

## Segurança (alto nível)
- Segredos (tokens/senhas) armazenados de forma segura e nunca exibidos em claro.
- UI protegida por autenticação e autorização por papéis.

## Decisões Importantes (para TDD e regressão)
- Separar claramente:
  - Regras de domínio (testáveis em memória)
  - Infra (HTTP, scraping, DB externo) via adapters e mocks/fakes em testes
- Contratos de dados versionados (DTOs de origem/destino e eventos internos).
