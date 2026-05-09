import axios from 'axios';

export type GenericAuthInput = {
  id: string;
  authType?: string | null;
  baseUrl: string;
  alternativeBaseUrl?: string | null;
  username?: string | null;
  password?: string | null;
  lastToken?: string | null;
  tokenExpiresAt?: Date | null;
  extraHeaders?: unknown;
};

export type GenericAuthSession = {
  token?: string;
  cookie?: string;
  lojaId?: string;
};

type PersistTokenFn = (authId: string, token: string, tokenExpiresAt: Date | null) => Promise<void>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/^`+|`+$/g, '').trim();
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined || v === null) continue;
    const normalizedKey = k.trim().toLowerCase();
    if (normalizedKey === 'url-base-alternativa' || normalizedKey === 'urlbasealternativa' || normalizedKey === 'url_base_alternativa') {
      continue;
    }
    headers[k] = typeof v === 'string' ? normalizeHeaderValue(v) : String(v);
  }
  return headers;
}

function getAlternativeBaseUrl(extraHeaders: unknown, explicitAlternative?: string | null): string | null {
  const explicit = (explicitAlternative ?? '').trim();
  if (explicit) return explicit;
  if (!extraHeaders || typeof extraHeaders !== 'object') return null;
  const record = extraHeaders as Record<string, unknown>;
  const candidate =
    record['url-base-alternativa'] ??
    record.urlBaseAlternativa ??
    record.url_base_alternativa ??
    record['url-alternativa'] ??
    record.urlAlternativa ??
    record.url_alternativa;
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  return trimmed || null;
}

function buildUrlWithAlternativeBase(primaryUrl: string, alternativeBaseUrl: string | null): string | null {
  if (!alternativeBaseUrl) return null;
  try {
    const parsedPrimary = new URL(primaryUrl);
    return new URL(`${parsedPrimary.pathname}${parsedPrimary.search}`, alternativeBaseUrl).toString();
  } catch {
    return null;
  }
}

function findTokenInObject(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const candidates = [
    obj.token,
    obj.accessToken,
    obj.access_token,
    obj.jwt,
    (obj.data as Record<string, unknown> | undefined)?.token,
    (obj.dados as Record<string, unknown> | undefined)?.token,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

export class AuthService {
  constructor(private readonly persistToken: PersistTokenFn) {}

  async resolveBearerToken(auth: GenericAuthInput): Promise<string | null> {
    const authType = String(auth.authType || 'bearer').toLowerCase();
    const cachedToken = (auth.lastToken ?? '').trim() || null;

    if (authType !== 'bearer') {
      return cachedToken;
    }

    if (cachedToken && (!auth.tokenExpiresAt || auth.tokenExpiresAt > new Date())) {
      return cachedToken;
    }

    const loginUrl = (auth.baseUrl || '').trim();
    const username = (auth.username || '').trim();
    const password = (auth.password || '').trim();
    if (!loginUrl || !username || !password) {
      throw new Error(`Configuração de autenticação inválida para auth_id=${auth.id} (base_url/username/password).`);
    }

    const loginHeaders = normalizeHeaders(auth.extraHeaders);
    delete loginHeaders.Authorization;
    const alternativeLoginUrl = buildUrlWithAlternativeBase(
      loginUrl,
      getAlternativeBaseUrl(auth.extraHeaders, auth.alternativeBaseUrl)
    );
    const loginUrls = [loginUrl, alternativeLoginUrl].filter((v, idx, arr): v is string => Boolean(v) && arr.indexOf(v) === idx);

    const loginPayloads: Record<string, unknown>[] = [
      { usuario: username, senha: password, executarLogOffSessaoParelela: false, lojaPadraoId: null },
      { username, password },
      { email: username, password },
    ];

    let token: string | null = null;
    for (const targetUrl of loginUrls) {
      for (const payload of loginPayloads) {
        const response = await axios.request({
          method: 'POST',
          url: targetUrl,
          headers: { 'Content-Type': 'application/json', ...loginHeaders },
          data: payload,
          timeout: 30_000,
          validateStatus: () => true,
        });
        if (response.status < 200 || response.status >= 300) continue;
        token = findTokenInObject(response.data);
        if (token) break;
      }
      if (token) break;
    }

    if (!token) {
      throw new Error(`Falha ao autenticar no destino (auth_id=${auth.id}): token não retornado pelo login.`);
    }

    await this.persistToken(auth.id, token, null);
    return token;
  }

  async ensurePowerStockSession(auth: GenericAuthInput): Promise<GenericAuthSession> {
    const cachedToken = (auth.lastToken ?? '').trim();
    if (cachedToken && (!auth.tokenExpiresAt || auth.tokenExpiresAt > new Date())) {
      return { token: cachedToken };
    }

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...normalizeHeaders(auth.extraHeaders),
    };
    const alternativeLoginUrl = buildUrlWithAlternativeBase(
      auth.baseUrl,
      getAlternativeBaseUrl(auth.extraHeaders, auth.alternativeBaseUrl)
    );
    const loginUrls = [auth.baseUrl, alternativeLoginUrl].filter((v, idx, arr): v is string => Boolean(v) && arr.indexOf(v) === idx);

    const loginAttempt = async (targetUrl: string, executarLogoffSessaoParalela: boolean): Promise<{
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

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(loginPayload),
      });

      const responseBodyText = await response.text();
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
      const cookie = setCookieValues
        .map((line) => line.split(';', 1)[0]?.trim())
        .filter((line): line is string => Boolean(line))
        .join('; ');

      return { token, cookie: cookie || undefined, lojaId, possuiOutraSessaoAtiva };
    };

    let loginResult: {
      token?: string;
      cookie?: string;
      lojaId?: string;
      possuiOutraSessaoAtiva: boolean;
    } | null = null;
    try {
      let success = false;
      let lastError: unknown = null;
      for (const targetUrl of loginUrls) {
        try {
          loginResult = await loginAttempt(targetUrl, false);
          if (!loginResult.token && loginResult.possuiOutraSessaoAtiva) {
            await sleep(1000);
            loginResult = await loginAttempt(targetUrl, true);
          }
          success = true;
          break;
        } catch (attemptError) {
          lastError = attemptError;
        }
      }
      if (!success) {
        throw (lastError ?? new Error('Falha na autenticação em todas as URLs configuradas.'));
      }
    } catch (error) {
      // Se o endpoint de login estiver intermitente, usa token em cache como fallback.
      if (cachedToken) return { token: cachedToken };
      throw error;
    }

    if (!loginResult) {
      throw new Error('Falha ao autenticar: resultado de login ausente.');
    }
    const token = loginResult.token;
    const cookie = loginResult.cookie;
    const lojaId = loginResult.lojaId;
    if (!token && !cookie) throw new Error('Falha ao obter autenticação no retorno da API (sem token e sem cookie)');

    if (token) await this.persistToken(auth.id, token, null);
    return { token, cookie: cookie || undefined, lojaId };
  }
}
