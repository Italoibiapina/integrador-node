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
  operationDate?: string;
  operationDateStart?: string;
  operationDateEnd?: string;
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

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parsePowerStockCustomerFromDetailsHtml(html: string): Record<string, unknown> {
  const $ = loadHtml(html);
  const out: Record<string, unknown> = {};

  const mailto = $('a[href^="mailto:"]').first().attr('href');
  if (mailto) {
    const email = mailto.replace(/^mailto:/i, '').split('?')[0]?.trim();
    if (email) out.email = email;
  } else {
    const bodyText = normalizeSpaces($('body').text());
    const m = bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (m?.[0]) out.email = m[0];
  }

  const telHref = $('a[href^="tel:"]').first().attr('href');
  if (telHref) {
    const phone = telHref.replace(/^tel:/i, '').trim();
    if (phone) out.telefone = phone;
  }

  const labelValue = (label: RegExp): string | undefined => {
    const candidates = $('body')
      .find('p, span, div, dt, th, td, label, strong')
      .toArray();
    for (const el of candidates) {
      const raw = normalizeSpaces($(el).text());
      const cleaned = raw.replace(/:\s*$/g, '').trim();
      if (!label.test(cleaned)) continue;

      let next = $(el).next();
      for (let hop = 0; hop < 8 && next.length; hop += 1) {
        const nextText = normalizeSpaces(next.text());
        if (nextText) return nextText;
        next = next.next();
      }

      const parent = $(el).parent();
      if (parent.length) {
        const kids = parent.children().toArray();
        const idx = kids.findIndex((k) => k === el);
        if (idx >= 0) {
          for (let j = idx + 1; j < Math.min(kids.length, idx + 9); j += 1) {
            const siblingText = normalizeSpaces($(kids[j]).text());
            if (siblingText) return siblingText;
          }
        }
        let parentNext = parent.next();
        for (let hop = 0; hop < 8 && parentNext.length; hop += 1) {
          const parentNextText = normalizeSpaces(parentNext.text());
          if (parentNextText) return parentNextText;
          parentNext = parentNext.next();
        }
      }
    }
    return undefined;
  };

  const endereco = labelValue(/^endere[cç]o$/i);
  if (endereco) out.endereco = endereco;

  const telefoneFromLabel = labelValue(/^telefone$/i);
  if (telefoneFromLabel && !out.telefone) out.telefone = telefoneFromLabel;

  return out;
}

function parsePowerStockOrderItemsFromHtml(html: string): Record<string, unknown>[] {
  const $ = loadHtml(html);
  const tables = $('table').toArray();
  if (!tables.length) return [];

  const keywords = ['produto', 'descrição', 'descricao', 'quantidade', 'qtd', 'valor', 'preço', 'preco', 'total', 'item'];

  let best: { table: ReturnType<typeof $>; score: number; rows: number } | undefined;
  for (const t of tables) {
    const table = $(t);
    const headers = table
      .find('thead tr')
      .first()
      .find('th')
      .toArray()
      .map((el) => $(el).text().trim().toLowerCase())
      .filter(Boolean);

    const rows = table.find('tbody tr').toArray().length;
    if (!rows) continue;

    let score = 0;
    for (const h of headers) {
      for (const k of keywords) {
        if (h.includes(k)) score += 1;
      }
    }
    score += Math.min(rows, 50) / 10;
    if (!best || score > best.score) best = { table, score, rows };
  }

  if (!best) return [];

  const table = best.table;
  const headers = table
    .find('thead tr')
    .first()
    .find('th')
    .toArray()
    .map((el) => $(el).text().trim())
    .filter(Boolean);

  const headerLower = headers.map((h) => h.toLowerCase());
  const descIdx = headerLower.findIndex((h) => h.includes('descri') || h.includes('produto'));

  const rows = table.find('tbody tr').toArray();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const tds = $(row).find('td').toArray();
    if (!tds.length) continue;
    const record: Record<string, unknown> = {};
    for (let i = 0; i < tds.length; i += 1) {
      const key = headers[i] || `col${i + 1}`;
      const cell = $(tds[i]);
      const rawCellText = cell.text();
      const lines = rawCellText
        .split(/\r?\n/g)
        .map((l) => normalizeSpaces(l))
        .filter(Boolean);
      const cellText = normalizeSpaces(rawCellText);

      if (i === descIdx && cellText) {
        const pLines = cell
          .find('p')
          .toArray()
          .map((el) => normalizeSpaces($(el).text()))
          .filter(Boolean);

        const firstP = cell.find('p').first();
        const container = firstP.length ? firstP.parent() : undefined;
        const siblingPLines =
          container && container.length
            ? container
                .children('p')
                .toArray()
                .map((el) => normalizeSpaces($(el).text()))
                .filter(Boolean)
            : [];

        const descricao = siblingPLines[0]
          ? siblingPLines[0]
          : pLines[0]
            ? pLines[0]
            : lines[0]
              ? normalizeSpaces(lines[0])
              : cellText;
        const statusEntrega = siblingPLines.length >= 2 ? siblingPLines[siblingPLines.length - 1] : '';
        record[key] = descricao;
        record.statusEntrega = statusEntrega;
      } else {
        record[key] = cellText;
      }
    }
    out.push(record);
  }
  return out;
}

type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
type Locator = {
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  click(): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  isChecked(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
};
type Page = {
  goto(url: string, opts?: { waitUntil?: WaitUntil }): Promise<void>;
  locator(selector: string): Locator;
  waitForLoadState(state: WaitUntil): Promise<void>;
  waitForEvent(name: 'close'): Promise<void>;
  content(): Promise<string>;
  url(): string;
  waitForURL(urlOrPredicate: string | RegExp, opts?: { timeout?: number }): Promise<void>;
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

export type PowerStockBrowserPage = Page;

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

export type PowerStockBrowserLoginConfig = {
  baseUrl: string;
  loginUrl: string;
  username: string;
  password: string;
  usernameField: string;
  passwordField: string;
  timeoutMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForLoadStateBestEffort(page: Page, state: WaitUntil, timeoutMs: number): Promise<boolean> {
  const t = Math.max(0, timeoutMs);
  const ok = await Promise.race([
    page
      .waitForLoadState(state)
      .then(() => true)
      .catch(() => false),
    sleep(t).then(() => false),
  ]);
  return ok;
}

async function waitForUrlBestEffort(page: Page, urlOrPredicate: string | RegExp, timeoutMs: number): Promise<boolean> {
  const t = Math.max(0, timeoutMs);
  const ok = await Promise.race([
    page
      .waitForURL(urlOrPredicate, { timeout: t })
      .then(() => true)
      .catch(() => false),
    sleep(t).then(() => false),
  ]);
  return ok;
}

async function goBackBestEffort(page: Page, timeoutMs: number): Promise<boolean> {
  const maybe = page as unknown as {
    goBack?: (opts?: { waitUntil?: WaitUntil; timeout?: number }) => Promise<unknown>;
  };
  if (!maybe.goBack) return false;
  const t = Math.max(0, timeoutMs);
  const ok = await maybe
    .goBack({ waitUntil: 'domcontentloaded', timeout: t })
    .then(() => true)
    .catch(() => false);
  return ok;
}

async function tryClickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if ((await loc.count()) > 0) {
      await loc.click();
      return true;
    }
  }
  return false;
}

async function maybeAcceptCookies(page: Page): Promise<boolean> {
  return tryClickFirst(page, ['button:has-text("Aceitar todas")', 'text=Aceitar todas', 'button:has-text("Aceitar")']);
}

async function waitForTable(page: Page, tableSelector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.locator(tableSelector).first().count();
    if (count > 0) return true;
    await sleep(250);
  }
  return false;
}

async function tryClickFirstEnabled(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    const count = await loc.count().catch(() => 0);
    if (count <= 0) continue;
    const disabled = await loc.getAttribute('disabled').catch(() => null);
    if (disabled !== null) continue;
    const ariaDisabled = await loc.getAttribute('aria-disabled').catch(() => null);
    if (ariaDisabled === 'true') continue;
    const ok = await loc
      .click()
      .then(() => true)
      .catch(() => false);
    if (ok) return true;
  }
  return false;
}

function extractActivePageFromHtml(html: string): number | undefined {
  const m = html.match(/<button[^>]*data-active[^>]*>\s*(\d+)\s*<\/button>/i);
  if (!m?.[1]) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function computeOrdersSignature(orders: Record<string, unknown>[]): string {
  const toSig = (r: Record<string, unknown> | undefined): string => {
    if (!r) return '';
    return Object.entries(r)
      .filter(([k, v]) => k !== 'cliente' && k !== 'items' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
      .map(([k, v]) => `${k}=${String(v).slice(0, 80)}`)
      .join('|')
      .slice(0, 240);
  };

  const firstSig = toSig(orders[0]);
  const lastSig = toSig(orders.length > 1 ? orders[orders.length - 1] : undefined);
  return `${orders.length}:${firstSig}:${lastSig}`;
}

async function waitForOrdersDifferentFromSignature(
  page: Page,
  tableSelector: string | undefined,
  previousSignature: string,
  timeoutMs: number
): Promise<Record<string, unknown>[] | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const html = await page.content();
    const orders = parsePowerStockOrdersFromHtml(html, tableSelector);
    if (orders.length) {
      const active = extractActivePageFromHtml(html) ?? 0;
      const sig = `${String(active)}:${computeOrdersSignature(orders)}`;
      if (sig !== previousSignature) return orders;
    }
    await sleep(250);
  }
  return undefined;
}

async function goToNextOperationsListPage(page: Page, timeoutMs: number): Promise<boolean> {
  const htmlBefore = await page.content();
  const activeBefore = extractActivePageFromHtml(htmlBefore);

  const clicked = await tryClickFirstEnabled(page, [
    'button[data-active] + button',
    'div:has(button[data-active]) button:has-text("»")',
    'button:has-text("»")',
  ]);
  if (!clicked) return false;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const htmlNow = await page.content();
    const activeNow = extractActivePageFromHtml(htmlNow);
    if (activeBefore && activeNow && activeNow !== activeBefore) return true;
    if (!activeBefore && htmlNow !== htmlBefore) return true;
    await sleep(250);
  }
  return true;
}

async function waitForDetailsLoaded(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const html = await page.content();
    if (/Itens do pedido/i.test(html) || /Itens do Pedido/i.test(html)) return true;
    if (/Endere[cç]o/i.test(html) && /Telefone/i.test(html)) return true;
    await sleep(250);
  }
  return false;
}

async function waitForUrlChangeBestEffort(page: Page, fromUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = (() => {
      try {
        return page.url();
      } catch {
        return '';
      }
    })();
    if (url && url !== fromUrl) return true;
    await sleep(200);
  }
  return false;
}

async function openDetailsForIndex(page: Page, index: number, timeoutMs: number): Promise<boolean> {
  const idx = index + 1;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clicked = await tryClickFirst(page, [
      `:nth-match(#menu-button-mostrarMais, ${idx})`,
      `:nth-match([id="menu-button-mostrarMais"], ${idx})`,
      `:nth-match(button#menu-button-mostrarMais, ${idx})`,
      `:nth-match([aria-label*="mostrar" i], ${idx})`,
      `:nth-match([aria-label*="mais" i], ${idx})`,
    ]);
    if (!clicked) return false;

    const menuOpened = await waitForAnySelector(
      page,
      ['[role="menu"]', '[role="menuitem"]', 'text=Detalhe', 'text=Detalhes', 'text=Mostrar mais', 'text=Visualizar'],
      Math.max(500, Math.min(timeoutMs, 3000))
    );
    if (!menuOpened) {
      await sleep(250);
      continue;
    }

    const listUrlBefore = (() => {
      try {
        return page.url();
      } catch {
        return '';
      }
    })();

    const detailClicked = await tryClickFirst(page, [
      '[role="menuitem"]:has-text("Detalhe")',
      '[role="menuitem"]:has-text("Detalhes")',
      '[role="menuitem"]:has-text("Ver detalhe")',
      '[role="menuitem"]:has-text("Ver detalhes")',
      'text=Ver detalhe',
      'text=Ver detalhes',
      'text=Detalhe',
      'text=Detalhes',
    ]);
    if (!detailClicked) {
      await sleep(250);
      continue;
    }

    await Promise.race([waitForLoadStateBestEffort(page, 'domcontentloaded', Math.min(timeoutMs, 5000)), sleep(300)]);
    await Promise.race([waitForUrlChangeBestEffort(page, listUrlBefore, Math.min(timeoutMs, 8000)), sleep(300)]);
    const loaded = await waitForDetailsLoaded(page, timeoutMs);
    if (loaded) return true;
  }

  return false;
}

async function closeDetailsToReturnToList(page: Page, _tableSelector: string, timeoutMs: number): Promise<void> {
  const alreadyOnList = await waitForAnySelector(
    page,
    [
      '#menu-button-mostrarMais',
      'button#menu-button-mostrarMais',
      '[id="menu-button-mostrarMais"]',
      '#select-container-undefined',
      '#select-container-undefined [role="combobox"]',
      '#select-container-undefined input',
    ],
    250
  );
  if (alreadyOnList) return;

  const wentBack = await goBackBestEffort(page, Math.min(6000, timeoutMs));
  if (wentBack) {
    const listReady = await waitForAnySelector(
      page,
      [
        'text=Operações',
        '#select-container-undefined',
        '#select-container-undefined [role="combobox"]',
        '#select-container-undefined input',
        '[role="combobox"]',
        '[aria-haspopup="listbox"]',
        '#menu-button-mostrarMais',
        'button#menu-button-mostrarMais',
        '[id="menu-button-mostrarMais"]',
      ],
      timeoutMs
    );
    if (listReady) return;
  }

  const clicked = await tryClickFirst(page, [
    'button:has(svg.chakra-icon polyline[points="15 18 9 12 15 6"])',
    'button:has(svg[class*="chakra-icon"] polyline[points="15 18 9 12 15 6"])',
    'button:has(polyline[points="15 18 9 12 15 6"])',
    'a:has(svg.chakra-icon polyline[points="15 18 9 12 15 6"])',
    'a:has(svg[class*="chakra-icon"] polyline[points="15 18 9 12 15 6"])',
    'a:has(polyline[points="15 18 9 12 15 6"])',
    'a:has-text("Operações")',
    'a[href*="/operacoes"]',
    'a[href*="operacoes"]',
    'button[aria-label*="voltar" i]',
    'a[aria-label*="voltar" i]',
    'button:has-text("Voltar")',
    'a:has-text("Voltar")',
  ]);

  if (clicked) {
    await Promise.race([
      waitForUrlBestEffort(page, /\/operacoes/i, Math.min(8000, timeoutMs)),
      waitForLoadStateBestEffort(page, 'load', Math.min(5000, timeoutMs)),
      sleep(250),
    ]);

    const listReady = await waitForAnySelector(
      page,
      [
        'text=Operações',
        '#select-container-undefined',
        '#select-container-undefined [role="combobox"]',
        '#select-container-undefined input',
        '[role="combobox"]',
        '[aria-haspopup="listbox"]',
        '#menu-button-mostrarMais',
        'button#menu-button-mostrarMais',
        '[id="menu-button-mostrarMais"]',
      ],
      timeoutMs
    );
    if (listReady) return;
  }

  throw new Error('PowerStock (browser): não consegui voltar da tela de detalhes para a lista.');
}

async function waitForText(page: Page, needle: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const html = await page.content();
    if (html.includes(needle)) return true;
    await sleep(250);
  }
  return false;
}

async function waitForAnySelector(page: Page, selectors: string[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const loc = page.locator(selector).first();
      if ((await loc.count()) > 0) return true;
    }
    await sleep(250);
  }
  return false;
}

async function setCheckboxState(page: Page, labelText: string, desired: boolean): Promise<boolean> {
  const input = page
    .locator(
      [
        `#select-container-undefined label:has-text("${labelText}") input[type="checkbox"]`,
        `#select-container-undefined .react-select__option:has-text("${labelText}") input[type="checkbox"]`,
        `#select-container-undefined [role="option"]:has-text("${labelText}") input[type="checkbox"]`,
        `.react-select__option:has-text("${labelText}") input[type="checkbox"]`,
        `[role="option"]:has-text("${labelText}") input[type="checkbox"]`,
        `label:has-text("${labelText}") input[type="checkbox"]`,
        `li:has-text("${labelText}") input[type="checkbox"]`,
        `div:has-text("${labelText}") input[type="checkbox"]`,
      ].join(', ')
    )
    .first();
  if ((await input.count()) > 0) {
    const checked = await input
      .isChecked()
      .then((v) => v)
      .catch(async () => {
        const ariaChecked = await input.getAttribute('aria-checked').catch(() => null);
        if (ariaChecked === 'true') return true;
        if (ariaChecked === 'false') return false;
        return undefined;
      });
    if (checked === undefined) {
      return false;
    }
    if (checked !== desired) {
      const clickable = page
        .locator(
          [
            `#select-container-undefined label:has-text("${labelText}")`,
            `#select-container-undefined .react-select__option:has-text("${labelText}")`,
            `#select-container-undefined [role="option"]:has-text("${labelText}")`,
            `label:has-text("${labelText}")`,
            `.react-select__option:has-text("${labelText}")`,
            `[role="option"]:has-text("${labelText}")`,
            `li:has-text("${labelText}")`,
            `div:has-text("${labelText}")`,
          ].join(', ')
        )
        .first();
      if ((await clickable.count()) > 0) await clickable.click();
      else await input.click();
    }
    return true;
  }

  const ariaOption = page.locator(`[role="option"]:has-text("${labelText}")`).first();
  if ((await ariaOption.count()) > 0) {
    const ariaSelected = await ariaOption.getAttribute('aria-selected').catch(() => null);
    const ariaChecked = await ariaOption.getAttribute('aria-checked').catch(() => null);
    const isSelected = ariaSelected === 'true' || ariaChecked === 'true';
    if (isSelected !== desired) await ariaOption.click();
    return true;
  }

  const reactSelectOption = page.locator(`.react-select__option:has-text("${labelText}")`).first();
  if ((await reactSelectOption.count()) > 0) {
    const ariaSelected = await reactSelectOption.getAttribute('aria-selected').catch(() => null);
    const isSelected = ariaSelected === 'true';
    if (isSelected !== desired) await reactSelectOption.click();
    return true;
  }

  const reactSelectOptionById = page.locator(`div[id^="react-select-"][id*="-option-"]:has-text("${labelText}")`).first();
  if ((await reactSelectOptionById.count()) > 0) {
    const ariaSelected = await reactSelectOptionById.getAttribute('aria-selected').catch(() => null);
    const isSelected = ariaSelected === 'true';
    if (isSelected !== desired) await reactSelectOptionById.click();
    return true;
  }

  return false;
}

async function openOperationTypeDropdown(page: Page, timeoutMs: number): Promise<boolean> {
  const alreadyOpen = (await page.locator('text=Todas as operações').first().count()) > 0;
  if (alreadyOpen) return true;

  const clicked = await tryClickFirst(page, [
    '#select-container-undefined',
    '#select-container-undefined [role="combobox"]',
    '#select-container-undefined input',
    '#select-container-undefined button',
    '[role="combobox"]',
    'div[role="combobox"]',
    '[aria-haspopup="listbox"]',
    'text=/Vendas\\s*,\\s*Devolu/i',
    'text=Vendas,Devoluções',
    'text=Vendas, Devoluções',
    'text=Todas as operações',
  ]);
  if (!clicked) return false;

  const opened = await waitForAnySelector(
    page,
    [
      '#select-container-undefined [role="listbox"]',
      '[role="listbox"]',
      '.react-select__menu',
      'div[class*="react-select__menu"]',
      'text=Todas as operações',
    ],
    timeoutMs
  );
  return opened;
}

async function setOperationTypeCheckboxWithReopen(page: Page, labelText: string, desired: boolean, timeoutMs: number): Promise<void> {
  const opened = await openOperationTypeDropdown(page, timeoutMs);
  if (!opened) {
    throw new Error('PowerStock (browser): não consegui abrir o filtro de tipos de operação na tela de Operações.');
  }
  const ok = await setCheckboxState(page, labelText, desired);
  if (!ok) {
    throw new Error(`PowerStock (browser): não consegui aplicar o filtro do tipo de operação "${labelText}".`);
  }
}

async function ensureOperationTypesOnly(page: Page, timeoutMs: number): Promise<void> {
  console.log('ensureOperationTypesOnly:', new Date().toLocaleString());
  const opened = await openOperationTypeDropdown(page, timeoutMs);
  if (!opened) {
    throw new Error('PowerStock (browser): não consegui abrir o filtro de tipos de operação na tela de Operações.');
  }

  console.log('operationTypeDropdownOpened:', new Date().toLocaleString());

  await setOperationTypeCheckboxWithReopen(page, 'Todas as operações', false, timeoutMs);
  console.log('setTodasAsOperacoes:', new Date().toLocaleString());
  await setOperationTypeCheckboxWithReopen(page, 'Vendas', true, timeoutMs);
  console.log('setVendas:', new Date().toLocaleString()); 
  await setOperationTypeCheckboxWithReopen(page, 'Devoluções', true, timeoutMs);
  console.log('setDevolucoes:', new Date().toLocaleString());
  await setOperationTypeCheckboxWithReopen(page, 'Pedidos', false, timeoutMs);
  console.log('setPedidos:', new Date().toLocaleString());
  await setOperationTypeCheckboxWithReopen(page, 'Orçamentos', false, timeoutMs);
  console.log('setOrçamentos:', new Date().toLocaleString());
  await setOperationTypeCheckboxWithReopen(page, 'Consignações', false, timeoutMs);
  console.log('setConsignacoes:', new Date().toLocaleString()); 
}

function parseOperationDateInput(value: string): { iso?: string; br?: string } {
  let v = value.trim();
  for (let i = 0; i < 3; i += 1) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      v = v.slice(1, -1).trim();
    } else {
      break;
    }
  }
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return { iso: `${y}-${m}-${d}`, br: `${d}/${m}/${y}` };
  }
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const [, d, m, y] = br;
    return { iso: `${y}-${m}-${d}`, br: `${d}/${m}/${y}` };
  }
  return {};
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

async function tryFillFirst(page: Page, selectors: string[], value: string): Promise<boolean> {
  console.log('******* Valor Data a ser preenchido:', value);
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    const count = await loc.count().catch(() => 0);
    if (count <= 0) continue;
    console.log('tryFillFirst Campo:', selector);

    await loc.click().catch(() => undefined);
    await loc.fill('').catch(() => undefined);

    const ok = await loc
      .fill(value)
      .then(() => true)
      .catch(() => false);
    if (!ok) continue;

    const attr = await loc.getAttribute('value').catch(() => null);
    if (!attr) return true;

    const expected = digitsOnly(value);
    const got = digitsOnly(attr);
    if (expected && expected.length >= 8 && got === expected) return true;

    const alt = expected;
    if (alt && alt !== value) {
      await loc.fill('').catch(() => undefined);
      const okAlt = await loc
        .fill(alt)
        .then(() => true)
        .catch(() => false);
      if (!okAlt) continue;

      const attrAlt = await loc.getAttribute('value').catch(() => null);
      if (!attrAlt) return true;
      if (digitsOnly(attrAlt) === expected) return true;
    }
    continue;
  }
  return false;
}

async function tryPressFirst(page: Page, selectors: string[], key: string): Promise<boolean> {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    const count = await loc.count().catch(() => 0);
    if (count <= 0) continue;
    const ok = await loc
      .press(key)
      .then(() => true)
      .catch(() => false);
    if (ok) return true;
  }
  return false;
}

async function openOperationsDateFilterIfNeeded(page: Page, timeoutMs: number): Promise<void> {

  const dateInputsNow = await page.locator('input[type="date"], #dateInitial, input#dateInitial').count().catch(() => 0);
  if (dateInputsNow > 0) return;

  const opened = await tryClickFirst(page, [
    'label:has-text("Período") + div',
    'label:has-text("Periodo") + div',
    'label:has-text("Período")',
    'label:has-text("Periodo")',
    'button:has-text("Filtros")',
    'button:has-text("Filtro")',
    'button:has-text("Filtrar")',
    'button[aria-label*="filtro" i]',
    '[aria-label*="filtro" i]',
    '[data-testid*="filter" i]',
    'button:has-text("Período")',
    'button:has-text("Periodo")',
  ]);

  if (!opened) return;

  await waitForAnySelector(
    page,
    [
      'input[type="date"]',
      'input#dateInitial',
      'input[placeholder*="data" i]',
      'input[placeholder="00/00/0000"]',
      'input[aria-label*="data" i]',
      'text=/data\\s+inicial/i',
      'text=/data\\s+final/i',
      'text=/per[ií]odo/i',
    ],
    Math.max(500, Math.min(timeoutMs, 4000))
  );
}

async function applyOperationDateFilter(
  page: Page,
  operationDateStart: string | undefined,
  operationDateEnd: string | undefined,
  timeoutMs: number
): Promise<void> {
  const rawStart = operationDateStart?.trim();
  const rawEnd = operationDateEnd?.trim();
  if (!rawStart && !rawEnd) return;

  const start = rawStart ?? rawEnd ?? '';
  const end = rawEnd ?? rawStart ?? '';

  const startParsed = parseOperationDateInput(start);
  const endParsed = parseOperationDateInput(end);
  const startClean = start.replaceAll('"', '').replaceAll("'", '').trim();
  const endClean = end.replaceAll('"', '').replaceAll("'", '').trim();

  const startValueForDateInputs = startParsed.iso ?? startClean;
  const startValueForTextInputs = startParsed.br ?? startClean;
  const endValueForDateInputs = endParsed.iso ?? endClean;
  const endValueForTextInputs = endParsed.br ?? endClean;

  await openOperationsDateFilterIfNeeded(page, timeoutMs);

  const startSelectorsText = [
    '#dateInitial',
    'input#dateInitial',
    'input[placeholder*="data inicial" i]',
    'input[aria-label*="data inicial" i]',
    'input[name*="dataInicial" i]',
    'input[id*="dataInicial" i]',
    'input[placeholder*="inicial" i]',
    'input[aria-label*="inicial" i]',
    ':nth-match(input[placeholder="00/00/0000"], 1)',
    ':nth-match(input[placeholder*="data" i], 1)',
    ':nth-match(input[aria-label*="data" i], 1)',
  ];

  const startSelectorsDate = [':nth-match(input[type="date"], 1)'];

  const endSelectorsText = [
    'input[placeholder*="data final" i]',
    'input[aria-label*="data final" i]',
    'input[name*="dataFinal" i]',
    'input[id*="dataFinal" i]',
    'input[placeholder*="final" i]',
    'input[aria-label*="final" i]',
    'xpath=//input[@id="dateInitial"]/following::input[@placeholder="00/00/0000"][1]',
    ':nth-match(input[placeholder="00/00/0000"], 2)',
    ':nth-match(input[placeholder*="data" i], 2)',
    ':nth-match(input[aria-label*="data" i], 2)',
  ];

  const endSelectorsDate = [':nth-match(input[type="date"], 2)'];

  let startFilled =
    (await tryFillFirst(page, startSelectorsText, startValueForTextInputs)) ||
    (await tryFillFirst(page, startSelectorsDate, startValueForDateInputs));

  let endFilled =
    (await tryFillFirst(page, endSelectorsText, endValueForTextInputs)) || (await tryFillFirst(page, endSelectorsDate, endValueForDateInputs));

  console.log('startFilled:', startFilled);
  console.log('endFilled:', endFilled);

  if (startFilled && !endFilled) {
    endFilled =
      (await tryFillFirst(page, endSelectorsText, endValueForTextInputs).catch(() => false)) ||
      (await tryFillFirst(page, endSelectorsDate, endValueForDateInputs).catch(() => false)) ||
      endFilled;
  }

  if (!startFilled && !endFilled) {
    startFilled =
      (await tryFillFirst(page, ['#dateInitial', 'input#dateInitial', 'input[placeholder="00/00/0000"]'], startValueForTextInputs)) ||
      (await tryFillFirst(page, [':nth-match(input[type="date"], 1)'], startValueForDateInputs)) ||
      startFilled;
    endFilled =
      (await tryFillFirst(page, endSelectorsText, endValueForTextInputs)) ||
      (await tryFillFirst(page, [':nth-match(input[type="date"], 2)'], endValueForDateInputs)) ||
      endFilled;
  }

  const anyDateInputs = await page
    .locator('input[type="date"], #dateInitial, input#dateInitial, input[placeholder="00/00/0000"], input[placeholder*="data" i], input[aria-label*="data" i]')
    .count()
    .catch(() => 0);
  if (!startFilled && !endFilled && anyDateInputs === 0) {
    throw new Error(
      `PowerStock (browser): período informado (inicio=${startClean} fim=${endClean}), mas não encontrei campos de data na tela de Operações para aplicar o filtro.`
    );
  }

  const confirmed =
    startFilled || endFilled
      ? await tryClickFirst(page, ['button:has-text("Confirmar")', 'button[type="button"]:has-text("Confirmar")'])
      : false;

  if (confirmed) {
    await Promise.race([waitForLoadStateBestEffort(page, 'load', Math.min(5000, timeoutMs)), sleep(600)]);
    await sleep(400);
    return;
  }

  const applied = await tryClickFirst(page, [
    'button:has-text("Aplicar")',
    'button:has-text("Filtrar")',
    'button:has-text("Buscar")',
    'button:has-text("Pesquisar")',
  ]);

  if (!applied) {
    await tryPressFirst(page, [...endSelectorsText, ...endSelectorsDate], 'Enter');
    await tryPressFirst(page, [...startSelectorsText, ...startSelectorsDate], 'Enter');
  }

  await Promise.race([waitForLoadStateBestEffort(page, 'load', Math.min(5000, timeoutMs)), sleep(600)]);
  await sleep(400);
}

async function maybeConfirmConcurrentSession(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const title = page.locator('text=Encerrar sessão anterior').first();
  const continueBtn = page.locator('button:has-text("Continuar")').first();
  const continueText = page.locator('text=Continuar').first();

  while (Date.now() < deadline) {
    if ((await title.count()) > 0) {
      if ((await continueBtn.count()) > 0) {
        await continueBtn.click();
        await waitForLoadStateBestEffort(page, 'load', timeoutMs);
        return true;
      }
      if ((await continueText.count()) > 0) {
        await continueText.click();
        await waitForLoadStateBestEffort(page, 'load', timeoutMs);
        return true;
      }
    }
    await sleep(200);
  }

  return false;
}

export async function powerStockBrowserLogin(page: Page, config: PowerStockBrowserLoginConfig): Promise<void> {
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

  //await sleep(5000);

  const settleMs = Math.min(5000, Math.max(1000, config.timeoutMs ?? 15000));
  await Promise.race([waitForLoadStateBestEffort(page, 'load', settleMs), maybeConfirmConcurrentSession(page, settleMs)]);
  await sleep(2000); // delay necesários , nçao sei pro que, mas se não possuir este delay ele nã ofuncina, volta para pagian de login 
  await maybeConfirmConcurrentSession(page, settleMs);
  await waitForLoadStateBestEffort(page, 'load', settleMs);
  console.log('login completed:', new Date().toLocaleString());
  //await sleep(5000);
}

async function openOrdersPage(page: Page, config: PowerStockConnectionConfig): Promise<void> {
  const settleMs = Math.max(1000, config.timeoutMs);
  await maybeAcceptCookies(page);
/* 
  await waitForLoadStateBestEffort(page, 'load', settleMs);
  const postLoginWaitRaw = process.env.POWERSTOCK_POST_LOGIN_WAIT_MS;
  const postLoginWaitParsed = postLoginWaitRaw ? Number(postLoginWaitRaw) : undefined;
  const postLoginWaitMs =
    postLoginWaitParsed && Number.isFinite(postLoginWaitParsed)
      ? Math.max(0, postLoginWaitParsed)
      : config.headless === false
        ? 10000
        : 0;
  if (postLoginWaitMs > 0) {
    await sleep(postLoginWaitMs);
  }
  await maybeAcceptCookies(page);
  const loginUser = page.locator(`input[name="${config.usernameField}"], input#${config.usernameField}`).first();
  const loginPass = page.locator(`input[name="${config.passwordField}"], input#${config.passwordField}`).first();
  if ((await loginUser.count()) > 0 && (await loginPass.count()) > 0) {
    throw new Error('PowerStock (browser): após o login, fui redirecionado de volta para a tela de login.');
  }

  if (process.env.POWERSTOCK_STOP_AFTER_LOGIN === '1' || process.env.POWERSTOCK_STOP_AFTER_LOGIN === 'true') {
    return;
  }
 */
  const vendasSelectors = ['a:has-text("Vendas")', 'button:has-text("Vendas")', 'text=Vendas'];
  const vendasReady = await waitForAnySelector(page, vendasSelectors, Math.max(settleMs, 15000));
  if (!vendasReady) {
    const currentUrl = (() => {
      try {
        return page.url();
      } catch {
        return '';
      }
    })();
    throw new Error(`PowerStock (browser): menu "Vendas" não apareceu após o login. url=${currentUrl}`);
  }
  
  console.log('vendasReady:', new Date().toLocaleString());

  const salesOpened = await tryClickFirst(page, vendasSelectors);
  if (!salesOpened) {
    const currentUrl = (() => {
      try {
        return page.url();
      } catch {
        return '';
      }
    })();
    throw new Error(`PowerStock (browser): não consegui clicar no menu "Vendas" após o login. url=${currentUrl}`);
  }
  await waitForLoadStateBestEffort(page, 'load', settleMs);
  await maybeAcceptCookies(page);

  console.log('operationsOpened:', new Date().toLocaleString());
  
  const operationsOpened = await tryClickFirst(page, ['a:has-text("Operações")', 'button:has-text("Operações")', 'text=Operações']);
  if (!operationsOpened) {
    throw new Error('PowerStock (browser): não consegui clicar no submenu "Operações" dentro de "Vendas".');
  }
  await waitForLoadStateBestEffort(page, 'load', settleMs);
  await maybeAcceptCookies(page);

  const isOperations = await waitForText(page, 'Operações', settleMs);
  if (!isOperations) {
    throw new Error('PowerStock (browser): não consegui confirmar que a tela de Operações abriu.');
  }

  console.log('isOperations:', new Date().toLocaleString());

  await applyOperationDateFilter(
    page,
    config.operationDateStart ?? config.operationDate,
    config.operationDateEnd ?? config.operationDate,
    settleMs
  );

  await ensureOperationTypesOnly(page, settleMs);

  console.log('tableReady:', new Date().toLocaleString());

  const ok = await waitForTable(page, config.tableSelector ?? 'table', settleMs);
  if (!ok) {
    throw new Error('PowerStock (browser): cheguei em Operações e apliquei o filtro, mas não encontrei a tabela/lista.');
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
  const keepOpen = config.keepBrowserOpen ?? envKeepOpen;
  const shouldClose = !keepOpen;

  try {
    if (config.loginUrl && config.username && config.password) {
      await powerStockBrowserLogin(page, {
        baseUrl: config.baseUrl,
        loginUrl: config.loginUrl,
        username: config.username,
        password: config.password,
        usernameField: config.usernameField,
        passwordField: config.passwordField,
        timeoutMs: config.timeoutMs,
      });
    }

    await openOrdersPage(page, config);

    const out: Record<string, unknown>[] = [];
    const tableSelector = config.tableSelector ?? 'table';
    let previousSignature: string | undefined;

    for (let pageCount = 0; pageCount < Math.max(1, config.maxPages); pageCount += 1) {
      const ok = await waitForTable(page, tableSelector, config.timeoutMs);
      if (!ok) break;

      let pageOrders: Record<string, unknown>[];
      if (previousSignature) {
        const changed = await waitForOrdersDifferentFromSignature(
          page,
          config.tableSelector,
          previousSignature,
          Math.min(15000, Math.max(2000, config.timeoutMs))
        );
        if (!changed) break;
        pageOrders = changed;
      } else {
        const listHtml = await page.content();
        pageOrders = parsePowerStockOrdersFromHtml(listHtml, config.tableSelector);
      }

      if (pageOrders.length === 0) break;

      const htmlForSig = await page.content();
      const activeForSig = extractActivePageFromHtml(htmlForSig) ?? 0;
      const currentSignature = `${String(activeForSig)}:${computeOrdersSignature(pageOrders)}`;

      const detailsButtonsCount = await page.locator('#menu-button-mostrarMais').count();
      const limit = Math.min(detailsButtonsCount || pageOrders.length, pageOrders.length);

      for (let idx = 0; idx < limit; idx += 1) {
        const opened = await openDetailsForIndex(page, idx, config.timeoutMs);
        if (!opened) continue;

        const detailsHtml = await page.content();
        const cliente = parsePowerStockCustomerFromDetailsHtml(detailsHtml);
        const items = parsePowerStockOrderItemsFromHtml(detailsHtml);
        pageOrders[idx] = { ...pageOrders[idx], cliente, items };

        await closeDetailsToReturnToList(page, tableSelector, config.timeoutMs);
      }

      out.push(...pageOrders);
      previousSignature = currentSignature;

      const advanced = await goToNextOperationsListPage(page, Math.min(15000, Math.max(2000, config.timeoutMs)));
      if (!advanced) break;
    }

    return out;
  } finally {
    if (shouldClose) {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
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
