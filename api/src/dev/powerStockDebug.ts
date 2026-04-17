import { createDb } from '../db.js';
import { env } from '../env.js';
import { fetchPowerStockOrders } from '../connectors/powerStockConnector.js';

function envOptional(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

function envOptionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envOptionalBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'n') return false;
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  if (Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function optionalStringFromRecord(r: Record<string, unknown>, key: string): string | undefined {
  const value = r[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNumberFromRecord(r: Record<string, unknown>, key: string): number | undefined {
  const value = r[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

async function main() {
  const connectionName = process.env.POWERSTOCK_CONNECTION_NAME ?? 'canp-powerStock-acessoLogin';
  const db = createDb(env.databaseUrl);
  try {
    const result = await db.query<{
      id: string;
      name: string;
      type: 'custom';
      config: unknown;
      created_at: string;
      updated_at: string;
    }>('select * from connections where type = $1 and name = $2 order by created_at desc limit 1', ['custom', connectionName]);

    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `Conexão customizada não encontrada no banco: "${connectionName}". Crie/ajuste em /custom-connections e tente novamente.`
      );
    }

    const cfg = asRecord(row.config);
    const kind = cfg.kind;
    if (kind !== 'powerStock') {
      throw new Error(
        `Conexão "${connectionName}" não é do tipo powerStock (config.kind="${typeof kind === 'string' ? kind : 'unknown'}").`
      );
    }

    const baseUrl = optionalStringFromRecord(cfg, 'baseUrl') ?? envOptional('POWERSTOCK_BASE_URL');
    const ordersUrl = optionalStringFromRecord(cfg, 'ordersUrl') ?? envOptional('POWERSTOCK_ORDERS_URL');
    if (!baseUrl || !ordersUrl) {
      throw new Error(`Conexão "${connectionName}" precisa ter config.baseUrl e config.ordersUrl preenchidos.`);
    }

    const loginUrl = optionalStringFromRecord(cfg, 'loginUrl') ?? envOptional('POWERSTOCK_LOGIN_URL');
    const username = optionalStringFromRecord(cfg, 'username') ?? envOptional('POWERSTOCK_USERNAME');
    const password = optionalStringFromRecord(cfg, 'password') ?? envOptional('POWERSTOCK_PASSWORD');
    const usernameField = optionalStringFromRecord(cfg, 'usernameField') ?? process.env.POWERSTOCK_USERNAME_FIELD ?? 'username';
    const passwordField = optionalStringFromRecord(cfg, 'passwordField') ?? process.env.POWERSTOCK_PASSWORD_FIELD ?? 'password';
    const tableSelector = optionalStringFromRecord(cfg, 'tableSelector') ?? envOptional('POWERSTOCK_TABLE_SELECTOR');
    const operationDate =
      optionalStringFromRecord(cfg, 'operationDate') ??
      envOptional('POWERSTOCK_OPERATION_DATE') ??
      envOptional('POWERSTOCK_DATE');
    const operationDateStart =
      optionalStringFromRecord(cfg, 'operationDateStart') ??
      envOptional('POWERSTOCK_OPERATION_DATE_START') ??
      envOptional('POWERSTOCK_DATE_START');
    const operationDateEnd =
      optionalStringFromRecord(cfg, 'operationDateEnd') ??
      envOptional('POWERSTOCK_OPERATION_DATE_END') ??
      envOptional('POWERSTOCK_DATE_END');
    const timeoutMs = optionalNumberFromRecord(cfg, 'timeoutMs') ?? envOptionalNumber('POWERSTOCK_TIMEOUT_MS', 15000);
    const maxPages = optionalNumberFromRecord(cfg, 'maxPages') ?? envOptionalNumber('POWERSTOCK_MAX_PAGES', 1);

    const collected = await fetchPowerStockOrders({
      baseUrl,
      loginUrl,
      username,
      password,
      usernameField,
      passwordField,
      ordersUrl,
      tableSelector,
      operationDate,
      operationDateStart,
      operationDateEnd,
      timeoutMs,
      maxPages,
      runMode: 'browser',
      headless: false,
      slowMoMs: envOptionalNumber('POWERSTOCK_SLOWMO_MS', 1000),
      keepBrowserOpen: envOptionalBoolean('POWERSTOCK_KEEP_OPEN', true),
    });

    process.stdout.write(JSON.stringify({ ok: true, total: collected.length, items: collected }, null, 2));
    process.stdout.write('\n');
  } finally {
    await db.end().catch(() => undefined);
  }
}

await main();
