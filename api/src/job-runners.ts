import { createHash } from 'node:crypto';

import { createDb, type Db } from './db.js';
import { fetchOrdersWebscrapeOrders } from './connectors/orders-webscrape.js';
import { fetchPowerStockOrders } from './connectors/powerStockConnector.js';

type IntegrationAndConnectionsRow = {
  id: string;
  name: string;
  settings: unknown;
  source_connection_id: string | null;
  destination_connection_id: string | null;
  source_type: 'api' | 'db' | 'custom' | null;
  source_config: unknown | null;
  destination_type: 'api' | 'db' | 'custom' | null;
  destination_config: unknown | null;
};

type StepMetrics = {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
};

type Step1Config = {
  baseUrl: string;
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  bearerToken?: string;
  paginationType: 'none' | 'page' | 'offset' | 'cursor';
  pageParam: string;
  pageSizeParam: string;
  pageSize: number;
  offsetParam: string;
  cursorParam: string;
  nextCursorPath: string;
  responseItemsPath: string;
  sourceOrderIdPath: string;
  sourceSystem: string;
  maxPages: number;
  timeoutMs: number;
};

type Step1DbCursorType = 'text' | 'timestamptz' | 'timestamp' | 'bigint' | 'integer' | 'uuid';

type Step1DbConfig = {
  connectionString: string;
  query: string;
  paginationType: 'none' | 'offset' | 'cursor';
  pageSize: number;
  cursorColumn: string | null;
  cursorType: Step1DbCursorType;
  sourceOrderIdPath: string;
  sourceSystem: string;
  maxPages: number;
  initialCursor: string | null;
};

type Step1CustomOrdersWebscrapeConfig = {
  kind: 'ordersWebscrape' | 'powerStock';
  baseUrl: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  usernameField: string;
  passwordField: string;
  ordersUrl: string;
  tableSelector?: string;
  sourceOrderIdField: string;
  sourceSystem: string;
  maxPages: number;
  timeoutMs: number;
};

type Step2Config = {
  baseUrl: string;
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  bearerToken?: string;
  timeoutMs: number;
  idempotencyHeader?: string;
  maxBatch: number;
};

type Step2DbConfig = {
  connectionString: string;
  table: string;
  keyColumn: string;
  payloadColumn: string;
  payloadHashColumn: string;
  updatedAtColumn: string;
  autoCreateTable: boolean;
  maxBatch: number;
};

type OrderRow = {
  id: string;
  source_order_id: string;
  source_payload: unknown;
  mapped_payload_hash: string | null;
};

type SendAttemptRow = {
  id: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getByPath(input: unknown, path: string): unknown {
  if (!path) return input;
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
  let current: unknown = input;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = stableNormalize(record[key]);
    }
    return out;
  }
  return value;
}

function payloadHash(payload: unknown): string {
  const normalized = stableNormalize(payload);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function buildUrl(baseUrl: string, endpoint: string): URL {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return new URL(endpoint);
  }
  return new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

function resolveStep1CustomOrdersWebscrapeConfig(integration: IntegrationAndConnectionsRow): Step1CustomOrdersWebscrapeConfig {
  if (integration.source_type !== 'custom' || !integration.source_config) {
    throw new Error('Step1 requires source connection type custom');
  }

  const integrationSettings = asRecord(integration.settings);
  const sourceConfig = asRecord(integration.source_config);
  if (sourceConfig.kind !== 'ordersWebscrape' && sourceConfig.kind !== 'powerStock') {
    throw new Error('Unsupported custom source kind');
  }

  const baseUrl = sourceConfig.baseUrl;
  const ordersUrl = sourceConfig.ordersUrl;
  if (typeof baseUrl !== 'string' || !baseUrl) {
    throw new Error('Custom connection requires config.baseUrl');
  }
  if (typeof ordersUrl !== 'string' || !ordersUrl) {
    throw new Error('Custom connection requires config.ordersUrl');
  }

  const maxPages = typeof sourceConfig.maxPages === 'number' ? sourceConfig.maxPages : 5;
  const timeoutMs = typeof sourceConfig.timeoutMs === 'number' ? sourceConfig.timeoutMs : 15000;

  return {
    kind: sourceConfig.kind,
    baseUrl,
    loginUrl: typeof sourceConfig.loginUrl === 'string' && sourceConfig.loginUrl ? sourceConfig.loginUrl : undefined,
    username: typeof sourceConfig.username === 'string' && sourceConfig.username ? sourceConfig.username : undefined,
    password: typeof sourceConfig.password === 'string' && sourceConfig.password ? sourceConfig.password : undefined,
    usernameField:
      typeof sourceConfig.usernameField === 'string' && sourceConfig.usernameField ? sourceConfig.usernameField : 'username',
    passwordField:
      typeof sourceConfig.passwordField === 'string' && sourceConfig.passwordField ? sourceConfig.passwordField : 'password',
    ordersUrl,
    tableSelector: typeof sourceConfig.tableSelector === 'string' && sourceConfig.tableSelector ? sourceConfig.tableSelector : undefined,
    sourceOrderIdField:
      typeof sourceConfig.sourceOrderIdField === 'string' && sourceConfig.sourceOrderIdField ? sourceConfig.sourceOrderIdField : 'id',
    sourceSystem:
      typeof sourceConfig.sourceSystem === 'string' && sourceConfig.sourceSystem
        ? sourceConfig.sourceSystem
        : typeof integrationSettings.sourceSystem === 'string' && integrationSettings.sourceSystem
          ? integrationSettings.sourceSystem
          : integration.name,
    maxPages: Math.max(1, maxPages),
    timeoutMs,
  };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function loadIntegrationAndConnections(db: Db, integrationId: string): Promise<IntegrationAndConnectionsRow> {
  const result = await db.query<IntegrationAndConnectionsRow>(
    `select
       i.id,
       i.name,
       i.settings,
       i.source_connection_id,
       i.destination_connection_id,
       sc.type as source_type,
       sc.config as source_config,
       dc.type as destination_type,
       dc.config as destination_config
     from integrations i
     left join connections sc on sc.id = i.source_connection_id
     left join connections dc on dc.id = i.destination_connection_id
     where i.id = $1`,
    [integrationId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Integration not found: ${integrationId}`);
  return row;
}

function resolveStep1Config(integration: IntegrationAndConnectionsRow): Step1Config {
  if (integration.source_type !== 'api' || !integration.source_config) {
    throw new Error('Step1 requires source connection type api');
  }
  const integrationSettings = asRecord(integration.settings);
  const sourceConfig = asRecord(integration.source_config);
  const headersRaw = asRecord(sourceConfig.headers);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(headersRaw)) {
    if (typeof v === 'string') headers[k] = v;
  }

  const baseUrl = sourceConfig.baseUrl;
  if (typeof baseUrl !== 'string' || !baseUrl) {
    throw new Error('Source API requires config.baseUrl');
  }

  return {
    baseUrl,
    endpoint: typeof sourceConfig.endpoint === 'string' && sourceConfig.endpoint ? sourceConfig.endpoint : '/orders',
    method: typeof sourceConfig.method === 'string' && sourceConfig.method ? sourceConfig.method.toUpperCase() : 'GET',
    headers,
    bearerToken: typeof sourceConfig.bearerToken === 'string' ? sourceConfig.bearerToken : undefined,
    paginationType:
      sourceConfig.paginationType === 'page' ||
      sourceConfig.paginationType === 'offset' ||
      sourceConfig.paginationType === 'cursor'
        ? sourceConfig.paginationType
        : 'none',
    pageParam: typeof sourceConfig.pageParam === 'string' && sourceConfig.pageParam ? sourceConfig.pageParam : 'page',
    pageSizeParam:
      typeof sourceConfig.pageSizeParam === 'string' && sourceConfig.pageSizeParam ? sourceConfig.pageSizeParam : 'size',
    pageSize: typeof sourceConfig.pageSize === 'number' ? sourceConfig.pageSize : 100,
    offsetParam:
      typeof sourceConfig.offsetParam === 'string' && sourceConfig.offsetParam ? sourceConfig.offsetParam : 'offset',
    cursorParam:
      typeof sourceConfig.cursorParam === 'string' && sourceConfig.cursorParam ? sourceConfig.cursorParam : 'cursor',
    nextCursorPath:
      typeof sourceConfig.nextCursorPath === 'string' && sourceConfig.nextCursorPath ? sourceConfig.nextCursorPath : 'nextCursor',
    responseItemsPath:
      typeof sourceConfig.responseItemsPath === 'string' && sourceConfig.responseItemsPath ? sourceConfig.responseItemsPath : 'items',
    sourceOrderIdPath:
      typeof sourceConfig.sourceOrderIdPath === 'string' && sourceConfig.sourceOrderIdPath ? sourceConfig.sourceOrderIdPath : 'id',
    sourceSystem:
      typeof integrationSettings.sourceSystem === 'string' && integrationSettings.sourceSystem
        ? integrationSettings.sourceSystem
        : integration.name,
    maxPages: typeof sourceConfig.maxPages === 'number' ? sourceConfig.maxPages : 50,
    timeoutMs: typeof sourceConfig.timeoutMs === 'number' ? sourceConfig.timeoutMs : 15000,
  };
}

function resolveStep2Config(integration: IntegrationAndConnectionsRow): Step2Config {
  if (integration.destination_type !== 'api' || !integration.destination_config) {
    throw new Error('Step2 requires destination connection type api');
  }
  const destinationConfig = asRecord(integration.destination_config);
  const headersRaw = asRecord(destinationConfig.headers);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(headersRaw)) {
    if (typeof v === 'string') headers[k] = v;
  }

  const baseUrl = destinationConfig.baseUrl;
  if (typeof baseUrl !== 'string' || !baseUrl) {
    throw new Error('Destination API requires config.baseUrl');
  }

  return {
    baseUrl,
    endpoint:
      typeof destinationConfig.endpoint === 'string' && destinationConfig.endpoint ? destinationConfig.endpoint : '/orders',
    method:
      typeof destinationConfig.method === 'string' && destinationConfig.method
        ? destinationConfig.method.toUpperCase()
        : 'POST',
    headers,
    bearerToken: typeof destinationConfig.bearerToken === 'string' ? destinationConfig.bearerToken : undefined,
    timeoutMs: typeof destinationConfig.timeoutMs === 'number' ? destinationConfig.timeoutMs : 15000,
    idempotencyHeader:
      typeof destinationConfig.idempotencyHeader === 'string' ? destinationConfig.idempotencyHeader : undefined,
    maxBatch: typeof destinationConfig.maxBatch === 'number' ? destinationConfig.maxBatch : 200,
  };
}

function isSafeSqlIdentifier(value: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value);
}

function isSafeSqlQualifiedIdentifier(value: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(value);
}

function resolveStep2DbConfig(integration: IntegrationAndConnectionsRow): Step2DbConfig {
  if (integration.destination_type !== 'db' || !integration.destination_config) {
    throw new Error('Step2 requires destination connection type db');
  }

  const destinationConfig = asRecord(integration.destination_config);
  const connectionString = destinationConfig.connectionString;
  if (typeof connectionString !== 'string' || !connectionString) {
    throw new Error('Destination DB requires config.connectionString');
  }

  const tableRaw = typeof destinationConfig.table === 'string' ? destinationConfig.table.trim() : '';
  if (!tableRaw) {
    throw new Error('Destination DB requires config.table');
  }
  if (!isSafeSqlQualifiedIdentifier(tableRaw)) {
    throw new Error('Destination DB requires table to be a safe SQL identifier (optionally schema-qualified)');
  }

  const keyColumn =
    typeof destinationConfig.keyColumn === 'string' && destinationConfig.keyColumn ? destinationConfig.keyColumn : 'source_order_id';
  const payloadColumn =
    typeof destinationConfig.payloadColumn === 'string' && destinationConfig.payloadColumn ? destinationConfig.payloadColumn : 'payload';
  const payloadHashColumn =
    typeof destinationConfig.payloadHashColumn === 'string' && destinationConfig.payloadHashColumn
      ? destinationConfig.payloadHashColumn
      : 'payload_hash';
  const updatedAtColumn =
    typeof destinationConfig.updatedAtColumn === 'string' && destinationConfig.updatedAtColumn ? destinationConfig.updatedAtColumn : 'updated_at';

  for (const col of [keyColumn, payloadColumn, payloadHashColumn, updatedAtColumn]) {
    if (!isSafeSqlIdentifier(col)) {
      throw new Error('Destination DB requires key/payload columns to be safe SQL identifiers');
    }
  }

  return {
    connectionString,
    table: tableRaw,
    keyColumn,
    payloadColumn,
    payloadHashColumn,
    updatedAtColumn,
    autoCreateTable: destinationConfig.autoCreateTable === true,
    maxBatch: typeof destinationConfig.maxBatch === 'number' ? destinationConfig.maxBatch : 200,
  };
}

async function ensureDestinationTable(destDb: Db, config: Step2DbConfig) {
  if (!config.autoCreateTable) return;
  await destDb.query(
    `create table if not exists ${config.table} (
       ${config.keyColumn} text primary key,
       ${config.payloadColumn} jsonb not null,
       ${config.payloadHashColumn} text null,
       ${config.updatedAtColumn} timestamptz not null default now()
     )`
  );
}

function resolveStep1DbConfig(integration: IntegrationAndConnectionsRow): Step1DbConfig {
  if (integration.source_type !== 'db' || !integration.source_config) {
    throw new Error('Step1 requires source connection type db');
  }

  const integrationSettings = asRecord(integration.settings);
  const step1DbSettings = asRecord(integrationSettings.step1Db);
  const sourceConfig = asRecord(integration.source_config);

  const connectionString = sourceConfig.connectionString;
  if (typeof connectionString !== 'string' || !connectionString) {
    throw new Error('Source DB requires config.connectionString');
  }

  const query = typeof step1DbSettings.query === 'string' ? step1DbSettings.query : sourceConfig.query;
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('Source DB requires query (integration.settings.step1Db.query or connection.config.query)');
  }

  const paginationType =
    step1DbSettings.paginationType === 'offset' || step1DbSettings.paginationType === 'cursor'
      ? step1DbSettings.paginationType
      : sourceConfig.paginationType === 'offset' || sourceConfig.paginationType === 'cursor'
        ? sourceConfig.paginationType
      : 'none';

  const cursorType: Step1DbCursorType =
    step1DbSettings.cursorType === 'timestamptz' ||
    step1DbSettings.cursorType === 'timestamp' ||
    step1DbSettings.cursorType === 'bigint' ||
    step1DbSettings.cursorType === 'integer' ||
    step1DbSettings.cursorType === 'uuid'
      ? step1DbSettings.cursorType
      : sourceConfig.cursorType === 'timestamptz' ||
          sourceConfig.cursorType === 'timestamp' ||
          sourceConfig.cursorType === 'bigint' ||
          sourceConfig.cursorType === 'integer' ||
          sourceConfig.cursorType === 'uuid'
        ? sourceConfig.cursorType
      : 'text';

  const cursorColumnRaw =
    typeof step1DbSettings.cursorColumn === 'string'
      ? step1DbSettings.cursorColumn.trim()
      : typeof sourceConfig.cursorColumn === 'string'
        ? sourceConfig.cursorColumn.trim()
        : '';
  const cursorColumn = cursorColumnRaw ? cursorColumnRaw : null;
  if (paginationType === 'cursor') {
    if (!cursorColumn) {
      throw new Error('Source DB cursor pagination requires cursorColumn');
    }
    if (!isSafeSqlIdentifier(cursorColumn)) {
      throw new Error('Source DB requires cursorColumn to be a safe SQL identifier');
    }
  }

  const step1DbCursor =
    typeof integrationSettings.step1DbCursor === 'string' && integrationSettings.step1DbCursor
      ? integrationSettings.step1DbCursor
      : null;
  const initialCursorConfigured =
    typeof step1DbSettings.initialCursor === 'string' && step1DbSettings.initialCursor
      ? step1DbSettings.initialCursor
      : typeof sourceConfig.initialCursor === 'string' && sourceConfig.initialCursor
        ? sourceConfig.initialCursor
        : null;

  return {
    connectionString,
    query,
    paginationType,
    pageSize:
      typeof step1DbSettings.pageSize === 'number'
        ? step1DbSettings.pageSize
        : typeof sourceConfig.pageSize === 'number'
          ? sourceConfig.pageSize
          : 200,
    cursorColumn,
    cursorType,
    sourceOrderIdPath:
      typeof step1DbSettings.sourceOrderIdPath === 'string' && step1DbSettings.sourceOrderIdPath
        ? step1DbSettings.sourceOrderIdPath
        : typeof sourceConfig.sourceOrderIdPath === 'string' && sourceConfig.sourceOrderIdPath
          ? sourceConfig.sourceOrderIdPath
          : 'id',
    sourceSystem:
      typeof step1DbSettings.sourceSystem === 'string' && step1DbSettings.sourceSystem
        ? step1DbSettings.sourceSystem
        : typeof sourceConfig.sourceSystem === 'string' && sourceConfig.sourceSystem
          ? sourceConfig.sourceSystem
        : typeof integrationSettings.sourceSystem === 'string' && integrationSettings.sourceSystem
          ? integrationSettings.sourceSystem
          : integration.name,
    maxPages:
      typeof step1DbSettings.maxPages === 'number'
        ? step1DbSettings.maxPages
        : typeof sourceConfig.maxPages === 'number'
          ? sourceConfig.maxPages
          : 50,
    initialCursor: step1DbCursor ?? initialCursorConfigured,
  };
}

async function fetchStep1DbPage(params: {
  sourceDb: Db;
  config: Step1DbConfig;
  offset: number;
  cursor: string | null;
}): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }> {
  const base = `select * from (${params.config.query}) as q`;

  if (params.config.paginationType === 'offset') {
    const result = await params.sourceDb.query<Record<string, unknown>>(`${base} limit $1 offset $2`, [
      params.config.pageSize,
      params.offset,
    ]);
    return { items: result.rows, nextCursor: null };
  }

  if (params.config.paginationType === 'cursor') {
    const col = params.config.cursorColumn;
    if (!col) {
      throw new Error('Missing cursorColumn');
    }

    const result = await params.sourceDb.query<Record<string, unknown>>(
      `${base}
       where ($1::${params.config.cursorType} is null or q.${col} > $1::${params.config.cursorType})
       order by q.${col} asc
       limit $2`,
      [params.cursor, params.config.pageSize]
    );

    const last = result.rows[result.rows.length - 1];
    const nextCursorRaw = last ? getByPath(last, col) : null;
    const nextCursor = typeof nextCursorRaw === 'string' || typeof nextCursorRaw === 'number' ? String(nextCursorRaw) : null;
    return { items: result.rows, nextCursor };
  }

  const result = await params.sourceDb.query<Record<string, unknown>>(base);
  return { items: result.rows, nextCursor: null };
}

async function fetchStep1Page(
  config: Step1Config,
  page: number,
  offset: number,
  cursor: string | null
): Promise<{ items: unknown[]; nextCursor: string | null }> {
  const url = buildUrl(config.baseUrl, config.endpoint);
  if (config.paginationType === 'page') {
    url.searchParams.set(config.pageParam, String(page));
    url.searchParams.set(config.pageSizeParam, String(config.pageSize));
  } else if (config.paginationType === 'offset') {
    url.searchParams.set(config.offsetParam, String(offset));
    url.searchParams.set(config.pageSizeParam, String(config.pageSize));
  } else if (config.paginationType === 'cursor' && cursor) {
    url.searchParams.set(config.cursorParam, cursor);
  }

  const headers = { ...config.headers };
  if (config.bearerToken) {
    headers.authorization = `Bearer ${config.bearerToken}`;
  }

  const response = await fetch(url, {
    method: config.method,
    headers,
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(`Step1 source request failed: ${response.status} ${JSON.stringify(body)}`);
  }

  if (Array.isArray(body)) {
    return { items: body, nextCursor: null };
  }

  const itemsValue = getByPath(body, config.responseItemsPath);
  const items = Array.isArray(itemsValue) ? itemsValue : [];

  const nextCursorValue = getByPath(body, config.nextCursorPath);
  const nextCursor = typeof nextCursorValue === 'string' && nextCursorValue ? nextCursorValue : null;

  return { items, nextCursor };
}

export async function runStep1CaptureOrders(db: Db, integrationId: string): Promise<StepMetrics> {
  const integration = await loadIntegrationAndConnections(db, integrationId);
  if (integration.source_type === 'db') {
    const config = resolveStep1DbConfig(integration);
    const sourceDb = createDb(config.connectionString);
    try {
      let offset = 0;
      let cursor = config.initialCursor;
      let lastCursor: string | null = cursor;

      const metrics: StepMetrics = { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 };

      for (let pageCount = 0; pageCount < config.maxPages; pageCount += 1) {
        const { items, nextCursor } = await fetchStep1DbPage({ sourceDb, config, offset, cursor });
        if (items.length === 0) break;

        for (const item of items) {
          const sourceOrderIdRaw = getByPath(item, config.sourceOrderIdPath);
          if (typeof sourceOrderIdRaw !== 'string' && typeof sourceOrderIdRaw !== 'number') {
            metrics.skipped += 1;
            continue;
          }

          const sourceOrderId = String(sourceOrderIdRaw);
          const sourcePayload = item;
          const sourcePayloadHash = payloadHash(sourcePayload);

          const upsertResult = await db.query<{ inserted: boolean }>(
            `insert into orders (
               integration_id,
               source_system,
               source_order_id,
               source_payload,
               source_payload_hash,
               last_seen_at
             )
             values ($1, $2, $3, $4::jsonb, $5, now())
             on conflict (integration_id, source_system, source_order_id)
             do update set
               source_payload = excluded.source_payload,
               source_payload_hash = excluded.source_payload_hash,
               last_seen_at = now(),
               updated_at = now()
             returning (xmax = 0) as inserted`,
            [integration.id, config.sourceSystem, sourceOrderId, JSON.stringify(sourcePayload), sourcePayloadHash]
          );

          metrics.processed += 1;
          if (upsertResult.rows[0]?.inserted) {
            metrics.inserted += 1;
          } else {
            metrics.updated += 1;
          }
        }

        if (config.paginationType === 'none') break;
        if (config.paginationType === 'offset') {
          offset += items.length;
          if (items.length < config.pageSize) break;
          continue;
        }
        if (config.paginationType === 'cursor') {
          if (!nextCursor) break;
          cursor = nextCursor;
          lastCursor = nextCursor;
          if (items.length < config.pageSize) break;
          continue;
        }
      }

      if (config.paginationType === 'cursor' && lastCursor) {
        await db.query(
          `update integrations
           set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{step1DbCursor}', to_jsonb($2::text), true),
               updated_at = now()
           where id = $1`,
          [integration.id, lastCursor]
        );
      }

      return metrics;
    } finally {
      await sourceDb.end().catch(() => undefined);
    }
  }

  if (integration.source_type === 'custom') {
    const config = resolveStep1CustomOrdersWebscrapeConfig(integration);
    const metrics: StepMetrics = { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 };

    const items =
      config.kind === 'powerStock'
        ? await fetchPowerStockOrders({
            baseUrl: config.baseUrl,
            loginUrl: config.loginUrl,
            username: config.username,
            password: config.password,
            usernameField: config.usernameField,
            passwordField: config.passwordField,
            ordersUrl: config.ordersUrl,
            tableSelector: config.tableSelector,
            timeoutMs: config.timeoutMs,
            maxPages: config.maxPages,
          })
        : await fetchOrdersWebscrapeOrders({
            baseUrl: config.baseUrl,
            loginUrl: config.loginUrl,
            username: config.username,
            password: config.password,
            usernameField: config.usernameField,
            passwordField: config.passwordField,
            ordersUrl: config.ordersUrl,
            tableSelector: config.tableSelector,
            timeoutMs: config.timeoutMs,
            maxPages: config.maxPages,
          });

    for (const item of items) {
      const sourceOrderIdRaw = item[config.sourceOrderIdField];
      if (typeof sourceOrderIdRaw !== 'string' && typeof sourceOrderIdRaw !== 'number') {
        metrics.skipped += 1;
        continue;
      }

      const sourceOrderId = String(sourceOrderIdRaw);
      const sourcePayload = item;
      const sourcePayloadHash = payloadHash(sourcePayload);

      const upsertResult = await db.query<{ inserted: boolean }>(
        `insert into orders (
           integration_id,
           source_system,
           source_order_id,
           source_payload,
           source_payload_hash,
           last_seen_at
         )
         values ($1, $2, $3, $4::jsonb, $5, now())
         on conflict (integration_id, source_system, source_order_id)
         do update set
           source_payload = excluded.source_payload,
           source_payload_hash = excluded.source_payload_hash,
           last_seen_at = now(),
           updated_at = now()
         returning (xmax = 0) as inserted`,
        [integration.id, config.sourceSystem, sourceOrderId, JSON.stringify(sourcePayload), sourcePayloadHash]
      );

      metrics.processed += 1;
      if (upsertResult.rows[0]?.inserted) {
        metrics.inserted += 1;
      } else {
        metrics.updated += 1;
      }
    }

    return metrics;
  }

  const config = resolveStep1Config(integration);

  let page = 1;
  let offset = 0;
  let cursor: string | null = null;
  const metrics: StepMetrics = { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 };

  for (let pageCount = 0; pageCount < config.maxPages; pageCount += 1) {
    const { items, nextCursor } = await fetchStep1Page(config, page, offset, cursor);
    if (items.length === 0) break;

    for (const item of items) {
      const sourceOrderIdRaw = getByPath(item, config.sourceOrderIdPath);
      if (typeof sourceOrderIdRaw !== 'string' && typeof sourceOrderIdRaw !== 'number') {
        metrics.skipped += 1;
        continue;
      }

      const sourceOrderId = String(sourceOrderIdRaw);
      const sourcePayload = item;
      const sourcePayloadHash = payloadHash(sourcePayload);

      const upsertResult = await db.query<{ inserted: boolean }>(
        `insert into orders (
           integration_id,
           source_system,
           source_order_id,
           source_payload,
           source_payload_hash,
           last_seen_at
         )
         values ($1, $2, $3, $4::jsonb, $5, now())
         on conflict (integration_id, source_system, source_order_id)
         do update set
           source_payload = excluded.source_payload,
           source_payload_hash = excluded.source_payload_hash,
           last_seen_at = now(),
           updated_at = now()
         returning (xmax = 0) as inserted`,
        [integration.id, config.sourceSystem, sourceOrderId, JSON.stringify(sourcePayload), sourcePayloadHash]
      );

      metrics.processed += 1;
      if (upsertResult.rows[0]?.inserted) {
        metrics.inserted += 1;
      } else {
        metrics.updated += 1;
      }
    }

    if (config.paginationType === 'none') break;
    if (config.paginationType === 'page') {
      page += 1;
      if (items.length < config.pageSize) break;
      continue;
    }
    if (config.paginationType === 'offset') {
      offset += items.length;
      if (items.length < config.pageSize) break;
      continue;
    }

    if (config.paginationType === 'cursor') {
      if (!nextCursor) break;
      cursor = nextCursor;
      continue;
    }
  }

  return metrics;
}

export async function runStep2SendOrders(db: Db, integrationId: string, executionId: string): Promise<StepMetrics> {
  const integration = await loadIntegrationAndConnections(db, integrationId);
  if (integration.destination_type === 'db') {
    const config = resolveStep2DbConfig(integration);
    const destDb = createDb(config.connectionString);
    try {
      await ensureDestinationTable(destDb, config);

      const result = await db.query<OrderRow>(
        `select id, source_order_id, source_payload, mapped_payload_hash
         from orders
         where integration_id = $1
         order by updated_at asc
         limit $2`,
        [integration.id, config.maxBatch]
      );

      const metrics: StepMetrics = { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 };

      for (const order of result.rows) {
        const payload = order.source_payload;
        const nextHash = payloadHash(payload);

        if (order.mapped_payload_hash && order.mapped_payload_hash === nextHash) {
          metrics.skipped += 1;
          continue;
        }
        metrics.processed += 1;

        const sendAttempt = await db.query<SendAttemptRow>(
          `insert into send_attempts (order_id, execution_id, status, request_payload)
           values ($1, $2, 'queued', $3::jsonb)
           returning id`,
          [order.id, executionId, JSON.stringify(payload)]
        );
        const sendAttemptId = sendAttempt.rows[0]?.id;
        if (!sendAttemptId) {
          throw new Error('Failed to create send attempt');
        }

        try {
          await destDb.query(
            `insert into ${config.table} (${config.keyColumn}, ${config.payloadColumn}, ${config.payloadHashColumn}, ${config.updatedAtColumn})
             values ($1, $2::jsonb, $3, now())
             on conflict (${config.keyColumn})
             do update set
               ${config.payloadColumn} = excluded.${config.payloadColumn},
               ${config.payloadHashColumn} = excluded.${config.payloadHashColumn},
               ${config.updatedAtColumn} = now()`,
            [order.source_order_id, JSON.stringify(payload), nextHash]
          );

          await db.query(
            `update send_attempts
             set status = 'success',
                 status_code = $2,
                 response_payload = $3::jsonb
             where id = $1`,
            [sendAttemptId, 200, JSON.stringify({ ok: true, target: 'db', table: config.table })]
          );

          await db.query(
            `update orders
             set mapped_payload = $2::jsonb,
                 mapped_payload_hash = $3,
                 updated_at = now()
             where id = $1`,
            [order.id, JSON.stringify(payload), nextHash]
          );

          metrics.updated += 1;
        } catch (error) {
          metrics.failed += 1;
          await db.query(
            `update send_attempts
             set status = 'failed',
                 error = $2::jsonb
             where id = $1`,
            [sendAttemptId, JSON.stringify({ message: error instanceof Error ? error.message : 'unknown error' })]
          );
        }
      }

      return metrics;
    } finally {
      await destDb.end().catch(() => undefined);
    }
  }

  const config = resolveStep2Config(integration);

  const result = await db.query<OrderRow>(
    `select id, source_order_id, source_payload, mapped_payload_hash
     from orders
     where integration_id = $1
     order by updated_at asc
     limit $2`,
    [integration.id, config.maxBatch]
  );

  const metrics: StepMetrics = { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 };

  for (const order of result.rows) {
    const payload = order.source_payload;
    const nextHash = payloadHash(payload);

    if (order.mapped_payload_hash && order.mapped_payload_hash === nextHash) {
      metrics.skipped += 1;
      continue;
    }
    metrics.processed += 1;

    const sendAttempt = await db.query<SendAttemptRow>(
      `insert into send_attempts (order_id, execution_id, status, request_payload)
       values ($1, $2, 'queued', $3::jsonb)
       returning id`,
      [order.id, executionId, JSON.stringify(payload)]
    );
    const sendAttemptId = sendAttempt.rows[0]?.id;
    if (!sendAttemptId) {
      throw new Error('Failed to create send attempt');
    }

    const url = buildUrl(config.baseUrl, config.endpoint);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...config.headers,
    };
    if (config.bearerToken) {
      headers.authorization = `Bearer ${config.bearerToken}`;
    }
    if (config.idempotencyHeader) {
      headers[config.idempotencyHeader] = `${order.source_order_id}:${nextHash}`;
    }

    let responseBody: unknown = null;
    try {
      const response = await fetch(url, {
        method: config.method,
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      responseBody = await parseResponseBody(response);

      if (!response.ok) {
        metrics.failed += 1;
        await db.query(
          `update send_attempts
           set status = 'failed',
               status_code = $2,
               response_payload = $3::jsonb,
               error = $4::jsonb
           where id = $1`,
          [
            sendAttemptId,
            response.status,
            JSON.stringify(responseBody),
            JSON.stringify({ message: 'destination request failed' }),
          ]
        );
        continue;
      }

      await db.query(
        `update send_attempts
         set status = 'success',
             status_code = $2,
             response_payload = $3::jsonb
         where id = $1`,
        [sendAttemptId, response.status, JSON.stringify(responseBody)]
      );

      await db.query(
        `update orders
         set mapped_payload = $2::jsonb,
             mapped_payload_hash = $3,
             updated_at = now()
         where id = $1`,
        [order.id, JSON.stringify(payload), nextHash]
      );

      metrics.updated += 1;
    } catch (error) {
      metrics.failed += 1;
      await db.query(
        `update send_attempts
         set status = 'failed',
             error = $2::jsonb
         where id = $1`,
        [sendAttemptId, JSON.stringify({ message: error instanceof Error ? error.message : 'unknown error', responseBody })]
      );
    }
  }

  return metrics;
}
