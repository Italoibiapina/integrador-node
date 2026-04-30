# Modelo de Entidade e Relacionamento (ERD) - Integração de APIs

Este documento descreve a estrutura de dados implementada para a gestão de serviços de integração via API, focando na rastreabilidade, auditoria (logs com JSON bruto) e facilidade de manutenção.

## Diagrama Conceitual (Mermaid)

```mermaid
erDiagram
    API_AUTH_CONFIGS ||--o{ API_SERVICES : "provê auth para"
    API_SERVICES ||--o{ API_SERVICE_EXECUTIONS : "possui"
    API_BATCHES ||--o{ API_SERVICE_EXECUTIONS : "agrupa"

    API_AUTH_CONFIGS {
        uuid id PK
        string name "Nome da Config (ex: PowerStock Principal)"
        string base_url "URL Base da API"
        string username
        string password
        text last_token
        timestamp token_expires_at
        jsonb extra_headers "Headers globais (Referer, etc)"
    }

    API_SERVICES {
        uuid id PK
        uuid auth_config_id FK "Relaciona com api_auth_configs"
        string name "Nome do Serviço (ex: Coleta de Pedidos)"
        text description
        boolean is_active
        jsonb endpoints "Config de paths específicos (login, fetch, etc)"
        timestamp last_run_at
        string current_status
    }

    API_BATCHES {
        uuid id PK
        string name "Snapshot: Nome do Serviço"
        text description "Snapshot: Descrição"
        boolean is_active "Snapshot: Status"
        jsonb endpoints "Snapshot: Endpoints usados"
        uuid auth_config_id "Snapshot: ID da Auth usada"
        timestamp started_at "Início da Execução Total"
        timestamp finished_at
        string status "running, success, failed, partial"
        string trigger_type "manual, scheduled"
        text error_message "Mensagem de erro do lote"
        jsonb raw_response "Resposta bruta (se lote individual)"
    }

    API_SERVICE_EXECUTIONS {
        uuid id PK
        uuid batch_id FK "Relaciona with api_batches"
        uuid service_id FK "Relaciona with api_services"
        jsonb snapshot_config "Snapshot (Service + Auth Config)"
        timestamp started_at
        timestamp finished_at
        string status
        text error_message
        jsonb raw_response "JSON bruto da resposta"
    }
```

## Descrição das Tabelas

### 1. api_auth_configs
Armazena as credenciais e a URL base. Esta tabela permite que você tenha um único login/token compartilhado por vários serviços diferentes (ex: um serviço para pedidos, outro para produtos, ambos usando a mesma autenticação).

### 2. api_services
Define o que o serviço faz. Ele aponta para uma configuração de autenticação e define quais `endpoints` (caminhos relativos e métodos HTTP) ele utiliza.

### 3. api_batches
Representa a "Execução Total". Um lote agrupa várias execuções de serviços que foram disparadas juntas.

### 4. api_service_executions
Registra o histórico individual de cada serviço. O `snapshot_config` salva tanto os dados do serviço quanto os dados da autenticação no momento exato da execução.

---
**Documento gerado em:** 2026-04-28
**Versão:** 1.0
