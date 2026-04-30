# 05-Lista de Requisitos Não Funcionais

## Disponibilidade e Resiliência
- RNF-001: O Integrador deve ser tolerante a falhas temporárias de origem/destino, com política de retry configurável.
- RNF-002: Jobs devem suportar retomada segura após queda (não perder histórico, não duplicar envios).

## Observabilidade e Auditoria
- RNF-003: Toda execução deve possuir identificador de correlação único (correlationId) utilizado em logs e telas.
- RNF-004: Deve existir trilha de auditoria de: quem disparou manualmente, quando, qual integração, qual resultado.
- RNF-005: Logs devem suportar níveis (info/warn/error) e mascaramento de segredos.

## Segurança
- RNF-006: O sistema deve exigir autenticação nas telas administrativas.
- RNF-007: O sistema deve implementar autorização por papéis (mínimo: Admin, Operador).
- RNF-008: Segredos devem ser armazenados de forma segura (ex.: criptografia em repouso e/ou vault, conforme stack).
- RNF-009: Todas as chamadas externas por API devem suportar HTTPS e validação de certificados.

## Performance e Throughput
- RNF-010: O Passo 1 deve processar em lote, suportando paginação/streaming quando a origem permitir.
- RNF-011: O Passo 2 deve suportar envio em lotes e controle de taxa (rate limit) para respeitar limites do destino.

## Escalabilidade e Extensibilidade
- RNF-012: A arquitetura deve permitir adicionar novos conectores (ex.: WhatsApp → CRM) sem modificar o núcleo de orquestração.
- RNF-013: Jobs e conectores devem ser configuráveis por integração (multi-integrações simultâneas).

## Manutenibilidade
- RNF-014: O desenvolvimento deve seguir TDD como metodologia padrão.
- RNF-015: O sistema deve possuir testes de regressão automatizados para os fluxos principais.

## Usabilidade (Operação)
- RNF-016: A UI deve permitir operação sem acesso ao banco/servidor (agendar, disparar, acompanhar, testar conexões).
- RNF-017: A UI deve ser responsiva para uso em desktop (mínimo) e suportar acessibilidade básica (contraste, navegação por teclado).
