import axios, { type AxiosRequestConfig } from 'axios';
import { PrismaClient } from '@prisma/client';
import { AuthService } from './AuthService.js';

type PendingIntegrationRow = {
  pendingId: bigint;
  sistemaNome: string;
  endpointUrl: string;
  metodo: string;
  entidadeView: string;
  payloadId: bigint;
  tentativas: number;
  status: string;
  authId: string;
  authType: string | null;
  baseUrl: string;
  baseUrlAlternativa: string | null;
  username: string | null;
  password: string | null;
  lastToken: string | null;
  tokenExpiresAt: Date | null;
  extraHeaders: unknown;
};

type DispatcherOptions = {
  pollIntervalMs?: number;
  maxConcurrency?: number;
  maxRetries?: number;
};

type DispatcherRunContext = {
  batchId?: string;
  executionId?: string;
  serviceId?: string;
};

type PendingProcessResult = {
  pendingId: bigint;
  status: 'success' | 'error';
  detail?: string;
};

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_MAX_RETRIES = 3;
const VALID_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const VALID_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quoteIdentifier(identifier: string): string {
  if (!VALID_IDENTIFIER.test(identifier)) {
    throw new Error(`Identificador SQL inválido: ${identifier}`);
  }
  return `"${identifier}"`;
}

function quoteQualifiedName(path: string): string {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) {
    throw new Error(`entidade_view inválida: ${path}`);
  }
  return parts.map(quoteIdentifier).join('.');
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined || v === null) continue;
    headers[k] = String(v);
  }
  return headers;
}

function normalizeDateString(value: string): string {
  const trimmed = value.trim();
  const brDate = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (brDate) {
    const [, dd, mm, yyyy] = brDate;
    return `${yyyy}-${mm}-${dd}`;
  }
  return value;
}

function decimalLikeToNumberOrString(value: unknown): number | string | null {
  if (!value || typeof value !== 'object') return null;

  // Evita converter objetos JSON comuns (que também possuem toString nativo).
  const proto = Object.getPrototypeOf(value);
  const isPlainObject = proto === Object.prototype || proto === null;
  if (isPlainObject) return null;

  const candidate = value as { toNumber?: () => number; toString?: () => string; constructor?: { name?: string } };
  if (typeof candidate.toNumber === 'function') {
    const asNumber = candidate.toNumber();
    if (Number.isFinite(asNumber)) return asNumber;
  }
  const ctorName = candidate.constructor?.name ?? '';
  if (typeof candidate.toString === 'function' && /decimal/i.test(ctorName)) {
    const asString = candidate.toString();
    const parsed = Number(asString);
    return Number.isFinite(parsed) ? parsed : asString;
  }
  return null;
}

function toJsonSafe(value: unknown): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return normalizeDateString(value);
  const decimalLike = decimalLikeToNumberOrString(value);
  if (decimalLike !== null) return decimalLike;
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = toJsonSafe(val);
    }
    return result;
  }
  return value;
}

function stringifyForLog(value: unknown, maxLen = 4000): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}... [truncated ${text.length - maxLen} chars]`;
  } catch {
    return '[payload-unserializable]';
  }
}

function buildFinalUrl(baseUrl: string, endpointUrl: string): string {
  const base = (baseUrl || '').trim();
  const endpoint = (endpointUrl || '').trim();
  if (!endpoint) throw new Error('endpoint_url inválido para o destino.');

  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  if (!base) throw new Error('base_url inválida para o destino.');

  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return new URL(normalizedEndpoint, base).toString();
}

async function runWithConcurrencyLimit<T>(items: T[], limit: number, handler: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      await handler(item);
    }
  });
  await Promise.all(workers);
}

export class DispatcherService {
  private readonly prisma: PrismaClient;
  private readonly authService: AuthService;
  private readonly pollIntervalMs: number;
  private readonly maxConcurrency: number;
  private readonly maxRetries: number;
  private running = false;
  private stopRequested = false;

  constructor(prisma: PrismaClient, options: DispatcherOptions = {}) {
    this.prisma = prisma;
    this.authService = new AuthService(async (authId, token, tokenExpiresAt) => {
      await this.prisma.$executeRaw`
        UPDATE api_auth_configs
        SET last_token = ${token},
            token_expires_at = ${tokenExpiresAt},
            updated_at = now()
        WHERE id = ${authId}::uuid
      `;
    });
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async start(): Promise<void> {
    this.running = true;
    this.stopRequested = false;
    while (!this.stopRequested) {
      try {
        await this.processPendingBatch();
      } catch (error) {
        console.error('DispatcherService.loop.error:', error);
      }
      if (!this.stopRequested) {
        await sleep(this.pollIntervalMs);
      }
    }
    this.running = false;
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
  }

  async processPendingBatch(context: DispatcherRunContext = {}): Promise<void> {
    console.log('============================> dispatcher.batch.start', {
      context,
      maxConcurrency: this.maxConcurrency,
      maxRetries: this.maxRetries,
    });
    const rows = await this.loadPendingRows();
    console.log('============================> dispatcher.batch.loaded', {
      pending_count: rows.length,
    });
    if (rows.length === 0) {
      if (context.executionId) {
        await this.finishDispatcherExecution(context.executionId, 'success', undefined, {
          total_pending_selected: 0,
          processed: 0,
          success: 0,
          error: 0,
        });
      }
      console.log('============================> dispatcher.batch.empty');
      return;
    }

    const batchId = context.batchId || await this.createDispatcherBatch(rows.length);
    const executionId = context.executionId || await this.createDispatcherExecution(batchId, context.serviceId);
    console.log('============================> dispatcher.batch.ids', {
      batchId,
      executionId,
      externalBatchId: Boolean(context.batchId),
      externalExecutionId: Boolean(context.executionId),
    });
    const results: PendingProcessResult[] = [];

    try {
      await runWithConcurrencyLimit(rows, this.maxConcurrency, async (row) => {
        console.log('============================> dispatcher.item.start', {
          pendingId: row.pendingId.toString(),
          sistemaNome: row.sistemaNome,
          entidadeView: row.entidadeView,
          payloadId: row.payloadId.toString(),
          tentativas: row.tentativas,
          metodo: row.metodo,
          endpointUrl: row.endpointUrl,
        });
        const result = await this.processSinglePending(row);
        results.push(result);
        console.log('============================> dispatcher.item.done', {
          pendingId: result.pendingId.toString(),
          status: result.status,
          detail: result.detail ?? null,
        });
      });

      const successCount = results.filter((r) => r.status === 'success').length;
      const errorCount = results.length - successCount;
      const finalStatus = successCount === rows.length ? 'success' : successCount === 0 ? 'failed' : 'partial';
      console.log('============================> dispatcher.batch.summary', {
        total: rows.length,
        processed: results.length,
        success: successCount,
        error: errorCount,
        finalStatus,
      });

      await this.finishDispatcherExecution(executionId, finalStatus, undefined, {
        total_pending_selected: rows.length,
        processed: results.length,
        success: successCount,
        error: errorCount,
      });

      if (!context.batchId) {
        await this.finishDispatcherBatch(batchId, finalStatus, undefined, {
          total_pending_selected: rows.length,
          processed: results.length,
          success: successCount,
          error: errorCount,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('============================> dispatcher.batch.error', { message });
      await this.finishDispatcherExecution(executionId, 'failed', message, {
        total_pending_selected: rows.length,
        processed: results.length,
        success: results.filter((r) => r.status === 'success').length,
        error: results.filter((r) => r.status === 'error').length,
      });
      if (!context.batchId) {
        await this.finishDispatcherBatch(batchId, 'failed', message, {
          total_pending_selected: rows.length,
          processed: results.length,
          success: results.filter((r) => r.status === 'success').length,
          error: results.filter((r) => r.status === 'error').length,
        });
      }
      throw error;
    } finally {
      console.log('============================> dispatcher.batch.finish', {
        batchId,
        executionId,
      });
    }
  }

  private async loadPendingRows(): Promise<PendingIntegrationRow[]> {
    const rows = await this.prisma.$queryRaw<PendingIntegrationRow[]>`
      SELECT
        ip.id AS "pendingId",
        ip.sistema_nome AS "sistemaNome",
        ip.endpoint_url AS "endpointUrl",
        ip.metodo AS "metodo",
        COALESCE(NULLIF(ip.entidade_view, ''), sdc.entidade_view) AS "entidadeView",
        ip.payload_id AS "payloadId",
        ip.tentativas AS "tentativas",
        ip.status AS "status",
        aac.id::text AS "authId",
        aac.auth_type AS "authType",
        aac.base_url AS "baseUrl",
        aac.base_url_alternativa AS "baseUrlAlternativa",
        aac.username AS "username",
        aac.password AS "password",
        aac.last_token AS "lastToken",
        aac.token_expires_at AS "tokenExpiresAt",
        aac.extra_headers AS "extraHeaders"
      FROM integracao_pendente ip
      JOIN sistema_destino_config sdc ON sdc.nome = ip.sistema_nome
      JOIN api_auth_configs aac ON aac.id = sdc.conexao_api_id
      WHERE ip.status = 'pendente'
        AND ip.tentativas < ${this.maxRetries}
        AND sdc.ativo = true
      ORDER BY ip.id ASC
      LIMIT 200
    `;
    return rows;
  }

  private async resolveBearerToken(row: PendingIntegrationRow): Promise<string | null> {
    const token = await this.authService.resolveBearerToken({
      id: row.authId,
      authType: row.authType,
      baseUrl: row.baseUrl,
      alternativeBaseUrl: row.baseUrlAlternativa,
      username: row.username,
      password: row.password,
      lastToken: row.lastToken,
      tokenExpiresAt: row.tokenExpiresAt,
      extraHeaders: row.extraHeaders,
    });
    if (token) {
      row.lastToken = token;
      row.tokenExpiresAt = null;
    }
    return token;
  }

  private async processSinglePending(row: PendingIntegrationRow): Promise<PendingProcessResult> {
    const method = String(row.metodo || 'POST').toUpperCase();
    if (!VALID_METHODS.has(method)) {
      await this.markError(row.pendingId, row.tentativas, `Método HTTP não suportado: ${method}`);
      return { pendingId: row.pendingId, status: 'error', detail: `Método inválido: ${method}` };
    }

    let safePayload: unknown = null;
    try {
      const payload = await this.loadPayloadFromView(row.entidadeView, row.payloadId);
      if (!payload) {
        throw new Error(`Payload não encontrado em ${row.entidadeView} para id=${row.payloadId.toString()}`);
      }
      safePayload = toJsonSafe(payload);

      const url = buildFinalUrl(row.baseUrl, row.endpointUrl);
      const headers = normalizeHeaders(row.extraHeaders);
      const maybeToken = await this.resolveBearerToken(row);
      if (!maybeToken && String(row.authType || 'bearer').toLowerCase() === 'bearer') {
        throw new Error(`Token Bearer ausente para auth_id=${row.authId}.`);
      }
      if (maybeToken) {
        headers.Authorization = maybeToken.toLowerCase().startsWith('bearer ')
          ? maybeToken
          : `Bearer ${maybeToken}`;
      }

      const config: AxiosRequestConfig = {
        method: method as AxiosRequestConfig['method'],
        url,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        data: safePayload,
        timeout: 30_000,
        validateStatus: () => true,
      };
      console.log('============================> dispatcher.webhook.request', {
        pendingId: row.pendingId.toString(),
        method,
        url,
        hasAuthorization: Boolean(headers.Authorization),
        authorizationPreview: headers.Authorization
          ? (String(headers.Authorization).toLowerCase().startsWith('bearer ') ? 'Bearer ***' : '***')
          : null,
      });

      const response = await axios.request(config);
      if (response.status >= 200 && response.status < 300) {
        await this.markSuccess(row.pendingId);
        console.log('============================> dispatcher.webhook.success', {
          pendingId: row.pendingId.toString(),
          status: response.status,
        });
        return { pendingId: row.pendingId, status: 'success' };
      }

      const bodyText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      const errorMessage = `Webhook retornou status ${response.status}. Body: ${bodyText.slice(0, 1800)}`;
      await this.markError(
        row.pendingId,
        row.tentativas,
        errorMessage
      );
      console.log('============================> dispatcher.webhook.fail', {
        pendingId: row.pendingId.toString(),
        status: response.status,
        message: errorMessage,
        payloadPreview: stringifyForLog(safePayload),
      });
      return { pendingId: row.pendingId, status: 'error', detail: errorMessage };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markError(row.pendingId, row.tentativas, message);
      console.log('============================> dispatcher.webhook.error', {
        pendingId: row.pendingId.toString(),
        message,
        payloadPreview: stringifyForLog(safePayload),
      });
      return { pendingId: row.pendingId, status: 'error', detail: message };
    }
  }

  private async createDispatcherBatch(selectedCount: number): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO api_batches (trigger_type, name, description, is_active, endpoints, status)
      VALUES (
        'scheduled',
        'DispatcherService',
        ${`Processamento assíncrono de pendências (${selectedCount} selecionadas)`},
        true,
        '{}'::jsonb,
        'running'
      )
      RETURNING id
    `;
    const row = rows[0];
    if (!row?.id) throw new Error('Falha ao criar batch do DispatcherService.');
    return row.id;
  }

  private async createDispatcherExecution(batchId: string, explicitServiceId?: string): Promise<string> {
    const serviceId = explicitServiceId || (await this.resolveServiceIdByName('DispatcherService'));
    if (!serviceId) {
      throw new Error(
        'Não foi possível criar execução do DispatcherService: service_id não informado e service_name "DispatcherService" não cadastrado em api_services.'
      );
    }

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO api_service_executions (batch_id, service_id, snapshot_config, started_at, status)
      VALUES (
        ${batchId}::uuid,
        ${serviceId}::uuid,
        ${JSON.stringify({ service: { id: serviceId, service_name: 'DispatcherService', name: 'DispatcherService' } })}::jsonb,
        now(),
        'running'
      )
      RETURNING id
    `;
    const row = rows[0];
    if (!row?.id) throw new Error('Falha ao criar execução do DispatcherService.');
    return row.id;
  }

  private async finishDispatcherExecution(
    executionId: string,
    status: 'success' | 'failed' | 'partial',
    errorMessage?: string,
    rawResponse?: Record<string, unknown>
  ): Promise<void> {
    const mappedStatus = status === 'partial' ? 'success' : status;
    await this.prisma.$executeRaw`
      UPDATE api_service_executions
      SET status = ${mappedStatus},
          error_message = ${status === 'partial' ? errorMessage ?? 'Execução parcial no dispatcher.' : errorMessage ?? null},
          raw_response = ${rawResponse ? JSON.stringify(rawResponse) : null}::jsonb,
          finished_at = now()
      WHERE id = ${executionId}::uuid
    `;
  }

  private async resolveServiceIdByName(serviceName: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id
      FROM api_services
      WHERE service_name = ${serviceName}
      ORDER BY is_active DESC, updated_at DESC
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  private async finishDispatcherBatch(
    batchId: string,
    status: 'success' | 'failed' | 'partial',
    errorMessage?: string,
    rawResponse?: Record<string, unknown>
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE api_batches
      SET status = ${status},
          error_message = ${errorMessage ?? null},
          raw_response = ${rawResponse ? JSON.stringify(rawResponse) : null}::jsonb,
          finished_at = now()
      WHERE id = ${batchId}::uuid
    `;
  }

  private async loadPayloadFromView(entidadeView: string, payloadId: bigint): Promise<Record<string, unknown> | null> {
    const safeEntityView = quoteQualifiedName(entidadeView);
    const sql = `SELECT * FROM ${safeEntityView} WHERE id = $1 LIMIT 1`;
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, payloadId);
    return rows[0] ?? null;
  }

  private async markSuccess(pendingId: bigint): Promise<void> {
    await this.prisma.integracaoPendente.update({
      where: { id: pendingId },
      data: {
        status: 'enviado',
        ultimaTentativa: new Date(),
        logErro: null,
      },
    });
  }

  private async markError(pendingId: bigint, currentAttempts: number, message: string): Promise<void> {
    const nextAttempts = currentAttempts + 1;
    const status = nextAttempts >= this.maxRetries ? 'erro' : 'pendente';
    await this.prisma.integracaoPendente.update({
      where: { id: pendingId },
      data: {
        tentativas: nextAttempts,
        status,
        ultimaTentativa: new Date(),
        logErro: message.slice(0, 2000),
      },
    });
  }
}
