import { load as loadHtml } from 'cheerio';

export type OrdersWebscrapeConnectionConfig = {
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

export async function fetchOrdersWebscrapeOrders(config: OrdersWebscrapeConnectionConfig): Promise<Record<string, unknown>[]> {
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
      throw new Error(`OrdersWebscrape login failed: ${res.status} ${body.slice(0, 400)}`);
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
      throw new Error(`OrdersWebscrape fetch failed: ${res.status} ${html.slice(0, 400)}`);
    }

    const items = parseOrdersFromHtml(html, config.tableSelector);
    if (items.length === 0) break;
    out.push(...items);
  }

  return out;
}

