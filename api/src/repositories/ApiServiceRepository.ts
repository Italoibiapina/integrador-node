import { Db } from '../db.js';
import { ApiService, ApiBatch, ApiServiceExecution, ApiAuthConfig, ApiServiceGetParam, SistemaDestinoConfig } from '../services/apiIntegrationTypes.js';

export class ApiServiceRepository {
  constructor(private db: Db) {}

  private isValidDateValue(value: string): boolean {
    if (!value) return true;
    const trimmed = value.trim();

    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?$/.exec(trimmed);
    if (ymdMatch) {
      const year = Number(ymdMatch[1]);
      const month = Number(ymdMatch[2]);
      const day = Number(ymdMatch[3]);
      const dt = new Date(Date.UTC(year, month - 1, day));
      return (
        dt.getUTCFullYear() === year &&
        dt.getUTCMonth() + 1 === month &&
        dt.getUTCDate() === day
      );
    }

    const dmyMatch = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s\d{2}:\d{2}(?::\d{2})?)?$/.exec(trimmed);
    if (dmyMatch) {
      const day = Number(dmyMatch[1]);
      const month = Number(dmyMatch[2]);
      const year = Number(dmyMatch[3]);
      const dt = new Date(Date.UTC(year, month - 1, day));
      return (
        dt.getUTCFullYear() === year &&
        dt.getUTCMonth() + 1 === month &&
        dt.getUTCDate() === day
      );
    }

    return Number.isFinite(new Date(trimmed).getTime());
  }

  private normalizeGetParams(params: unknown): ApiServiceGetParam[] {
    if (!Array.isArray(params)) return [];
    return params
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const name = typeof row.name === 'string' ? row.name.trim() : '';
        const valueTypeRaw = typeof row.value_type === 'string' ? row.value_type.trim().toLowerCase() : '';
        const valueType = valueTypeRaw === 'number' || valueTypeRaw === 'date' ? valueTypeRaw : 'text';
        const value = typeof row.value === 'string' ? row.value.trim() : String(row.value ?? '').trim();
        if (!name) return null;
        if (valueType === 'number' && value && !Number.isFinite(Number(value))) {
          throw new Error(`Parâmetro GET inválido: "${name}" deve ter valor numérico.`);
        }
        if (valueType === 'date' && value && !this.isValidDateValue(value)) {
          throw new Error(`Parâmetro GET inválido: "${name}" deve ter data válida.`);
        }
        return {
          name,
          value_type: valueType,
          value,
          sort_order: typeof row.sort_order === 'number' ? row.sort_order : index,
        } as ApiServiceGetParam;
      })
      .filter((item): item is ApiServiceGetParam => Boolean(item));
  }

  private async listServiceGetParams(serviceIds: string[]): Promise<Map<string, ApiServiceGetParam[]>> {
    const byService = new Map<string, ApiServiceGetParam[]>();
    if (!serviceIds.length) return byService;
    const result = await this.db.query<ApiServiceGetParam & { service_id: string }>(
      `SELECT id, service_id, name, value_type, value, sort_order
       FROM api_service_get_params
       WHERE service_id = ANY($1::uuid[])
       ORDER BY service_id, sort_order, created_at`,
      [serviceIds]
    );
    for (const row of result.rows) {
      const arr = byService.get(row.service_id) ?? [];
      arr.push({
        id: row.id,
        service_id: row.service_id,
        name: row.name,
        value_type: row.value_type,
        value: row.value,
        sort_order: row.sort_order,
      });
      byService.set(row.service_id, arr);
    }
    return byService;
  }

  private async replaceServiceGetParams(client: { query: Db['query'] }, serviceId: string, params: ApiServiceGetParam[]): Promise<void> {
    await client.query('DELETE FROM api_service_get_params WHERE service_id = $1', [serviceId]);
    for (let i = 0; i < params.length; i += 1) {
      const param = params[i]!;
      await client.query(
        `INSERT INTO api_service_get_params (service_id, name, value_type, value, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [serviceId, param.name, param.value_type, param.value, param.sort_order ?? i]
      );
    }
  }

  // --- Services ---

  async listServices(): Promise<ApiService[]> {
    const result = await this.db.query<ApiService>('SELECT * FROM api_services ORDER BY created_at DESC');
    const services = result.rows;
    const paramsByService = await this.listServiceGetParams(services.map((s) => s.id));
    return services.map((service) => ({ ...service, get_params: paramsByService.get(service.id) ?? [] }));
  }

  async getServiceById(id: string): Promise<ApiService | null> {
    const result = await this.db.query<ApiService>('SELECT * FROM api_services WHERE id = $1', [id]);
    const service = result.rows[0] || null;
    if (!service) return null;
    const paramsByService = await this.listServiceGetParams([service.id]);
    return { ...service, get_params: paramsByService.get(service.id) ?? [] };
  }

  async getServiceByServiceName(serviceName: string): Promise<ApiService | null> {
    const result = await this.db.query<ApiService>(
      `SELECT * FROM api_services
       WHERE service_name = $1
       ORDER BY is_active DESC, updated_at DESC
       LIMIT 1`,
      [serviceName]
    );
    const service = result.rows[0] || null;
    if (!service) return null;
    const paramsByService = await this.listServiceGetParams([service.id]);
    return { ...service, get_params: paramsByService.get(service.id) ?? [] };
  }

  async createService(data: Partial<ApiService>): Promise<ApiService> {
    const parametros = data.parametros ?? data.endpoints;
    const getParams = this.normalizeGetParams(data.get_params);
    const row = await this.db.tx<ApiService>(async (client) => {
      const result = await client.query<ApiService>(
        `INSERT INTO api_services (name, description, auth_config_id, endpoint_url, service_name, parametro_get, parametros, is_active, current_status, last_run_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          data.name,
          data.description,
          data.auth_config_id,
          data.endpoint_url ?? null,
          data.service_name ?? null,
          data.parametro_get ?? null,
          parametros ? JSON.stringify(parametros) : null,
          data.is_active ?? true,
          data.current_status ?? 'idle',
          data.last_run_at ?? null,
        ]
      );
      const created = result.rows[0];
      if (!created) throw new Error('Falha ao criar serviço');
      await this.replaceServiceGetParams(client as unknown as { query: Db['query'] }, created.id, getParams);
      return created;
    });
    return { ...row, get_params: getParams };
  }

  async updateService(id: string, data: Partial<ApiService>): Promise<ApiService | null> {
    const parametros = data.parametros ?? data.endpoints;
    const hasParametros = Object.prototype.hasOwnProperty.call(data, 'parametros') ||
      Object.prototype.hasOwnProperty.call(data, 'endpoints');
    const hasGetParams = Object.prototype.hasOwnProperty.call(data, 'get_params');
    const getParams = this.normalizeGetParams(data.get_params);
    return await this.db.tx<ApiService | null>(async (client) => {
      const result = await client.query<ApiService>(
        `UPDATE api_services 
         SET name = COALESCE($2, name), 
             description = COALESCE($3, description), 
             auth_config_id = COALESCE($4, auth_config_id), 
             endpoint_url = COALESCE($5, endpoint_url),
             service_name = COALESCE($6, service_name),
             parametro_get = COALESCE($7, parametro_get),
             parametros = CASE WHEN $8 THEN $9 ELSE parametros END,
             is_active = COALESCE($10, is_active),
             current_status = COALESCE($11, current_status),
             last_run_at = COALESCE($12, last_run_at),
             updated_at = now()
         WHERE id = $1 RETURNING *`,
        [
          id,
          data.name,
          data.description,
          data.auth_config_id,
          data.endpoint_url,
          data.service_name,
          data.parametro_get,
          hasParametros,
          parametros ? JSON.stringify(parametros) : null,
          data.is_active,
          data.current_status,
          data.last_run_at,
        ]
      );
      const updated = result.rows[0] || null;
      if (!updated) return null;
      if (hasGetParams) {
        await this.replaceServiceGetParams(client as unknown as { query: Db['query'] }, id, getParams);
        updated.get_params = getParams;
      } else {
        const paramsByService = await this.listServiceGetParams([id]);
        updated.get_params = paramsByService.get(id) ?? [];
      }
      return updated;
    });
  }

  async deleteService(id: string): Promise<boolean> {
    const result = await this.db.query('DELETE FROM api_services WHERE id = $1 RETURNING id', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async updateServiceStatus(id: string, status: ApiService['current_status'], lastRun?: Date): Promise<void> {
    const query = lastRun 
      ? 'UPDATE api_services SET current_status = $2, last_run_at = $3, updated_at = now() WHERE id = $1'
      : 'UPDATE api_services SET current_status = $2, updated_at = now() WHERE id = $1';
    
    const params = lastRun ? [id, status, lastRun] : [id, status];
    await this.db.query(query, params);
  }

  async insertOperacaoRawIfChanged(idVendaExterno: string, payload: unknown, hashPayload: string): Promise<boolean> {
    const result = await this.db.query<{ id: number }>(
      `WITH ultimo AS (
         SELECT hash_payload
         FROM operacoes_raw
         WHERE id_venda_externo = $1
         ORDER BY data_extracao DESC, id DESC
         LIMIT 1
       )
       INSERT INTO operacoes_raw (id_venda_externo, payload, hash_payload, status_processamento)
       SELECT $1, $2::jsonb, $3, 'pendente'
       WHERE NOT EXISTS (
         SELECT 1
         FROM ultimo
         WHERE ultimo.hash_payload = $3
       )
       RETURNING id`,
      [idVendaExterno, JSON.stringify(payload), hashPayload]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // --- Auth Configs ---

  async listAuthConfigs(): Promise<ApiAuthConfig[]> {
    const result = await this.db.query<ApiAuthConfig>('SELECT * FROM api_auth_configs ORDER BY created_at DESC');
    return result.rows;
  }

  async getAuthConfigById(id: string): Promise<ApiAuthConfig | null> {
    const result = await this.db.query<ApiAuthConfig>('SELECT * FROM api_auth_configs WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async createAuthConfig(data: Partial<ApiAuthConfig>): Promise<ApiAuthConfig> {
    const result = await this.db.query<ApiAuthConfig>(
      `INSERT INTO api_auth_configs (name, auth_type, base_url, username, password, extra_headers)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        data.name,
        data.auth_type ?? 'bearer',
        data.base_url,
        data.username,
        data.password,
        data.extra_headers ? JSON.stringify(data.extra_headers) : '{}',
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar configuração de autenticação');
    return row;
  }

  async updateAuthConfig(id: string, data: Partial<ApiAuthConfig>): Promise<ApiAuthConfig | null> {
    const result = await this.db.query<ApiAuthConfig>(
      `UPDATE api_auth_configs 
       SET name = COALESCE($2, name), 
           auth_type = COALESCE($3, auth_type),
           base_url = COALESCE($4, base_url), 
           username = COALESCE($5, username), 
           password = COALESCE($6, password), 
           extra_headers = COALESCE($7, extra_headers),
           updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        data.name,
        data.auth_type,
        data.base_url,
        data.username,
        data.password,
        data.extra_headers ? JSON.stringify(data.extra_headers) : null,
      ]
    );
    return result.rows[0] || null;
  }

  async deleteAuthConfig(id: string): Promise<boolean> {
    const result = await this.db.query('DELETE FROM api_auth_configs WHERE id = $1 RETURNING id', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async updateAuthToken(id: string, token: string, expiresAt?: Date): Promise<void> {
    await this.db.query(
      'UPDATE api_auth_configs SET last_token = $2, token_expires_at = $3, updated_at = now() WHERE id = $1',
      [id, token, expiresAt]
    );
  }

  // --- Sistema Destino Config ---

  async listSistemaDestinoConfigs(): Promise<SistemaDestinoConfig[]> {
    const result = await this.db.query<SistemaDestinoConfig>(
      'SELECT * FROM sistema_destino_config ORDER BY criado_em DESC, id DESC'
    );
    return result.rows;
  }

  async getSistemaDestinoConfigById(id: number): Promise<SistemaDestinoConfig | null> {
    const result = await this.db.query<SistemaDestinoConfig>(
      'SELECT * FROM sistema_destino_config WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async createSistemaDestinoConfig(data: Partial<SistemaDestinoConfig>): Promise<SistemaDestinoConfig> {
    const result = await this.db.query<SistemaDestinoConfig>(
      `INSERT INTO sistema_destino_config
       (nome, tabela_origem, entidade_view, endpoint_url, metodo, ativo, conexao_api_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        data.nome,
        data.tabela_origem,
        data.entidade_view,
        data.endpoint_url,
        data.metodo ?? 'POST',
        data.ativo ?? true,
        data.conexao_api_id,
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar configuração de sistema destino');
    return row;
  }

  async updateSistemaDestinoConfig(id: number, data: Partial<SistemaDestinoConfig>): Promise<SistemaDestinoConfig | null> {
    const result = await this.db.query<SistemaDestinoConfig>(
      `UPDATE sistema_destino_config
       SET nome = COALESCE($2, nome),
           tabela_origem = COALESCE($3, tabela_origem),
           entidade_view = COALESCE($4, entidade_view),
           endpoint_url = COALESCE($5, endpoint_url),
           metodo = COALESCE($6, metodo),
           ativo = COALESCE($7, ativo),
           conexao_api_id = COALESCE($8, conexao_api_id)
       WHERE id = $1
       RETURNING *`,
      [
        id,
        data.nome,
        data.tabela_origem,
        data.entidade_view,
        data.endpoint_url,
        data.metodo,
        data.ativo,
        data.conexao_api_id,
      ]
    );
    return result.rows[0] || null;
  }

  async deleteSistemaDestinoConfig(id: number): Promise<boolean> {
    const result = await this.db.query('DELETE FROM sistema_destino_config WHERE id = $1 RETURNING id', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  // --- Batches (Execução Total) ---

  async listBatches(filter: { serviceId?: string; status?: string; limit?: number; offset?: number }): Promise<ApiBatch[]> {
    const where: string[] = [];
    const params: any[] = [];
    
    if (filter.serviceId) {
      params.push(filter.serviceId);
      where.push(
        `EXISTS (
          SELECT 1
          FROM api_service_executions ex
          WHERE ex.batch_id = api_batches.id
            AND ex.service_id = $${params.length}::uuid
        )`
      );
    }

    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }

    const limit = filter.limit || 50;
    const offset = filter.offset || 0;
    params.push(limit, offset);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await this.db.query<ApiBatch>(
      `SELECT * FROM api_batches ${whereSql} ORDER BY started_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return result.rows;
  }

  async getBatch(id: string): Promise<ApiBatch | null> {
    const result = await this.db.query<ApiBatch>('SELECT * FROM api_batches WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async createBatch(triggerType: 'manual' | 'scheduled' = 'manual', snapshot?: Partial<ApiService>): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO api_batches 
       (trigger_type, name, description, is_active, endpoints, auth_config_id) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        triggerType, 
        snapshot?.name, 
        snapshot?.description, 
        snapshot?.is_active, 
        (snapshot?.parametros ?? snapshot?.endpoints) ? JSON.stringify(snapshot?.parametros ?? snapshot?.endpoints) : null,
        snapshot?.auth_config_id
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar lote de execução');
    return row.id;
  }

  async finishBatch(id: string, status: ApiBatch['status'], errorMessage?: string, rawResponse?: any): Promise<void> {
    await this.db.query(
      'UPDATE api_batches SET status = $2, error_message = $3, raw_response = $4, finished_at = now() WHERE id = $1',
      [id, status, errorMessage, rawResponse ? JSON.stringify(rawResponse) : null]
    );
  }

  // --- Execuções de Serviço (Logs com Snapshot) ---

  async listExecutionsByBatch(batchId: string): Promise<ApiServiceExecution[]> {
    const integratorRoots = await this.db.query<{ id: string }>(
      `SELECT id
       FROM api_service_executions
       WHERE batch_id = $1
         AND parent_execution_id IS NULL
         AND snapshot_config->'service'->>'service_name' = 'IntegradorOperacoesLojaDoPowerStockService'
       ORDER BY started_at ASC`,
      [batchId]
    );

    let result;
    if ((integratorRoots.rowCount ?? 0) > 0) {
      const parentIds = integratorRoots.rows.map((r) => r.id);
      result = await this.db.query<ApiServiceExecution>(
        `SELECT * FROM api_service_executions
         WHERE batch_id = $1
           AND parent_execution_id = ANY($2::uuid[])
         ORDER BY started_at ASC`,
        [batchId, parentIds]
      );
    } else {
      result = await this.db.query<ApiServiceExecution>(
        `SELECT * FROM api_service_executions
         WHERE batch_id = $1
           AND parent_execution_id IS NULL
         ORDER BY started_at ASC`,
        [batchId]
      );
    }
    return result.rows;
  }

  async listExecutionDetails(parentExecutionId: string): Promise<ApiServiceExecution[]> {
    const result = await this.db.query<ApiServiceExecution>(
      `SELECT * FROM api_service_executions
       WHERE parent_execution_id = $1
       ORDER BY started_at ASC`,
      [parentExecutionId]
    );
    return result.rows;
  }

  async createServiceExecution(execution: Omit<ApiServiceExecution, 'id' | 'created_at'>): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO api_service_executions 
       (batch_id, service_id, parent_execution_id, snapshot_config, started_at, status, error_message, raw_response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        execution.batch_id, 
        execution.service_id, 
        execution.parent_execution_id ?? null,
        JSON.stringify(execution.snapshot_config), 
        execution.started_at, 
        execution.status, 
        execution.error_message, 
        execution.raw_response
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Falha ao criar log de execução do serviço');
    return row.id;
  }

  async finishServiceExecution(
    id: string, 
    status: ApiServiceExecution['status'], 
    finishedAt: Date, 
    rawResponse?: any, 
    errorMessage?: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE api_service_executions 
       SET status = $2, finished_at = $3, raw_response = $4, error_message = $5 
       WHERE id = $1`,
      [id, status, finishedAt, rawResponse, errorMessage]
    );
  }
}
