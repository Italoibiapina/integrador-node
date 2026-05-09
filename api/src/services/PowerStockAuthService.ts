import { ApiServiceRepository } from '../repositories/ApiServiceRepository.js';
import { ApiAuthConfig } from './apiIntegrationTypes.js';

export type PowerStockAuthSession = {
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

export class PowerStockAuthService {
  constructor(private repository: ApiServiceRepository) {}

  async ensureAuthenticated(auth: ApiAuthConfig): Promise<PowerStockAuthSession> {
    if (auth.last_token && auth.token_expires_at && auth.token_expires_at > new Date()) {
      return { token: auth.last_token };
    }

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...auth.extra_headers,
    };
    for (const [key, value] of Object.entries(requestHeaders)) {
      if (typeof value === 'string') requestHeaders[key] = normalizeHeaderValue(value);
    }
    delete requestHeaders['url-base-alternativa'];
    delete requestHeaders.urlBaseAlternativa;
    delete requestHeaders.url_base_alternativa;
    delete requestHeaders['url-alternativa'];
    delete requestHeaders.urlAlternativa;
    delete requestHeaders.url_alternativa;
    const alternativeLoginUrl = buildUrlWithAlternativeBase(
      auth.base_url,
      getAlternativeBaseUrl(auth.extra_headers, auth.base_url_alternativa)
    );
    const loginUrls = [auth.base_url, alternativeLoginUrl].filter((v, idx, arr): v is string => Boolean(v) && arr.indexOf(v) === idx);

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
    let lastError: unknown = null;
    for (const loginUrl of loginUrls) {
      try {
        const firstAttempt = await loginAttempt(loginUrl, false);
        loginResult = firstAttempt;
        if (!loginResult.token && loginResult.possuiOutraSessaoAtiva) {
          await sleep(1000);
          loginResult = await loginAttempt(loginUrl, true);
        }
        if (loginResult) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!loginResult) {
      throw (lastError instanceof Error ? lastError : new Error('Falha na autenticação: nenhuma URL de login respondeu com sucesso.'));
    }

    const token = loginResult.token;
    const cookie = loginResult.cookie;
    const lojaId = loginResult.lojaId;
    if (!token && !cookie) throw new Error('Falha ao obter autenticação no retorno da API (sem token e sem cookie)');

    if (token) await this.repository.updateAuthToken(auth.id, token);
    return { token, cookie: cookie || undefined, lojaId };
  }
}
