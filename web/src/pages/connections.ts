export type ConnectionsPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type ConnectionRow = {
  id: string;
  name: string;
  type: 'api' | 'db' | 'custom';
  config: unknown;
  created_at: string;
  updated_at: string;
};

export function renderConnectionsPage(deps: ConnectionsPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Conexões</h1>
    <p class="muted">CRUD de conexões API e Banco + teste.</p>

    <div class="card">
      <div class="actions" style="justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div class="actions">
          <button id="btnNew">Nova conexão</button>
          <button id="btnReload">Atualizar</button>
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tipo</th>
            <th>ID</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>

    <div class="card" style="margin-top: 12px;">
      <h2 style="margin: 0 0 10px; font-size: 16px;">Saída</h2>
      <pre id="out"></pre>
    </div>

    <div id="modalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal">
        <div class="modal-header">
          <h2 id="modalTitle" style="margin: 0; font-size: 16px;">Conexão</h2>
          <button id="btnCloseModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>
        <div class="row">
          <label>
            Tipo
            <select id="type">
              <option value="api">API</option>
              <option value="db">Banco</option>
            </select>
          </label>
          <label>
            Nome
            <input id="name" placeholder="minha-conn" />
          </label>
        </div>
        <div id="apiFields" style="margin-top: 10px;">
          <h3 style="margin: 0 0 8px; font-size: 14px;">Configuração API</h3>
          <div class="row">
            <label>
              Base URL
              <input id="apiBaseUrl" placeholder="https://api.exemplo.com" />
            </label>
            <label>
              Timeout (ms)
              <input id="apiTimeoutMs" type="number" min="0" step="100" value="5000" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              Autenticação
              <select id="apiAuthType">
                <option value="none">Nenhuma</option>
                <option value="apiKey">API Key</option>
                <option value="oauth2ClientCredentials">OAuth2 (Client Credentials)</option>
              </select>
            </label>
            <label>
              Header API Key
              <input id="apiKeyHeaderName" placeholder="x-api-key" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              API Key
              <input id="apiKeyValue" type="password" placeholder="••••••••" />
            </label>
            <label>
              OAuth2 Token URL
              <input id="oauthTokenUrl" placeholder="https://auth.exemplo.com/oauth/token" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              OAuth2 Client ID
              <input id="oauthClientId" placeholder="client-id" />
            </label>
            <label>
              OAuth2 Client Secret
              <input id="oauthClientSecret" type="password" placeholder="••••••••" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              OAuth2 Scope (opcional)
              <input id="oauthScope" placeholder="scope1 scope2" />
            </label>
            <label>
              OAuth2 Audience (opcional)
              <input id="oauthAudience" placeholder="https://api.exemplo.com" />
            </label>
          </div>
          <label style="margin-top: 10px;">
            Headers (JSON)
            <textarea id="apiHeaders" placeholder="{\n  \"Authorization\": \"Bearer ...\"\n}"></textarea>
          </label>
        </div>

        <div id="dbFields" style="margin-top: 10px; display:none;">
          <h3 style="margin: 0 0 8px; font-size: 14px;">Configuração Banco</h3>
          <div class="row">
            <label>
              Host
              <input id="dbHost" placeholder="localhost" />
            </label>
            <label>
              Porta
              <input id="dbPort" type="number" min="0" step="1" value="5432" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              Database
              <input id="dbDatabase" placeholder="canp_integracao" />
            </label>
            <label>
              Usuário
              <input id="dbUser" placeholder="postgres" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              Senha
              <input id="dbPassword" type="password" placeholder="••••••••" />
            </label>
            <label>
              SSL
              <select id="dbSslMode">
                <option value="disable">disable</option>
                <option value="require">require</option>
              </select>
            </label>
          </div>
          <label style="margin-top: 10px;">
            SQL de teste (opcional)
            <textarea id="dbTestQuery" placeholder="select 1 as ok"></textarea>
          </label>
        </div>

        <label style="margin-top: 10px;">
          Config gerado (JSON)
          <textarea id="configJson" readonly></textarea>
        </label>
        <div class="actions" style="margin-top: 10px;">
          <button id="btnSave">Salvar</button>
          <button id="btnCancel">Cancelar</button>
          <button id="btnFillApi">Exemplo API</button>
          <button id="btnFillDb">Exemplo Banco</button>
        </div>
      </div>
    </div>
  `;

  const out = root.querySelector<HTMLPreElement>('#out')!;
  const rowsEl = root.querySelector<HTMLTableSectionElement>('#rows')!;
  const typeSel = root.querySelector<HTMLSelectElement>('#type')!;
  const nameEl = root.querySelector<HTMLInputElement>('#name')!;
  const apiFields = root.querySelector<HTMLDivElement>('#apiFields')!;
  const apiBaseUrlEl = root.querySelector<HTMLInputElement>('#apiBaseUrl')!;
  const apiTimeoutMsEl = root.querySelector<HTMLInputElement>('#apiTimeoutMs')!;
  const apiAuthTypeEl = root.querySelector<HTMLSelectElement>('#apiAuthType')!;
  const apiKeyHeaderNameEl = root.querySelector<HTMLInputElement>('#apiKeyHeaderName')!;
  const apiKeyValueEl = root.querySelector<HTMLInputElement>('#apiKeyValue')!;
  const oauthTokenUrlEl = root.querySelector<HTMLInputElement>('#oauthTokenUrl')!;
  const oauthClientIdEl = root.querySelector<HTMLInputElement>('#oauthClientId')!;
  const oauthClientSecretEl = root.querySelector<HTMLInputElement>('#oauthClientSecret')!;
  const oauthScopeEl = root.querySelector<HTMLInputElement>('#oauthScope')!;
  const oauthAudienceEl = root.querySelector<HTMLInputElement>('#oauthAudience')!;
  const apiHeadersEl = root.querySelector<HTMLTextAreaElement>('#apiHeaders')!;
  const dbFields = root.querySelector<HTMLDivElement>('#dbFields')!;
  const dbHostEl = root.querySelector<HTMLInputElement>('#dbHost')!;
  const dbPortEl = root.querySelector<HTMLInputElement>('#dbPort')!;
  const dbDatabaseEl = root.querySelector<HTMLInputElement>('#dbDatabase')!;
  const dbUserEl = root.querySelector<HTMLInputElement>('#dbUser')!;
  const dbPasswordEl = root.querySelector<HTMLInputElement>('#dbPassword')!;
  const dbSslModeEl = root.querySelector<HTMLSelectElement>('#dbSslMode')!;
  const dbTestQueryEl = root.querySelector<HTMLTextAreaElement>('#dbTestQuery')!;
  const configJsonEl = root.querySelector<HTMLTextAreaElement>('#configJson')!;
  const btnSave = root.querySelector<HTMLButtonElement>('#btnSave')!;
  const btnCancel = root.querySelector<HTMLButtonElement>('#btnCancel')!;
  const btnNew = root.querySelector<HTMLButtonElement>('#btnNew')!;
  const modalBackdrop = root.querySelector<HTMLDivElement>('#modalBackdrop')!;
  const modalTitle = root.querySelector<HTMLElement>('#modalTitle')!;
  const btnCloseModal = root.querySelector<HTMLButtonElement>('#btnCloseModal')!;

  function log(value: unknown) {
    const line = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    out.textContent = `${line}\n\n${out.textContent}`;
  }

  function asRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return {};
    if (Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  function safeJsonParse(value: string): unknown {
    if (!value.trim()) return {};
    return JSON.parse(value) as unknown;
  }

  let extraConfig: Record<string, unknown> = {};
  let existingApiKeyValue: string | null = null;
  let existingOauthClientSecret: string | null = null;
  let existingDbPassword: string | null = null;

  function showFieldsForType(type: 'api' | 'db') {
    apiFields.style.display = type === 'api' ? 'block' : 'none';
    dbFields.style.display = type === 'db' ? 'block' : 'none';
  }

  function showFieldsForApiAuthType(value: string) {
    const isApiKey = value === 'apiKey';
    const isOauth = value === 'oauth2ClientCredentials';

    apiKeyHeaderNameEl.disabled = !isApiKey;
    apiKeyValueEl.disabled = !isApiKey;
    oauthTokenUrlEl.disabled = !isOauth;
    oauthClientIdEl.disabled = !isOauth;
    oauthClientSecretEl.disabled = !isOauth;
    oauthScopeEl.disabled = !isOauth;
    oauthAudienceEl.disabled = !isOauth;
  }

  function maskSecretsForPreview(value: Record<string, unknown>): Record<string, unknown> {
    const auth = asRecord(value.auth);
    if (auth.type === 'apiKey') {
      const nextAuth = { ...auth };
      if (typeof nextAuth.value === 'string' && nextAuth.value) nextAuth.value = '***';
      return { ...value, auth: nextAuth };
    }
    if (auth.type === 'oauth2ClientCredentials') {
      const nextAuth = { ...auth };
      if (typeof nextAuth.clientSecret === 'string' && nextAuth.clientSecret) nextAuth.clientSecret = '***';
      return { ...value, auth: nextAuth };
    }
    if (typeof value.connectionString === 'string' && value.connectionString) {
      try {
        const u = new URL(value.connectionString);
        if (u.password) {
          u.password = '***';
          return { ...value, connectionString: u.toString() };
        }
      } catch {
        return value;
      }
    }
    return value;
  }

  function buildPostgresConnectionString(params: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    sslMode: 'disable' | 'require';
  }): string {
    const host = params.host.trim();
    const database = params.database.trim();
    const user = params.user.trim();
    const password = params.password;
    const port = params.port;

    const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
    const base = `postgres://${auth}@${encodeURIComponent(host)}:${port}/${encodeURIComponent(database)}`;
    const u = new URL(base);
    if (params.sslMode === 'require') {
      u.searchParams.set('sslmode', 'require');
    }
    return u.toString();
  }

  function parsePostgresConnectionString(
    value: string
  ): { host: string; port: number; database: string; user: string; password: string; sslMode: 'disable' | 'require' } | null {
    try {
      const u = new URL(value);
      if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return null;
      const host = u.hostname || 'localhost';
      const port = u.port ? Number(u.port) : 5432;
      const database = u.pathname ? decodeURIComponent(u.pathname.replace(/^\//, '')) : '';
      const user = u.username ? decodeURIComponent(u.username) : '';
      const password = u.password ? decodeURIComponent(u.password) : '';
      const sslmode = u.searchParams.get('sslmode');
      const sslMode: 'disable' | 'require' = sslmode === 'require' ? 'require' : 'disable';
      return { host, port: Number.isFinite(port) ? port : 5432, database, user, password, sslMode };
    } catch {
      return null;
    }
  }

  function buildConfig(): Record<string, unknown> {
    if (typeSel.value === 'api') {
      const headersValue = apiHeadersEl.value.trim();
      const headers = headersValue ? asRecord(safeJsonParse(headersValue)) : {};
      const timeoutMsRaw = Number(apiTimeoutMsEl.value);
      const timeoutMs = Number.isFinite(timeoutMsRaw) ? timeoutMsRaw : 5000;

      const authType = apiAuthTypeEl.value;
      let auth: Record<string, unknown> | undefined = undefined;
      if (authType === 'apiKey') {
        const v = apiKeyValueEl.value.trim() || existingApiKeyValue || '';
        auth = {
          type: 'apiKey',
          headerName: apiKeyHeaderNameEl.value.trim() || 'x-api-key',
          value: v,
        };
      } else if (authType === 'oauth2ClientCredentials') {
        const v = oauthClientSecretEl.value.trim() || existingOauthClientSecret || '';
        auth = {
          type: 'oauth2ClientCredentials',
          tokenUrl: oauthTokenUrlEl.value.trim(),
          clientId: oauthClientIdEl.value.trim(),
          clientSecret: v,
          scope: oauthScopeEl.value.trim() || undefined,
          audience: oauthAudienceEl.value.trim() || undefined,
        };
      }

      return {
        ...extraConfig,
        baseUrl: apiBaseUrlEl.value.trim(),
        timeoutMs,
        headers,
        auth,
      };
    }

    const portRaw = Number(dbPortEl.value);
    const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 5432;
    const password = dbPasswordEl.value.trim() || existingDbPassword || '';
    const sslMode = dbSslModeEl.value === 'require' ? 'require' : 'disable';

    return {
      ...extraConfig,
      connectionString: buildPostgresConnectionString({
        host: dbHostEl.value,
        port,
        database: dbDatabaseEl.value,
        user: dbUserEl.value,
        password,
        sslMode,
      }),
      query: dbTestQueryEl.value.trim() || undefined,
    };
  }

  function updateConfigJsonPreview() {
    try {
      const config = buildConfig();
      configJsonEl.value = JSON.stringify(maskSecretsForPreview(config), null, 2);
    } catch {
      configJsonEl.value = '';
    }
  }

  function fillExample(type: 'api' | 'db') {
    if (type === 'api') {
      apiBaseUrlEl.value = 'https://jsonplaceholder.typicode.com';
      apiTimeoutMsEl.value = '5000';
      apiAuthTypeEl.value = 'none';
      apiKeyHeaderNameEl.value = 'x-api-key';
      apiKeyValueEl.value = '';
      oauthTokenUrlEl.value = '';
      oauthClientIdEl.value = '';
      oauthClientSecretEl.value = '';
      oauthScopeEl.value = '';
      oauthAudienceEl.value = '';
      apiHeadersEl.value = JSON.stringify({}, null, 2);
      existingApiKeyValue = null;
      existingOauthClientSecret = null;
      showFieldsForApiAuthType('none');
    } else {
      dbHostEl.value = 'localhost';
      dbPortEl.value = '5432';
      dbDatabaseEl.value = 'canp_integracao';
      dbUserEl.value = 'postgres';
      dbPasswordEl.value = 'postgres';
      dbSslModeEl.value = 'disable';
      dbTestQueryEl.value = 'select 1 as ok';
      existingDbPassword = null;
    }
    updateConfigJsonPreview();
  }

  root.querySelector<HTMLButtonElement>('#btnFillApi')?.addEventListener('click', () => {
    typeSel.value = 'api';
    showFieldsForType('api');
    fillExample('api');
  });
  root.querySelector<HTMLButtonElement>('#btnFillDb')?.addEventListener('click', () => {
    typeSel.value = 'db';
    showFieldsForType('db');
    fillExample('db');
  });
  typeSel.addEventListener('change', () => {
    const t = typeSel.value === 'db' ? 'db' : 'api';
    showFieldsForType(t);
    extraConfig = {};
    fillExample(t);
  });

  apiBaseUrlEl.addEventListener('input', updateConfigJsonPreview);
  apiTimeoutMsEl.addEventListener('input', updateConfigJsonPreview);
  apiAuthTypeEl.addEventListener('change', () => {
    showFieldsForApiAuthType(apiAuthTypeEl.value);
    updateConfigJsonPreview();
  });
  apiKeyHeaderNameEl.addEventListener('input', updateConfigJsonPreview);
  apiKeyValueEl.addEventListener('input', updateConfigJsonPreview);
  oauthTokenUrlEl.addEventListener('input', updateConfigJsonPreview);
  oauthClientIdEl.addEventListener('input', updateConfigJsonPreview);
  oauthClientSecretEl.addEventListener('input', updateConfigJsonPreview);
  oauthScopeEl.addEventListener('input', updateConfigJsonPreview);
  oauthAudienceEl.addEventListener('input', updateConfigJsonPreview);
  apiHeadersEl.addEventListener('input', updateConfigJsonPreview);
  dbHostEl.addEventListener('input', updateConfigJsonPreview);
  dbPortEl.addEventListener('input', updateConfigJsonPreview);
  dbDatabaseEl.addEventListener('input', updateConfigJsonPreview);
  dbUserEl.addEventListener('input', updateConfigJsonPreview);
  dbPasswordEl.addEventListener('input', updateConfigJsonPreview);
  dbSslModeEl.addEventListener('change', updateConfigJsonPreview);
  dbTestQueryEl.addEventListener('input', updateConfigJsonPreview);

  let connections: ConnectionRow[] = [];

  let modalMode: 'create' | 'edit' = 'create';
  let editingId: string | null = null;

  function openModal(mode: 'create' | 'edit', conn?: ConnectionRow) {
    modalMode = mode;
    editingId = conn?.id ?? null;
    modalTitle.textContent = mode === 'create' ? 'Nova conexão' : 'Editar conexão';

    if (mode === 'edit' && conn) {
      typeSel.value = conn.type;
      typeSel.disabled = true;
      nameEl.value = conn.name;
      const cfg = asRecord(conn.config);
      extraConfig = { ...cfg };

      if (conn.type === 'api') {
        apiBaseUrlEl.value = typeof cfg.baseUrl === 'string' ? cfg.baseUrl : '';
        apiTimeoutMsEl.value = typeof cfg.timeoutMs === 'number' ? String(cfg.timeoutMs) : '5000';
        apiHeadersEl.value = JSON.stringify(asRecord(cfg.headers), null, 2);
        const auth = asRecord(cfg.auth);
        existingApiKeyValue = null;
        existingOauthClientSecret = null;
        if (auth.type === 'apiKey') {
          apiAuthTypeEl.value = 'apiKey';
          apiKeyHeaderNameEl.value = typeof auth.headerName === 'string' && auth.headerName ? auth.headerName : 'x-api-key';
          existingApiKeyValue = typeof auth.value === 'string' ? auth.value : null;
          apiKeyValueEl.value = '';
          oauthTokenUrlEl.value = '';
          oauthClientIdEl.value = '';
          oauthClientSecretEl.value = '';
          oauthScopeEl.value = '';
          oauthAudienceEl.value = '';
        } else if (auth.type === 'oauth2ClientCredentials') {
          apiAuthTypeEl.value = 'oauth2ClientCredentials';
          oauthTokenUrlEl.value = typeof auth.tokenUrl === 'string' ? auth.tokenUrl : '';
          oauthClientIdEl.value = typeof auth.clientId === 'string' ? auth.clientId : '';
          existingOauthClientSecret = typeof auth.clientSecret === 'string' ? auth.clientSecret : null;
          oauthClientSecretEl.value = '';
          oauthScopeEl.value = typeof auth.scope === 'string' ? auth.scope : '';
          oauthAudienceEl.value = typeof auth.audience === 'string' ? auth.audience : '';
          apiKeyHeaderNameEl.value = 'x-api-key';
          apiKeyValueEl.value = '';
        } else {
          apiAuthTypeEl.value = 'none';
          apiKeyHeaderNameEl.value = 'x-api-key';
          apiKeyValueEl.value = '';
          oauthTokenUrlEl.value = '';
          oauthClientIdEl.value = '';
          oauthClientSecretEl.value = '';
          oauthScopeEl.value = '';
          oauthAudienceEl.value = '';
        }

        delete extraConfig.auth;
        delete extraConfig.baseUrl;
        delete extraConfig.timeoutMs;
        delete extraConfig.headers;
        showFieldsForApiAuthType(apiAuthTypeEl.value);
        showFieldsForType('api');
      } else {
        const connectionString = typeof cfg.connectionString === 'string' ? cfg.connectionString : '';
        const parsed = connectionString ? parsePostgresConnectionString(connectionString) : null;
        if (parsed) {
          dbHostEl.value = parsed.host;
          dbPortEl.value = String(parsed.port);
          dbDatabaseEl.value = parsed.database;
          dbUserEl.value = parsed.user;
          existingDbPassword = parsed.password || null;
          dbPasswordEl.value = '';
          dbSslModeEl.value = parsed.sslMode;
        } else {
          dbHostEl.value = '';
          dbPortEl.value = '5432';
          dbDatabaseEl.value = '';
          dbUserEl.value = '';
          existingDbPassword = null;
          dbPasswordEl.value = '';
          dbSslModeEl.value = 'disable';
        }
        dbTestQueryEl.value = typeof cfg.query === 'string' ? cfg.query : '';
        delete extraConfig.connectionString;
        delete extraConfig.query;
        existingApiKeyValue = null;
        existingOauthClientSecret = null;
        existingDbPassword = existingDbPassword ?? null;
        showFieldsForType('db');
      }

      updateConfigJsonPreview();
    } else {
      typeSel.disabled = false;
      typeSel.value = 'api';
      nameEl.value = '';
      extraConfig = {};
      showFieldsForType('api');
      fillExample('api');
    }

    modalBackdrop.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalBackdrop.style.display = 'none';
    document.body.style.overflow = '';
    editingId = null;
  }

  async function reload() {
    const all = await deps.api<ConnectionRow[]>('/connections');
    connections = all.filter((c) => c.type === 'api' || c.type === 'db');
    rowsEl.innerHTML = connections
      .map(
        (c) => `
        <tr>
          <td>${c.name}</td>
          <td>${c.type}</td>
          <td>${c.id}</td>
          <td>
            <div class="actions">
              <button data-action="edit" data-id="${c.id}">Editar</button>
              <button data-action="test" data-id="${c.id}">Testar</button>
              <button data-action="delete" data-id="${c.id}">Excluir</button>
            </div>
          </td>
        </tr>`
      )
      .join('');
  }

  rowsEl.addEventListener('click', async (ev) => {
    const el = ev.target as HTMLElement;
    const btn = el.closest('button');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    if (!action || !id) return;

    try {
      if (action === 'edit') {
        const conn = connections.find((c) => c.id === id);
        if (conn) openModal('edit', conn);
        return;
      }
      if (action === 'test') {
        const body = await deps.api(`/connections/${encodeURIComponent(id)}/test`, { method: 'POST' });
        log({ ok: true, test: body });
      }
      if (action === 'delete') {
        const body = await deps.api(`/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
        log({ ok: true, deleted: body });
        await reload();
      }
    } catch (e) {
      log({ ok: false, error: e });
    }
  });

  btnSave.addEventListener('click', async () => {
    try {
      const name = nameEl.value.trim();
      if (!name) {
        log({ ok: false, error: { message: 'Nome é obrigatório' } });
        return;
      }

      const type = typeSel.value === 'db' ? 'db' : 'api';
      const config = buildConfig();

      if (type === 'api') {
        const baseUrl = config.baseUrl;
        if (typeof baseUrl !== 'string' || !baseUrl) {
          log({ ok: false, error: { message: 'Base URL é obrigatória para conexão API' } });
          return;
        }

        const auth = asRecord(config.auth);
        if (auth.type === 'apiKey') {
          const apiKeyValue = auth.value;
          if (typeof apiKeyValue !== 'string' || !apiKeyValue) {
            log({ ok: false, error: { message: 'API Key é obrigatória quando a autenticação for API Key' } });
            return;
          }
        }
        if (auth.type === 'oauth2ClientCredentials') {
          const tokenUrl = auth.tokenUrl;
          const clientId = auth.clientId;
          const clientSecret = auth.clientSecret;
          if (typeof tokenUrl !== 'string' || !tokenUrl) {
            log({ ok: false, error: { message: 'OAuth2 Token URL é obrigatória' } });
            return;
          }
          if (typeof clientId !== 'string' || !clientId) {
            log({ ok: false, error: { message: 'OAuth2 Client ID é obrigatório' } });
            return;
          }
          if (typeof clientSecret !== 'string' || !clientSecret) {
            log({ ok: false, error: { message: 'OAuth2 Client Secret é obrigatório' } });
            return;
          }
        }
      } else {
        const connectionString = config.connectionString;
        if (typeof connectionString !== 'string' || !connectionString) {
          log({ ok: false, error: { message: 'Connection String é obrigatória para conexão de Banco' } });
          return;
        }
        if (modalMode === 'create') {
          const password = dbPasswordEl.value.trim();
          if (!password) {
            log({ ok: false, error: { message: 'Senha é obrigatória para criar conexão de Banco' } });
            return;
          }
        }
      }

      if (modalMode === 'create') {
        const body = await deps.api('/connections', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, type, config }),
        });
        log({ ok: true, created: body });
      } else {
        if (!editingId) throw new Error('Missing editingId');
        const body = await deps.api(`/connections/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, config }),
        });
        log({ ok: true, updated: body });
      }
      await reload();
      closeModal();
    } catch (e) {
      log({ ok: false, error: e });
    }
  });

  btnNew.addEventListener('click', () => openModal('create'));
  btnCancel.addEventListener('click', closeModal);
  btnCloseModal.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (ev) => {
    if (ev.target === modalBackdrop) closeModal();
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeModal();
  });

  root.querySelector<HTMLButtonElement>('#btnReload')?.addEventListener('click', () => void reload());

  void reload();
  return root;
}
