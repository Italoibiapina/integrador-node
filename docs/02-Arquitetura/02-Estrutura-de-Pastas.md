# 02-Estrutura de Pastas

## Estrutura Atual do Repositório
- Raiz do repositório contém apenas artefatos iniciais (README e .env.example).
- A pasta `docs/` padroniza o processo de construção (requisitos → arquitetura → planejamento → implementação → testes).

## Estrutura Recomendada (quando iniciar implementação)

### Opção A — Monorepo (backend + frontend)
```
/
  docs/
  src/
    backend/
      Integrator.Api/
      Integrator.Application/
      Integrator.Domain/
      Integrator.Infrastructure/
      Integrator.Worker/
      Integrator.Tests/
    frontend/
      integrator-admin/
  infra/
    docker/
    migrations/
  scripts/
```

### Opção B — Separado (2 repositórios)
```
integrator-backend/
integrator-frontend/
```

## Justificativa (Opção A)
- Simplifica rastreabilidade de mudanças (API + UI + jobs).
- Facilita testes de integração ponta a ponta.
- Ajuda no versionamento de contratos entre módulos.

## Pastas Principais (significado)
- `Integrator.Domain`: entidades, value objects, regras de negócio (maior parte dos testes TDD).
- `Integrator.Application`: casos de uso, orquestração de jobs, mapeamentos, validações.
- `Integrator.Infrastructure`: adapters (HTTP clients, scraping, DB, filas, criptografia).
- `Integrator.Api`: endpoints administrativos e autenticação/autorização.
- `Integrator.Worker`: runtime de jobs (Hangfire/Quartz), consumidores de eventos, etc.
- `Integrator.Tests`: testes unitários e de integração.
