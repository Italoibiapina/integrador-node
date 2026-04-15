# 04-Lista de Regras de Negócio

## Regras Gerais
- RN-001: Um “pedido” no Integrador é identificado unicamente pelo identificador de origem (ex.: `salesOrderId`) + sistema de origem.
- RN-002: Um pedido pode ter múltiplos itens; o status de entrega é controlado por item.
- RN-003: Itens marcados como “entregues” na origem devem ser refletidos no destino conforme o mapeamento de status.
- RN-004: Alterações de status por item devem ser tratadas como atualização (não como novo pedido).

## Captura (Passo 1)
- RN-005: O Passo 1 deve capturar apenas pedidos dentro da janela configurada (ex.: desde último checkpoint ou últimos N dias).
- RN-006: Ao concluir o Passo 1 com sucesso, o Integrador deve atualizar o checkpoint da integração.
- RN-007: Se o Passo 1 falhar, o checkpoint não deve avançar.
- RN-008: A captura deve registrar origem do dado (API vs scraping) por execução.

## Envio (Passo 2)
- RN-009: O Passo 2 deve enviar apenas pedidos elegíveis (ex.: “pendente de envio” ou “com alteração desde o último envio”).
- RN-010: O envio deve ser idempotente: reenvios não podem gerar duplicidade no destino.
- RN-011: Em caso de falha de comunicação com o destino, o pedido deve permanecer com status “falha” e ser reprocessável.
- RN-012: Reprocessamentos não podem sobrescrever o histórico anterior; devem gerar um novo registro de tentativa.

## Notificadores (Orquestração)
- RN-013: Notificadores só devem ser disparados quando o job origem finalizar com status “sucesso”.
- RN-014: Notificadores devem ser executados em ordem determinística por prioridade configurada.
- RN-015: A falha de um notificador não deve impedir a execução dos demais; todas as falhas devem ser registradas.

## Agendamento e Execução Manual
- RN-016: Execuções manuais têm prioridade sobre agendadas quando houver concorrência para o mesmo job/integração.
- RN-017: Não deve haver duas execuções concorrentes do mesmo job para a mesma integração, salvo configuração explícita (default: bloqueado).

## Conexões
- RN-018: Segredos de conexão (tokens, senhas) não podem ser exibidos em telas nem logs operacionais.
- RN-019: O teste de conexão de banco usando SQL deve ser executado com limites de segurança (ex.: timeout, máximo de linhas).
