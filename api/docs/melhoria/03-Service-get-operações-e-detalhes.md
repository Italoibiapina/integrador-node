# Fluxo de Integração PowerStock (Listagem e Detalhes)

Este documento descreve a lógica de processamento para a coleta de dados da API do PowerStock, detalhando como as conexões e endpoints são obtidos a partir do banco de dados.

## Fluxo de Processamento (Mermaid)

```mermaid
flowchart TD
    Start([Início do Batch]) --> GetService["(1) Buscar API_SERVICE por ID no DB"]
    
    GetService --> GetAuth["(2) Buscar API_AUTH_CONFIG vinculada"]
    
    GetAuth --> CreateBatch["(3) Criar Registro em API_BATCHES com Snapshot"]
    
    CreateBatch --> AuthCheck{"(4) Token de Auth é válido?"}
    
    AuthCheck -- "Não ou Expirado" --> LoginCall["(5) Executar Login: BaseURL + Endpoint login"]
    LoginCall --> SaveToken["(6) Salvar Novo Token e Expiração no DB"]
    SaveToken --> ListCall
    
    AuthCheck -- "Sim" --> ListCall["(7) Executar Listagem: BaseURL + Endpoint fetch_operations"]
    
    ListCall --> SaveListLog["(8) Criar Log Individual da Listagem com JSON Bruto"]
    
    SaveListLog --> LoopStart{"(9) Existe Operação na Lista?"}
    
    LoopStart -- "Sim" --> DetailCall["(10) Executar Detalhes: BaseURL + Endpoint fetch_details + ID"]
    
    DetailCall --> SaveDetailLog["(11) Criar Log Individual do Detalhe com JSON Bruto"]
    
    SaveDetailLog --> MapData["(12) Mapear JSON para Tabelas de Pedidos Internas"]
    
    MapData --> LoopStart
    
    LoopStart -- "Não" --> FinishBatch["(13) Finalizar Batch: Status Sucesso ou Parcial"]
    
    FinishBatch --> End([Fim do Processamento])

    subgraph "Obtenção de Configuração"
    GetService
    GetAuth
    end

    subgraph "Ciclo de Coleta"
    ListCall
    SaveListLog
    LoopStart
    DetailCall
    SaveDetailLog
    MapData
    end
```

## Detalhes da Lógica de Configuração

### 1. Obtenção da Conexão
Diferente de uma conexão estática, o serviço agora é dinâmico:
- **Identificação**: O processo recebe um `service_id`.
- **Auth Config**: Através desse ID, o sistema busca na tabela `api_auth_configs` a `base_url`, as credenciais (`username`/`password`) e os headers globais (como o `Referer`).

### 2. Seleção de Endpoints
Os caminhos das APIs não estão "hardcoded" no código. Eles são lidos do campo JSONB `endpoints` da tabela `api_services`. O serviço busca as chaves específicas:
- `login`: Caminho para autenticação.
- `fetch_operations`: Caminho para listar as operações pendentes.
- `fetch_details`: Caminho para obter os itens de uma operação específica (usando o ID retornado na listagem).

### 3. Snapshot e Rastreabilidade
Ao iniciar o lote (`api_batches`), o sistema realiza um "JOIN" virtual e salva uma cópia de toda essa configuração (Auth + Service + Endpoints). Isso garante que, se alguém alterar a URL ou o path no futuro, o log de hoje ainda mostrará exatamente o que foi tentado.

---
**Documento atualizado em:** 2026-04-28
**Versão:** 1.1 (Convertido para Fluxograma)
