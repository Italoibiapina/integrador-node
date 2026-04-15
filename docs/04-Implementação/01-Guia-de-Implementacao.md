# 01-Implementação (guia baseado nos passos)

## Regras Gerais de Implementação
- Implementar por fatias verticais, mas respeitando a ordem do planejamento (domínio → repositórios → serviços → UI → integração final).
- Toda entrega deve manter o sistema executável e testável.
- Mudanças em contratos de dados exigem testes de regressão atualizados.

## Checklist por Componente

### Jobs (Passo 1 e Passo 2)
- Entradas claras (integração, janela, trigger manual/agendado)
- Lock para evitar concorrência indevida
- Persistência de Execution e métricas (quantidades processadas)
- Tratamento de erro com retry e limite
- Publicação de evento `JobCompleted` (sucesso/falha)

### Conectores (API / Scraping / Banco)
- Interface única (porta) para o núcleo chamar
- Timeouts e política de retry isolados por conector
- Logs sem segredos
- Testes com fakes/mocks e um “contrato” de comportamento mínimo

### Persistência
- Upsert de pedidos/itens por chave natural (origem + idPedido)
- Índices e constraints para garantir RN-001
- Tabelas de histórico (execuções, tentativas) sempre append-only quando fizer sentido

### UI (Operação)
- Experiência simples: encontrar erro rapidamente e reprocessar
- Indicar claramente “manual vs agendado” e o usuário que disparou
- Teste de conexão com feedback objetivo (o que falhou e por quê)

## Definition of Done (DoD)
- Funcionalidade completa conforme RF aplicáveis
- Regras RN aplicáveis cobertas por testes
- RNF mínimos atendidos:
  - autenticação/autorização
  - logs com correlationId
  - retry e idempotência no envio
- Documentação de decisões técnicas atualizada em `docs/02-Arquitetura/`
