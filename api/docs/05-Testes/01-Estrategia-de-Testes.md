# 01-Estratégia de Testes (TDD + Regressão)

## Objetivo
Garantir que o Integrador seja confiável, evolutivo e seguro para adicionar novas integrações sem quebrar integrações existentes.

## Pirâmide de Testes (recomendada)
- Unitários (maioria)
  - Domínio: regras RN-001..RN-019
  - Casos de uso: fluxo de orquestração, idempotência, seleção de pedidos elegíveis
- Integração
  - Repositórios e migrações
  - Jobs executando contra banco real (PostgreSQL) e serviços externos simulados (stubs)
- Contrato (opcional, mas útil)
  - Valida payloads esperados pelo destino
  - Valida leitura da origem (API) ou parsing do scraping (quando aplicável)
- E2E (mínimo)
  - Disparo manual → execução → histórico → detalhes

## Suíte de Regressão (mínima para MVP)
### Regressão de Jobs
- TR-001: Passo 1 captura pedidos e cria/atualiza registros sem duplicar (RN-001, RN-005).
- TR-002: Passo 1 falha não avança checkpoint (RN-007).
- TR-003: Passo 1 sucesso dispara notificador do Passo 2 (RN-013).
- TR-004: Passo 2 envia pedidos elegíveis e marca como enviado (RN-009).
- TR-005: Reenvio do mesmo pedido não cria duplicado no destino (RN-010).
- TR-006: Falha de destino registra tentativa e permite reprocessar (RN-011, RN-012).

### Regressão de UI (smoke)
- TR-007: Operador cadastra conexão e testa (RF-019..RF-022).
- TR-008: Operador agenda job e habilita/desabilita (RF-012, RF-013).
- TR-009: Operador dispara job manualmente e vê execução marcada como manual (RF-014, RF-015).
- TR-010: Operador consulta detalhe de execução e identifica falhas (RF-016..RF-018).

## Critérios de Aceitação por Requisito (abordagem)
- Cada RF relevante do MVP deve possuir pelo menos 1 teste de aceitação (integração ou E2E).
- Cada RN deve ser coberta por teste unitário sempre que estiver no domínio/caso de uso.
- RNF-006/RNF-007 (segurança) deve ter testes automatizados (ex.: endpoints protegidos, perfis).

## Dados de Teste
- Conjunto de pedidos com:
  - múltiplos itens
  - itens entregues e não entregues
  - pedidos repetidos (para validar idempotência)
  - cenários de falha (timeout, 500, 400)

## Política de Qualidade (gate)
- Pull requests só podem ser aceitos com:
  - testes passando
  - cobertura mínima para domínio/casos de uso (definir meta na implementação)
  - suíte de regressão do MVP passando
