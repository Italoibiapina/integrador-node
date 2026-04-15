import { load as loadHtml } from 'cheerio';

export type PowerStockConnectionConfig = {
  baseUrl: string;
  loginUrl?: string;
  username?: string;
  password?: string;
  usernameField: string;
  passwordField: string;
  ordersUrl: string;
  tableSelector?: string;
  timeoutMs: number;
  maxPages: number;
  runMode?: 'http' | 'browser';
  headless?: boolean;
  slowMoMs?: number;
  keepBrowserOpen?: boolean;
};

function buildUrl(baseUrl: string, endpoint: string): URL {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return new URL(endpoint);
  }
  return new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

function mergeCookies(existing: string, setCookieHeaders: string[]): string {
  const jar = new Map<string, string>();
  const parts = existing
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx <= 0) continue;
    jar.set(p.slice(0, idx), p.slice(idx + 1));
  }
  for (const sc of setCookieHeaders) {
    const first = sc.split(';', 1)[0] ?? '';
    const idx = first.indexOf('=');
    if (idx <= 0) continue;
    jar.set(first.slice(0, idx), first.slice(idx + 1));
  }
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function fetchWithCookieJar(
  cookieJar: { cookie: string },
  url: URL,
  init: RequestInit & { timeoutMs: number }
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (cookieJar.cookie) headers.set('cookie', cookieJar.cookie);
  const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(init.timeoutMs) });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length) cookieJar.cookie = mergeCookies(cookieJar.cookie, setCookies);
  return response;
}

function parseOrdersFromHtml(html: string, tableSelector?: string): Record<string, unknown>[] {
  const $ = loadHtml(html);
  const table = tableSelector ? $(tableSelector).first() : $('table').first();
  if (!table.length) return [];

  const headers = table
    .find('thead tr')
    .first()
    .find('th')
    .toArray()
    .map((el) => $(el).text().trim())
    .filter(Boolean);

  const rows = table.find('tbody tr').toArray();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const cols = $(row)
      .find('td')
      .toArray()
      .map((el) => $(el).text().trim());
    if (!cols.length) continue;
    const record: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i += 1) {
      const key = headers[i] || `col${i + 1}`;
      record[key] = cols[i];
    }
    out.push(record);
  }
  return out;
}

export function parsePowerStockOrdersFromHtml(html: string, tableSelector?: string): Record<string, unknown>[] {
  return parseOrdersFromHtml(html, tableSelector);
}

type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
type Locator = {
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  click(): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
};
type Page = {
  goto(url: string, opts?: { waitUntil?: WaitUntil }): Promise<void>;
  locator(selector: string): Locator;
  waitForLoadState(state: WaitUntil): Promise<void>;
  waitForEvent(name: 'close'): Promise<void>;
  content(): Promise<string>;
};
type BrowserContext = {
  newPage(): Promise<Page>;
  close(): Promise<void>;
};
type Browser = {
  newContext(): Promise<BrowserContext>;
  close(): Promise<void>;
};
type Chromium = {
  launch(opts: { headless: boolean; slowMo?: number }): Promise<Browser>;
};

function isChromium(value: unknown): value is Chromium {
  return (
    typeof value === 'object' &&
    value !== null &&
    'launch' in value &&
    typeof (value as Record<string, unknown>).launch === 'function'
  );
}

async function loadPlaywrightChromium(): Promise<Chromium> {
  const playwrightPkg = 'playwright';
  try {
    const mod = (await import(playwrightPkg)) as unknown;
    const maybeChromium = typeof mod === 'object' && mod !== null ? (mod as Record<string, unknown>).chromium : undefined;
    if (!isChromium(maybeChromium)) {
      throw new Error('Módulo playwright carregado, mas chromium.launch não está disponível.');
    }
    return maybeChromium;
  } catch (e) {
    throw new Error(
      `PowerStock (browser): Playwright não está instalado ou não está disponível.\n` +
        `Instale no ambiente onde vai rodar:\n` +
        `npm --workspace api i -D playwright\n` +
        `npx playwright install chromium\n` +
        `Erro original: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

async function fetchPowerStockOrdersViaBrowser(config: PowerStockConnectionConfig): Promise<Record<string, unknown>[]> {
  const chromium = await loadPlaywrightChromium();
  const envHeadlessRaw = process.env.POWERSTOCK_HEADLESS;
  const envHeadlessToken = envHeadlessRaw ? envHeadlessRaw.trim().split(/[\s#(]/)[0]?.toLowerCase() : undefined;
  const envHeadless =
    envHeadlessToken === '1' || envHeadlessToken === 'true'
      ? true
      : envHeadlessToken === '0' || envHeadlessToken === 'false'
        ? false
        : undefined;
  const envSlowMoRaw = process.env.POWERSTOCK_SLOWMO_MS;
  const envSlowMoToken = envSlowMoRaw ? envSlowMoRaw.trim().split(/[\s#(]/)[0] : undefined;
  const envSlowMo = envSlowMoToken && Number.isFinite(Number(envSlowMoToken)) ? Number(envSlowMoToken) : undefined;
  const envKeepOpen = process.env.POWERSTOCK_KEEP_OPEN === '1' || process.env.POWERSTOCK_KEEP_OPEN === 'true';

  const headless = config.headless ?? envHeadless ?? true;
  const slowMo = config.slowMoMs ?? envSlowMo;

  const browser = await chromium
    .launch({
      headless,
      slowMo,
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `PowerStock (browser): falha ao iniciar o Chromium via Playwright.\n` +
          `headless=${String(headless)} slowMoMs=${String(slowMo ?? 0)}\n` +
          `Dica: instale o browser do Playwright com:\n` +
          `npm --workspace api exec playwright install chromium\n` +
          `Se der "no space left on device (ENOSPC)", libere espaço em disco ou defina PLAYWRIGHT_BROWSERS_PATH para outro local.\n` +
          `Erro original: ${msg}`
      );
    });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    if (config.loginUrl && config.username && config.password) {
      const url = buildUrl(config.baseUrl, config.loginUrl).toString();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const userLocator = page.locator(`input[name="${config.usernameField}"], input#${config.usernameField}`).first();
      const passLocator = page.locator(`input[name="${config.passwordField}"], input#${config.passwordField}`).first();
      await userLocator.fill(config.username);
      await passLocator.fill(config.password);

      const submit = page.locator('button[type="submit"], input[type="submit"]').first();
      if ((await submit.count()) > 0) {
        await submit.click();
      } else {
        await passLocator.press('Enter');
      }

      await page.waitForLoadState('networkidle');
    }

    const out: Record<string, unknown>[] = [];

    for (let pageCount = 0; pageCount < config.maxPages; pageCount += 1) {
      const pageNumber = pageCount + 1;
      const endpoint = config.ordersUrl.includes('{page}') ? config.ordersUrl.replaceAll('{page}', String(pageNumber)) : config.ordersUrl;
      const ordersUrl = buildUrl(config.baseUrl, endpoint);
      if (!config.ordersUrl.includes('{page}') && config.maxPages > 1) {
        ordersUrl.searchParams.set('page', String(pageNumber));
      }

      await page.goto(ordersUrl.toString(), { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');

      const html = await page.content();
      const items = parsePowerStockOrdersFromHtml(html, config.tableSelector);
      if (items.length === 0) break;
      out.push(...items);
    }

    if (config.keepBrowserOpen ?? envKeepOpen) {
      await page.waitForEvent('close');
    }

    return out;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function fetchPowerStockOrders(config: PowerStockConnectionConfig): Promise<Record<string, unknown>[]> {
  const envRunMode =
    process.env.POWERSTOCK_RUN_MODE === 'browser' || process.env.POWERSTOCK_RUN_MODE === 'BROWSER' ? 'browser' : undefined;
  const runMode = config.runMode ?? envRunMode ?? 'http';
  if (runMode === 'browser') {
    return fetchPowerStockOrdersViaBrowser(config);
  }

  const cookieJar = { cookie: '' };

  if (config.loginUrl && config.username && config.password) {
    const loginUrl = buildUrl(config.baseUrl, config.loginUrl);
    const form = new URLSearchParams();
    form.set(config.usernameField, config.username);
    form.set(config.passwordField, config.password);

    const res = await fetchWithCookieJar(cookieJar, loginUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      timeoutMs: config.timeoutMs,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PowerStock login failed: ${res.status} ${body.slice(0, 400)}`);
    }
  }

  const out: Record<string, unknown>[] = [];

  for (let pageCount = 0; pageCount < config.maxPages; pageCount += 1) {
    const pageNumber = pageCount + 1;
    const endpoint = config.ordersUrl.includes('{page}') ? config.ordersUrl.replaceAll('{page}', String(pageNumber)) : config.ordersUrl;
    const ordersUrl = buildUrl(config.baseUrl, endpoint);
    if (!config.ordersUrl.includes('{page}') && config.maxPages > 1) {
      ordersUrl.searchParams.set('page', String(pageNumber));
    }

    const res = await fetchWithCookieJar(cookieJar, ordersUrl, {
      method: 'GET',
      timeoutMs: config.timeoutMs,
    });
    const html = await res.text();
    if (!res.ok) {
      throw new Error(`PowerStock fetch failed: ${res.status} ${html.slice(0, 400)}`);
    }

    const items = parsePowerStockOrdersFromHtml(html, config.tableSelector);
    if (items.length === 0) break;
    out.push(...items);
  }

  return out;
}
