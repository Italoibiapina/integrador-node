import { ApiServiceRepository } from '../repositories/ApiServiceRepository.js';
import { ApiService, ApiEndpointConfig, ApiAuthConfig } from './apiIntegrationTypes.js';
import { buildQueryStringFromGetParams, mergeUrlWithQuery } from './util/paramsFormatter.js';
import { PowerStockAuthService, PowerStockAuthSession } from './PowerStockAuthService.js';
import { createHash } from 'node:crypto';

type AuthSession = PowerStockAuthSession;
type ExecuteServiceContext = {
  batchId?: string;
  executionId?: string;
};

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/^`+|`+$/g, '').trim();
}

function isApiEndpointConfig(value: unknown): value is ApiEndpointConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.path === 'string' &&
    (v.method === 'GET' || v.method === 'POST' || v.method === 'PUT' || v.method === 'DELETE');
}

export class PowerStockGetOperationsService {
  private readonly authService: PowerStockAuthService;

  constructor(private repository: ApiServiceRepository) {
    this.authService = new PowerStockAuthService(repository);
  }

  private toArray(value: unknown): any[] {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.$values)) return record.$values as any[];
      const numericKeys = Object.keys(record).filter((k) => /^\d+$/.test(k));
      if (numericKeys.length) {
        return numericKeys
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => (record as Record<string, unknown>)[k]);
      }
    }
    return [];
  }

  private stableStringify(value: unknown): string {
    const serialize = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map(serialize);
      if (!input || typeof input !== 'object') return input;
      const obj = input as Record<string, unknown>;
      const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
      const normalized: Record<string, unknown> = {};
      for (const key of sortedKeys) normalized[key] = serialize(obj[key]);
      return normalized;
    };
    return JSON.stringify(serialize(value));
  }

  private hashPayload(value: unknown): string {
    const normalized = this.stableStringify(value);
    return createHash('sha256').update(normalized).digest('hex');
  }

  private async persistVendasRawFromRegistros(
    registros: Array<{ idVendaExterno: string; payload: unknown }>
  ): Promise<{ inserted: number; discarded: number }> {
    let inserted = 0;
    let discarded = 0;

    for (const registro of registros) {
      const idVendaExterno = String(registro.idVendaExterno ?? '').trim();
      if (!idVendaExterno) continue;

      const hashPayload = this.hashPayload(registro.payload);
      const wasInserted = await this.repository.insertOperacaoRawIfChanged(idVendaExterno, registro.payload, hashPayload);
      if (wasInserted) inserted += 1;
      else discarded += 1;
    }

    return { inserted, discarded };
  }

  private extractOperationId(operation: unknown): string | null {
    if (!operation || typeof operation !== 'object') return null;
    const op = operation as Record<string, unknown>;
    return String(op.id ?? op.ID ?? op.codigo ?? '').trim() || null;
  }

  private buildDefaultDetailedPath(service: ApiService, operationId: string): string {
    const serviceEndpoint = service.endpoint_url?.trim();
    if (!serviceEndpoint) {
      return `/api/pedidoorcamentovenda/obter-detalhado?id=${encodeURIComponent(operationId)}`;
    }
    const origin = new URL(serviceEndpoint).origin;
    return `${origin}/api/pedidoorcamentovenda/obter-detalhado?id=${encodeURIComponent(operationId)}`;
  }

  private buildDetailEndpointConfig(
    service: ApiService,
    endpoints: Record<string, ApiEndpointConfig>,
    operationId: string
  ): ApiEndpointConfig {
    const configuredDetail = endpoints['fetch_details'];
    if (configuredDetail) {
      let detailPath = configuredDetail.path;
      if (detailPath.includes(':id') || detailPath.includes('{id}')) {
        detailPath = detailPath.replace(':id', operationId).replace('{id}', operationId);
      } else {
        detailPath = `${detailPath}${detailPath.includes('?') ? '&' : '?'}id=${encodeURIComponent(operationId)}`;
      }
      return { ...configuredDetail, method: 'GET', path: detailPath };
    }

    return {
      method: 'GET',
      path: this.buildDefaultDetailedPath(service, operationId),
    };
  }

  private extractDetailPayload(detailResponse: unknown): unknown {
    if (!detailResponse || typeof detailResponse !== 'object') return detailResponse;
    const responseObj = detailResponse as Record<string, unknown>;
    const dados = responseObj.dados;
    if (dados && typeof dados === 'object') return dados;
    return detailResponse;
  }

  private buildListUrlFromService(service: ApiService): string | null {
    const endpointUrl = service.endpoint_url?.trim();
    if (!endpointUrl) return null;

    const typedQueryString = buildQueryStringFromGetParams(service.get_params ?? [], {
      dateOutputFormat: 'YYYY-MM-DD',
      powerStockUtcRangeDateTime: true,
    });
    if (typedQueryString) {
      return mergeUrlWithQuery(endpointUrl, typedQueryString);
    }

    const rawParams = service.parametro_get?.trim();
    if (!rawParams) return endpointUrl;
    const normalizedParams = rawParams
      .split(/\r?\n/g)
      .map((line) => line.trim().replace(/^&+|&+$/g, ''))
      .filter(Boolean)
      .join('&');

    return mergeUrlWithQuery(endpointUrl, normalizedParams);
  }

  private resolveRequestUrl(auth: ApiAuthConfig, service: ApiService, endpointPath: string): string {
    if (/^https?:\/\//i.test(endpointPath)) return endpointPath;

    const serviceEndpoint = service.endpoint_url?.trim();
    if (serviceEndpoint && /^https?:\/\//i.test(serviceEndpoint)) {
      const baseOrigin = new URL(serviceEndpoint).origin;
      return new URL(endpointPath, baseOrigin).toString();
    }

    const authOrigin = new URL(auth.base_url).origin;
    return new URL(endpointPath, authOrigin).toString();
  }

  private getConfiguredEndpoints(service: ApiService): Record<string, ApiEndpointConfig> {
    const source = service.endpoints ?? service.parametros;
    if (!source || typeof source !== 'object') return {};

    const endpointMap: Record<string, ApiEndpointConfig> = {};
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (isApiEndpointConfig(value)) endpointMap[key] = value;
    }
    return endpointMap;
  }

  async executeService(
    serviceId: string,
    contextOrBatchId?: string | ExecuteServiceContext
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    const externalBatchId = typeof contextOrBatchId === 'string' ? contextOrBatchId : contextOrBatchId?.batchId;
    const externalExecutionId = typeof contextOrBatchId === 'string' ? undefined : contextOrBatchId?.executionId;

    const service = await this.repository.getServiceById(serviceId);
    if (!service) throw new Error('Serviço não encontrado');
    const endpoints = this.getConfiguredEndpoints(service);

    const auth = await this.repository.getAuthConfigById(service.auth_config_id);
    if (!auth) throw new Error('Configuração de autenticação não encontrada');

    // Início do Lote (Batch)
    const effectiveBatchId = externalBatchId || await this.repository.createBatch('manual', service);
    const rootExecutionId =
      externalExecutionId ||
      await this.repository.createServiceExecution({
        batch_id: effectiveBatchId,
        service_id: service.id,
        snapshot_config: { service: { ...service }, auth: { ...auth } },
        started_at: new Date(),
        status: 'running',
      });

    try {
      await this.repository.updateServiceStatus(serviceId, 'running');
      // 1. Garantir Autenticação
      const session = await this.authService.ensureAuthenticated(auth);

      // 2. ETAPA 1: Listagem de Operações (endpoint_url + parametro_get)
      const listUrl = this.buildListUrlFromService(service);
      const listConfig = listUrl
        ? ({ path: listUrl, method: 'GET' } as ApiEndpointConfig)
        : endpoints['fetch_operations'];
      if (!listConfig) throw new Error('Endpoint de listagem não configurado (endpoint_url ou fetch_operations)');

      const operationsResponse = await this.executeSubStep(
        effectiveBatchId,
        rootExecutionId,
        service,
        auth,
        listConfig,
        session,
        'Listagem de Operações'
      );

      // A API pode retornar lista direta ou encapsulada (data/dados/registros/items)
      const operations = this.toArray(
        Array.isArray(operationsResponse)
          ? operationsResponse
          : (
              operationsResponse?.dados?.registros ??
              operationsResponse?.data?.registros ??
              operationsResponse?.dados?.items ??
              operationsResponse?.data?.items ??
              operationsResponse?.dados ??
              operationsResponse?.data ??
              []
            )
      );

      if (!Array.isArray(operations)) {
        throw new Error('Resposta da listagem não é um array válido');
      }

      const results = [];
      let hasFailures = false;
      const rawEntries: Array<{ idVendaExterno: string; payload: unknown }> = [];

      // 3. ETAPA 2: Detalhes de cada Operação (obter-detalhado?id=<id>)
      for (const op of operations) {
        try {
          const opId = this.extractOperationId(op);
          if (!opId) continue;
          const detailConfig = this.buildDetailEndpointConfig(service, endpoints, opId);
          const detailResponse = await this.executeSubStep(
            effectiveBatchId,
            rootExecutionId,
            service,
            auth,
            detailConfig,
            session,
            `Detalhes da Operação: ${opId}`
          );

          results.push(detailResponse);
          const rawPayload = this.extractDetailPayload(detailResponse);
          rawEntries.push({ idVendaExterno: opId, payload: rawPayload });
        } catch (error) {
          console.error('Erro ao buscar detalhes da operação:', error);
          hasFailures = true;
        }
      }

      const rawPersistResult = await this.persistVendasRawFromRegistros(rawEntries);
      console.log('============================> operacoes_raw.persist:', {
        total_registros_listagem: operations.length,
        total_detalhes_processados: rawEntries.length,
        inseridos: rawPersistResult.inserted,
        descartados_hash_igual: rawPersistResult.discarded,
      });

      // Finalização do Lote
      const finalStatus = hasFailures ? 'partial' : 'success';
      await this.repository.updateServiceStatus(serviceId, 'idle', new Date());
      
      if (!externalBatchId) {
        await this.repository.finishBatch(effectiveBatchId, finalStatus, undefined, { 
          operations_count: operations.length,
          details_fetched: results.length,
          operacoes_raw_inserted: rawPersistResult.inserted,
          operacoes_raw_discarded: rawPersistResult.discarded
        });
      }
      await this.repository.finishServiceExecution(
        rootExecutionId,
        hasFailures ? 'failed' : 'success',
        new Date(),
        {
        operations_count: operations.length,
        details_fetched: results.length,
        operacoes_raw_inserted: rawPersistResult.inserted,
        operacoes_raw_discarded: rawPersistResult.discarded,
        },
        hasFailures ? 'Execução parcial: falha em uma ou mais etapas de detalhe.' : undefined
      );

      return {
        success: !hasFailures,
        data: {
          operations_count: operations.length,
          details_fetched: results.length,
          operacoes_raw_inserted: rawPersistResult.inserted,
          operacoes_raw_discarded: rawPersistResult.discarded
        }
      };

    } catch (error: any) {
      const errorMessage = error.message || 'Erro desconhecido na orquestração do serviço';
      await this.repository.updateServiceStatus(serviceId, 'error');

      if (!externalBatchId) {
        await this.repository.finishBatch(effectiveBatchId, 'failed', errorMessage);
      }
      await this.repository.finishServiceExecution(rootExecutionId, 'failed', new Date(), null, errorMessage);

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Executa uma sub-etapa (chamada de API) dentro de um lote, gerando seu próprio log/snapshot
   */
  private async executeSubStep(
    batchId: string,
    parentExecutionId: string,
    service: ApiService,
    auth: ApiAuthConfig,
    endpoint: ApiEndpointConfig,
    session: AuthSession,
    stepName: string
  ): Promise<any> {
    const executionId = await this.repository.createServiceExecution({
      batch_id: batchId,
      service_id: service.id,
      parent_execution_id: parentExecutionId,
      snapshot_config: {
        service: { ...service, name: `${service.name} - ${stepName}` },
        auth: { ...auth }
      },
      started_at: new Date(),
      status: 'running',
    });

    try {
      const response = await this.callApi(auth, service, endpoint, session);
      await this.repository.finishServiceExecution(executionId, 'success', new Date(), response);
      return response;
    } catch (error: any) {
      const errorMsg = error.message || `Erro na etapa: ${stepName}`;
      await this.repository.finishServiceExecution(executionId, 'failed', new Date(), null, errorMsg);
      throw error;
    }
  }

  private async callApi(auth: ApiAuthConfig, service: ApiService, endpoint: ApiEndpointConfig, session: AuthSession): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...auth.extra_headers,
    };
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') headers[key] = normalizeHeaderValue(value);
    }
    if (session.token) {
      headers.Authorization = `Bearer ${session.token}`;
    }
    if (session.cookie) {
      headers.Cookie = session.cookie;
    }
    if (session.lojaId) {
      headers.lojaid = session.lojaId;
    }

    const requestUrl = this.resolveRequestUrl(auth, service, endpoint.path);
    const debugHeaders: Record<string, string> = { ...headers };
    if (debugHeaders.Authorization) debugHeaders.Authorization = 'Bearer ***';
    if (debugHeaders.Cookie) debugHeaders.Cookie = '***';
    console.log('============================> callApi.request:', {
      method: endpoint.method,
      url: requestUrl,
      headers: debugHeaders,
      hasToken: Boolean(session.token),
      hasCookie: Boolean(session.cookie),
      lojaId: session.lojaId,
    });

    const response = await fetch(requestUrl, {
      method: endpoint.method,
      headers
    });

    const responseBodyText = await response.text();
    console.log('============================> callApi.response:', {
      status: response.status,
      statusText: response.statusText,
      url: requestUrl,
    });

    if (!response.ok) {
      console.log('============================> callApi.response.errorBody:', responseBodyText || '<vazio>');
      throw new Error(`Erro na chamada da API: ${response.status} ${response.statusText}. Body: ${responseBodyText || '<vazio>'}`);
    }

    if (!responseBodyText) {
      console.log('============================> callApi.response.successBody: <vazio>');
      return {};
    }

    try {
      const parsedBody = JSON.parse(responseBodyText);
      console.log('============================> callApi.response.successBody.pretty:\n', JSON.stringify(parsedBody, null, 2));
      if (Array.isArray(parsedBody)) {
        console.log('============================> callApi.response.successBody.items:');
        parsedBody.forEach((item, index) => {
          console.log(`  [${index}]`, JSON.stringify(item));
        });
      }
      return parsedBody;
    } catch {
      console.log('============================> callApi.response.successBody:', responseBodyText);
      return responseBodyText;
    }
  }
}
