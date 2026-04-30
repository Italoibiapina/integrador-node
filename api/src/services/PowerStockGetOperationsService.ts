import { ApiServiceRepository } from '../repositories/ApiServiceRepository.js';
import { ApiService, ApiEndpointConfig, ApiAuthConfig } from './apiIntegrationTypes.js';
import { buildQueryStringFromGetParams, mergeUrlWithQuery } from './util/paramsFormatter.js';

type AuthSession = {
  token?: string;
  cookie?: string;
  lojaId?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  constructor(private repository: ApiServiceRepository) {}

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

  async executeService(serviceId: string, batchId?: string): Promise<{ success: boolean; data?: any; error?: string }> {

    const service = await this.repository.getServiceById(serviceId);
    if (!service) throw new Error('Serviço não encontrado');
    const endpoints = this.getConfiguredEndpoints(service);

    const auth = await this.repository.getAuthConfigById(service.auth_config_id);
    if (!auth) throw new Error('Configuração de autenticação não encontrada');

    // Início do Lote (Batch)
    const effectiveBatchId = batchId || await this.repository.createBatch('manual', service);

    try {
      await this.repository.updateServiceStatus(serviceId, 'running');
      // 1. Garantir Autenticação
      const session = await this.ensureAuthenticated(auth, service);

      // 2. ETAPA 1: Listagem de Operações (endpoint_url + parametro_get)
      const listUrl = this.buildListUrlFromService(service);
      const listConfig = listUrl
        ? ({ path: listUrl, method: 'GET' } as ApiEndpointConfig)
        : endpoints['fetch_operations'];
      if (!listConfig) throw new Error('Endpoint de listagem não configurado (endpoint_url ou fetch_operations)');

      const operationsResponse = await this.executeSubStep(
        effectiveBatchId,
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

      // 3. ETAPA 2: Detalhes de cada Operação (fetch_details)
      const detailConfig = endpoints['fetch_details'];
      const results = [];
      let hasFailures = false;

      if (detailConfig) {
        for (const op of operations) {
          try {
            // Substitui placeholder :id ou {id} na URL se existir
            const opId = op.id || op.ID || op.codigo;
            if (!opId) continue;

            const specificDetailConfig: ApiEndpointConfig = {
              ...detailConfig,
              path: detailConfig.path.replace(':id', opId).replace('{id}', opId)
            };

            const detailResponse = await this.executeSubStep(
              effectiveBatchId,
              service,
              auth,
              specificDetailConfig,
              session,
              `Detalhes da Operação: ${opId}`
            );

            results.push(detailResponse);
            
            // TODO: Aqui entraria o MapData para as tabelas internas
            // await this.mapToInternalTables(detailResponse);

          } catch (error) {
            console.error(`Erro ao buscar detalhes da operação:`, error);
            hasFailures = true;
          }
        }
      }

      // Finalização do Lote
      const finalStatus = hasFailures ? 'partial' : 'success';
      await this.repository.updateServiceStatus(serviceId, 'idle', new Date());
      
      if (!batchId) {
        await this.repository.finishBatch(effectiveBatchId, finalStatus, undefined, { 
          operations_count: operations.length,
          details_fetched: results.length
        });
      }

      return { success: !hasFailures, data: { operations_count: operations.length, details_fetched: results.length } };

    } catch (error: any) {
      const errorMessage = error.message || 'Erro desconhecido na orquestração do serviço';
      await this.repository.updateServiceStatus(serviceId, 'error');

      if (!batchId) {
        await this.repository.finishBatch(effectiveBatchId, 'failed', errorMessage);
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Executa uma sub-etapa (chamada de API) dentro de um lote, gerando seu próprio log/snapshot
   */
  private async executeSubStep(
    batchId: string,
    service: ApiService,
    auth: ApiAuthConfig,
    endpoint: ApiEndpointConfig,
    session: AuthSession,
    stepName: string
  ): Promise<any> {
    const executionId = await this.repository.createServiceExecution({
      batch_id: batchId,
      service_id: service.id,
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

  private async ensureAuthenticated(auth: ApiAuthConfig, service: ApiService): Promise<AuthSession> {

    //console.log('============================> service:', service);

    // Se o token ainda for válido, reutiliza
    if (auth.last_token && auth.token_expires_at && auth.token_expires_at > new Date()) {
      return { token: auth.last_token };
    }

    //console.log('============================> ensureAuthenticated INICIO ');
    //console.log('============================> auth.base_url (login):', auth.base_url);

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...auth.extra_headers,
    };
    for (const [key, value] of Object.entries(requestHeaders)) {
      if (typeof value === 'string') {
        requestHeaders[key] = normalizeHeaderValue(value);
      }
    }
    const loginAttempt = async (attempt: 1 | 2, executarLogoffSessaoParalela: boolean): Promise<{
      token?: string;
      cookie?: string;
      lojaId?: string;
      possuiOutraSessaoAtiva: boolean;
    }> => {
      const loginPayload = {
        usuario: auth.username,
        senha: auth.password,
        executarLogOffSessaoParelela: executarLogoffSessaoParalela,
        lojaPadraoId: null,
      };

      //console.log(
      //  `============================> ensureAuthenticated.attempt=${attempt} executarLogoffSessaoParalela=${String(executarLogoffSessaoParalela)}`
      //);
      //console.log('============================> ensureAuthenticated.request.headers:', requestHeaders);
      //console.log('============================> ensureAuthenticated.request.body:', {
      //  ...loginPayload,
      //  senha: loginPayload.senha ? '***' : loginPayload.senha,
      //});

      const response = await fetch(auth.base_url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(loginPayload)
      });

      const responseBodyText = await response.text();
      //console.log('============================> ensureAuthenticated.response.status:', response.status, response.statusText);
      //console.log('============================> ensureAuthenticated.response.body:', responseBodyText || '<vazio>');

      if (!response.ok) {
        throw new Error(
          `Falha na autenticação: ${response.status} ${response.statusText}. Body: ${responseBodyText || '<vazio>'}`
        );
      }

      let result: any = {};
      try {
        result = responseBodyText ? JSON.parse(responseBodyText) : {};
      } catch {
        throw new Error(`Resposta de autenticação não é JSON válido. Body: ${responseBodyText || '<vazio>'}`);
      }

      const token = result.dados?.token || result.token || result.accessToken;
      const possuiOutraSessaoAtiva = result.dados?.possuiOutraSessaoAtiva === true;
      const lojaId = typeof result.dados?.loja?.id === 'string' ? result.dados.loja.id : undefined;

      const setCookieHeaders =
        (typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : undefined) ??
        [];
      const setCookieSingle = response.headers.get('set-cookie');
      const setCookieValues = setCookieHeaders.length
        ? setCookieHeaders
        : (setCookieSingle ? [setCookieSingle] : []);
      //console.log('============================> ensureAuthenticated.response.set-cookie.raw:', setCookieValues);
      const cookie = setCookieValues
        .map((line) => line.split(';', 1)[0]?.trim())
        .filter((line): line is string => Boolean(line))
        .join('; ');
      //console.log('============================> ensureAuthenticated.response.cookie.compact:', cookie || '<vazio>');

      return { token, cookie: cookie || undefined, lojaId, possuiOutraSessaoAtiva };
    };

    let loginResult = await loginAttempt(1, false);
    if (!loginResult.token && loginResult.possuiOutraSessaoAtiva) {
      //console.log('============================> ensureAuthenticated.retry: possuiOutraSessaoAtiva=true e sem token. Aguardando 1s para tentar novamente...');
      await sleep(1000);
      loginResult = await loginAttempt(2, true);
    }

    const token = loginResult.token;
    const cookie = loginResult.cookie;
    const lojaId = loginResult.lojaId;
    if (!token && !cookie) throw new Error('Falha ao obter autenticação no retorno da API (sem token e sem cookie)');

    // Atualiza o token na configuração de autenticação (compartilhada)
    if (token) {
      await this.repository.updateAuthToken(auth.id, token);
    }

    return { token, cookie: cookie || undefined, lojaId };
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
