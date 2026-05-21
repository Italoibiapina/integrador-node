import { ApiServiceRepository } from '../repositories/ApiServiceRepository.js';
import { ApiService, ApiEndpointConfig, ApiAuthConfig } from './apiIntegrationTypes.js';
import { buildQueryStringFromGetParams, mergeUrlWithQuery } from './util/paramsFormatter.js';
import { PowerStockAuthService, PowerStockAuthSession } from './PowerStockAuthService.js';
import { createHash } from 'node:crypto';

type AuthSession = PowerStockAuthSession;
type ExecuteServiceContext = {
  batchId?: string;
  executionId?: string;
  dataEmissaoInicio?: string | Date;
  dataEmissaoFim?: string | Date;
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

function setLocalTime(baseDate: Date, hours: number, minutes: number): Date {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hours,
    minutes,
    0,
    0
  );
}

function parseLocalDateInput(value: string): Date | null {
  const trimmed = value.trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (ymd) {
    return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 0, 0, 0, 0);
  }
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (dmy) {
    return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), 0, 0, 0, 0);
  }
  return null;
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
    registros: Array<{ idVendaExterno: string; payload: unknown }>,
    sourceServiceId: string
  ): Promise<{ inserted: number; discarded: number }> {
    let inserted = 0;
    let discarded = 0;

    for (const registro of registros) {
      const idVendaExterno = String(registro.idVendaExterno ?? '').trim();
      if (!idVendaExterno) continue;

      const hashPayload = this.hashPayload(registro.payload);
      const rawId = await this.repository.insertOperacaoRawIfChanged(
        idVendaExterno,
        registro.payload,
        hashPayload,
        sourceServiceId
      );
      if (rawId) {
        inserted += 1;
        await this.repository.processOperacaoRaw(rawId);
      } else {
        discarded += 1;
      }
    }

    return { inserted, discarded };
  }

  private extractOperationId(operation: unknown): string | null {
    if (!operation || typeof operation !== 'object') return null;
    const op = operation as Record<string, unknown>;
    return String(op.id ?? op.ID ?? op.codigo ?? '').trim() || null;
  }

  private buildDefaultDetailedPath(service: ApiService, operationId: string, baseUrlOverride?: string): string {
    const serviceEndpoint = baseUrlOverride?.trim() || service.endpoint_url?.trim();
    if (!serviceEndpoint || !/^https?:\/\//i.test(serviceEndpoint)) {
      return `/api/pedidoorcamentovenda/obter-detalhado?id=${encodeURIComponent(operationId)}`;
    }
    const origin = new URL(serviceEndpoint).origin;
    return `${origin}/api/pedidoorcamentovenda/obter-detalhado?id=${encodeURIComponent(operationId)}`;
  }

  private buildDetailEndpointConfig(
    service: ApiService,
    endpoints: Record<string, ApiEndpointConfig>,
    operationId: string,
    baseUrlOverride?: string
  ): ApiEndpointConfig {
    const configuredDetail = endpoints['fetch_details'];
    if (configuredDetail) {
      let detailPath = configuredDetail.path;
      if (detailPath.includes(':id') || detailPath.includes('{id}')) {
        detailPath = detailPath.replace(':id', operationId).replace('{id}', operationId);
      } else {
        detailPath = `${detailPath}${detailPath.includes('?') ? '&' : '?'}id=${encodeURIComponent(operationId)}`;
      }
      if (baseUrlOverride) {
        try {
          const baseOrigin = new URL(baseUrlOverride).origin;
          if (/^https?:\/\//i.test(detailPath)) {
            const current = new URL(detailPath);
            detailPath = `${baseOrigin}${current.pathname}${current.search}${current.hash}`;
          } else {
            detailPath = new URL(detailPath, baseOrigin).toString();
          }
        } catch {
          // mantém path original se base alternativa estiver inválida
        }
      }
      return { ...configuredDetail, method: 'GET', path: detailPath };
    }

    return {
      method: 'GET',
      path: this.buildDefaultDetailedPath(service, operationId, baseUrlOverride),
    };
  }

  private extractDetailPayload(detailResponse: unknown): unknown {
    if (!detailResponse || typeof detailResponse !== 'object') return detailResponse;
    const responseObj = detailResponse as Record<string, unknown>;
    const dados = responseObj.dados;
    if (dados && typeof dados === 'object') return dados;
    return detailResponse;
  }

  private getAlternativeBaseUrl(service: ApiService): string | null {
    return (service.base_url_alternativa ?? '').trim() || null;
  }

  private buildEndpointUrlFromBase(service: ApiService, alternativeBaseUrl: string): string | null {
    const current = service.endpoint_url?.trim();
    if (!current) return null;
    try {
      if (/^https?:\/\//i.test(current)) {
        const parsed = new URL(current);
        return new URL(`${parsed.pathname}${parsed.search}`, alternativeBaseUrl).toString();
      }
      return new URL(current, alternativeBaseUrl).toString();
    } catch {
      return null;
    }
  }

  private resolveRangeDateInput(
    value: string | Date | undefined,
    boundary: 'start' | 'end'
  ): Date {
    if (!value) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return boundary === 'start'
        ? setLocalTime(yesterday, 0, 0)
        : setLocalTime(yesterday, 23, 59);
    }

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new Error(`Data inválida para ${boundary === 'start' ? 'dataEmissaoInicio' : 'dataEmissaoFim'}.`);
      }
      return new Date(value.getTime());
    }

    const raw = String(value).trim();
    if (!raw) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return boundary === 'start'
        ? setLocalTime(yesterday, 0, 0)
        : setLocalTime(yesterday, 23, 59);
    }

    const dateOnly = parseLocalDateInput(raw);
    if (dateOnly) {
      return boundary === 'start'
        ? setLocalTime(dateOnly, 0, 0)
        : setLocalTime(dateOnly, 23, 59);
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Data inválida para ${boundary === 'start' ? 'dataEmissaoInicio' : 'dataEmissaoFim'}: ${raw}`);
    }
    return parsed;
  }

  private buildDateRangeParams(context?: ExecuteServiceContext): { dataEmissaoInicio: string; dataEmissaoFim: string } {
    const startDate = this.resolveRangeDateInput(context?.dataEmissaoInicio, 'start');
    const endDate = this.resolveRangeDateInput(context?.dataEmissaoFim, 'end');
    if (startDate.getTime() > endDate.getTime()) {
      throw new Error('dataEmissaoInicio não pode ser maior que dataEmissaoFim.');
    }
    return {
      dataEmissaoInicio: startDate.toISOString(),
      dataEmissaoFim: endDate.toISOString(),
    };
  }

  private buildListUrlFromService(
    service: ApiService,
    dateRangeParams: { dataEmissaoInicio: string; dataEmissaoFim: string },
    endpointOverride?: string
  ): string | null {
    const endpointUrl = endpointOverride?.trim() || service.endpoint_url?.trim();
    if (!endpointUrl) return null;

    const filteredGetParams = (service.get_params ?? []).filter((param) => {
      const normalized = String(param?.name ?? '').trim().toLowerCase();
      return (
        normalized !== 'dataemissaoinicio' &&
        normalized !== 'dataemissaofim' &&
        normalized !== 'url-base-alternativa' &&
        normalized !== 'urlbasealternativa' &&
        normalized !== 'url_base_alternativa' &&
        normalized !== 'url-alternativa' &&
        normalized !== 'urlalternativa' &&
        normalized !== 'url_alternativa'
      );
    });

    const typedQueryString = buildQueryStringFromGetParams(filteredGetParams, {
      dateOutputFormat: 'YYYY-MM-DD',
      powerStockUtcRangeDateTime: true,
    });
    let listUrl = typedQueryString
      ? mergeUrlWithQuery(endpointUrl, typedQueryString)
      : endpointUrl;

    const rawParams = service.parametro_get?.trim();
    if (rawParams) {
      const normalizedParams = rawParams
        .split(/\r?\n/g)
        .map((line) => line.trim().replace(/^&+|&+$/g, ''))
        .filter(Boolean)
        .filter((line) => {
          const key = line.split('=', 1)[0]?.trim().toLowerCase();
          return (
            key !== 'dataemissaoinicio' &&
            key !== 'dataemissaofim' &&
            key !== 'url-base-alternativa' &&
            key !== 'urlbasealternativa' &&
            key !== 'url_base_alternativa' &&
            key !== 'url-alternativa' &&
            key !== 'urlalternativa' &&
            key !== 'url_alternativa'
          );
        })
        .join('&');
      if (normalizedParams) {
        listUrl = mergeUrlWithQuery(listUrl, normalizedParams);
      }
    }

    return mergeUrlWithQuery(
      listUrl,
      `dataEmissaoInicio=${encodeURIComponent(dateRangeParams.dataEmissaoInicio)}&dataEmissaoFim=${encodeURIComponent(dateRangeParams.dataEmissaoFim)}`
    );
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
    const executionContext = typeof contextOrBatchId === 'string' ? undefined : contextOrBatchId;
    const dateRangeParams = this.buildDateRangeParams(executionContext);

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
      const listUrl = this.buildListUrlFromService(service, dateRangeParams);
      const alternativeBaseUrl = this.getAlternativeBaseUrl(service);
      const alternativeEndpointUrl = alternativeBaseUrl
        ? this.buildEndpointUrlFromBase(service, alternativeBaseUrl)
        : null;
      const alternativeListUrl = alternativeEndpointUrl
        ? this.buildListUrlFromService(service, dateRangeParams, alternativeEndpointUrl)
        : null;
      console.log('============================> listagem.urls.resolvidas', {
        endpointPrincipal: service.endpoint_url ?? null,
        baseAlternativa: alternativeBaseUrl ?? null,
        endpointAlternativo: alternativeEndpointUrl ?? null,
        listUrl,
        alternativeListUrl,
      });
      const listConfig = listUrl
        ? ({ path: listUrl, method: 'GET' } as ApiEndpointConfig)
        : endpoints['fetch_operations'];
      if (!listConfig) throw new Error('Endpoint de listagem não configurado (endpoint_url ou fetch_operations)');

      let operationsResponse: any;
      try {
        console.log('============================> listagem.tentativa.primaria', {
          url: listConfig.path,
        });
        operationsResponse = await this.executeSubStep(
          effectiveBatchId,
          rootExecutionId,
          service,
          auth,
          listConfig,
          session,
          'Listagem de Operações'
        );
        console.log('============================> listagem.tentativa.primaria.ok', {
          url: listConfig.path,
        });
      } catch (primaryError) {
        console.log('============================> listagem.tentativa.primaria.erro', {
          url: listConfig.path,
          reason: primaryError instanceof Error ? primaryError.message : String(primaryError),
        });
        if (!alternativeListUrl || alternativeListUrl === listUrl) {
          console.log('============================> listagem.fallback.nao_utilizado', {
            motivo: !alternativeListUrl ? 'url-alternativa ausente' : 'url-alternativa igual a principal',
            alternativeListUrl,
          });
          throw primaryError;
        }
        console.log('============================> listagem.retry.url_alternativa', {
          primaryUrl: listUrl,
          alternativeUrl: alternativeListUrl,
          reason: primaryError instanceof Error ? primaryError.message : String(primaryError),
        });
        try {
          operationsResponse = await this.executeSubStep(
            effectiveBatchId,
            rootExecutionId,
            service,
            auth,
            { path: alternativeListUrl, method: 'GET' } as ApiEndpointConfig,
            session,
            'Listagem de Operações (url-alternativa)'
          );
          console.log('============================> listagem.retry.url_alternativa.ok', {
            url: alternativeListUrl,
          });
        } catch (fallbackError) {
          console.log('============================> listagem.retry.url_alternativa.erro', {
            url: alternativeListUrl,
            reason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          throw fallbackError;
        }
      }

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
          let detailResponse: any;
          try {
            detailResponse = await this.executeSubStep(
              effectiveBatchId,
              rootExecutionId,
              service,
              auth,
              detailConfig,
              session,
              `Detalhes da Operação: ${opId}`
            );
          } catch (detailPrimaryError) {
            if (!alternativeBaseUrl) throw detailPrimaryError;
            const fallbackDetailConfig = this.buildDetailEndpointConfig(service, endpoints, opId, alternativeBaseUrl);
            console.log('============================> detalhes.retry.url_base_alternativa', {
              operacaoId: opId,
              primaryUrl: detailConfig.path,
              fallbackUrl: fallbackDetailConfig.path,
              reason: detailPrimaryError instanceof Error ? detailPrimaryError.message : String(detailPrimaryError),
            });
            detailResponse = await this.executeSubStep(
              effectiveBatchId,
              rootExecutionId,
              service,
              auth,
              fallbackDetailConfig,
              session,
              `Detalhes da Operação (url-base-alternativa): ${opId}`
            );
          }

          results.push(detailResponse);
          const rawPayload = this.extractDetailPayload(detailResponse);
          rawEntries.push({ idVendaExterno: opId, payload: rawPayload });
        } catch (error) {
          console.error('Erro ao buscar detalhes da operação:', error);
          hasFailures = true;
        }
      }

      const rawPersistResult = await this.persistVendasRawFromRegistros(rawEntries, service.id);
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
          dataEmissaoInicio: dateRangeParams.dataEmissaoInicio,
          dataEmissaoFim: dateRangeParams.dataEmissaoFim,
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
          dataEmissaoInicio: dateRangeParams.dataEmissaoInicio,
          dataEmissaoFim: dateRangeParams.dataEmissaoFim,
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
        await this.repository.finishBatch(effectiveBatchId, 'failed', errorMessage, {
          dataEmissaoInicio: dateRangeParams.dataEmissaoInicio,
          dataEmissaoFim: dateRangeParams.dataEmissaoFim,
        });
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
    const requestUrl = this.resolveRequestUrl(auth, service, endpoint.path);
    const buildHeaders = (currentSession: AuthSession): Record<string, string> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...auth.extra_headers,
      };
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') headers[key] = normalizeHeaderValue(value);
      }
      if (currentSession.token) headers.Authorization = `Bearer ${currentSession.token}`;
      if (currentSession.cookie) headers.Cookie = currentSession.cookie;
      if (currentSession.lojaId) headers.lojaid = currentSession.lojaId;
      return headers;
    };

    const doRequest = async (currentSession: AuthSession, attempt: number) => {
      const headers = buildHeaders(currentSession);
      const debugHeaders: Record<string, string> = { ...headers };
      if (debugHeaders.Authorization) debugHeaders.Authorization = 'Bearer ***';
      if (debugHeaders.Cookie) debugHeaders.Cookie = '***';
      console.log('============================> callApi.request:', {
        attempt,
        method: endpoint.method,
        url: requestUrl,
        headers: debugHeaders,
        hasToken: Boolean(currentSession.token),
        hasCookie: Boolean(currentSession.cookie),
        lojaId: currentSession.lojaId,
      });

      const response = await fetch(requestUrl, {
        method: endpoint.method,
        headers
      });
      const responseBodyText = await response.text();
      console.log('============================> callApi.response:', {
        attempt,
        status: response.status,
        statusText: response.statusText,
        url: requestUrl,
      });
      return { response, responseBodyText };
    };

    const parseOkBody = (responseBodyText: string): any => {
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
    };

    const first = await doRequest(session, 1);
    if (first.response.ok) return parseOkBody(first.responseBodyText);

    console.log('============================> callApi.response.errorBody:', first.responseBodyText || '<vazio>');
    if (first.response.status === 401) {
      console.log('============================> callApi.unauthorized.retry_auth', {
        url: requestUrl,
        method: endpoint.method,
      });
      const refreshed = await this.authService.ensureAuthenticated(auth, { force: true });
      const second = await doRequest(refreshed, 2);
      if (second.response.ok) return parseOkBody(second.responseBodyText);
      console.log('============================> callApi.response.errorBody:', second.responseBodyText || '<vazio>');
      throw new Error(`Erro na chamada da API: ${second.response.status} ${second.response.statusText}. Body: ${second.responseBodyText || '<vazio>'}`);
    }

    throw new Error(`Erro na chamada da API: ${first.response.status} ${first.response.statusText}. Body: ${first.responseBodyText || '<vazio>'}`);
  }
}
