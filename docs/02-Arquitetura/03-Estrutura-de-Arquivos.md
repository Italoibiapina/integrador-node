# 03-Estrutura de Arquivos

## Convenções (sugestão)
- Nomes consistentes e orientados ao domínio: `Integration`, `Execution`, `Connection`, `Notifier`.
- Separar contratos (DTOs) do domínio (entidades).
- Interfaces de conectores em camada de aplicação/domínio; implementações em infraestrutura.

## Exemplo (Backend)
```
src/backend/
  Integrator.Domain/
    Integrations/
      Integration.cs
      IntegrationId.cs
    Executions/
      Execution.cs
      ExecutionStatus.cs
    Orders/
      Order.cs
      OrderItem.cs
  Integrator.Application/
    Jobs/
      Step1CaptureOrders/
        CaptureOrdersCommand.cs
        CaptureOrdersHandler.cs
      Step2SendOrders/
        SendOrdersCommand.cs
        SendOrdersHandler.cs
    Connectors/
      ISourceConnector.cs
      IDestinationConnector.cs
    Notifiers/
      INotifier.cs
      NotifyOnJobCompleted.cs
  Integrator.Infrastructure/
    Persistence/
      IntegratorDbContext.cs
      Migrations/
    ExternalSystems/
      Sales/
        SalesApiConnector.cs
        SalesScrapingConnector.cs
      Shipping/
        ShippingApiConnector.cs
    Security/
      SecretProtector.cs
  Integrator.Api/
    Controllers/
      IntegrationsController.cs
      ConnectionsController.cs
      SchedulesController.cs
      ExecutionsController.cs
    Auth/
      JwtOptions.cs
```

## Exemplo (Frontend)
```
src/frontend/integrator-admin/
  src/
    pages/
      schedules/
      executions/
      connections/
      manual-run/
    components/
      DataTable/
      ConnectionForm/
      JobRunDialog/
    api/
      client.ts
      connections.ts
      executions.ts
```

## Artefatos (Integração por Conector)
- Para cada sistema externo, manter uma pasta dedicada com:
  - Client HTTP (quando API)
  - Scraper (quando scraping)
  - DTOs de integração (contratos) e mapeamentos
