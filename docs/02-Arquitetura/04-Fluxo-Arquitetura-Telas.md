# 04-Fluxo de Arquitetura de Telas

## Mapa de Navegação (alto nível)
```mermaid
flowchart TD
  L[Login] --> D[Dashboard]

  D --> S[Agendamentos]
  D --> M[Disparo Manual]
  D --> E[Execuções]
  D --> C[Conexões]
  D --> N[Notificadores]

  S --> S1[Criar/Editar Agendamento]
  S --> S2[Habilitar/Desabilitar]

  M --> M1[Selecionar Integração/Job]
  M1 --> M2[Executar]
  M2 --> E

  E --> E1[Detalhe da Execução]
  E1 --> E2[Pedidos/Itens Processados]
  E1 --> E3[Notificadores Disparados]
  E1 --> E4[Logs/Erros]

  C --> C1[Criar/Editar Conexão API]
  C --> C2[Criar/Editar Conexão Banco]
  C2 --> C3[SQL de Teste]
  C --> C4[Testar Conexão]

  N --> N1[Criar/Editar Notificador]
  N --> N2[Habilitar/Desabilitar]
```

## Telas e Estados
- Login
  - Estado: autenticado / não autenticado
- Dashboard
  - KPIs mínimos: execuções nas últimas 24h, falhas, fila, última captura, último envio
- Agendamentos
  - Estados: habilitado/desabilitado; cron válido/inválido; última execução; próxima execução
- Disparo Manual
  - Estados: em execução; concluído; falhou; com parâmetros (ex.: janela de captura, reprocessar falhas)
- Execuções
  - Estados: em fila; rodando; sucesso; falha; cancelado
  - Metadados: manual vs agendado; usuário (se manual); correlationId
- Conexões
  - Tipos: API, Banco
  - Estados: ativa/inativa; teste ok/falha
- Notificadores
  - Estados: habilitado/desabilitado; evento de origem (ex.: Step1 Success); ação destino (ex.: disparar Step2); prioridade; condições

## Papéis de Acesso (mínimo)
- Admin: gerencia conexões, agendamentos, notificadores, usuários.
- Operador: dispara jobs, consulta execuções e detalhes; pode testar conexões se permitido.
