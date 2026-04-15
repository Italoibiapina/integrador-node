export type CustomConnectionsPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type ConnectionRow = {
  id: string;
  name: string;
  type: 'custom';
  config: unknown;
  created_at: string;
  updated_at: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  if (Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function renderCustomConnectionsPage(deps: CustomConnectionsPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Conexões Customizadas</h1>
    <p class="muted">Conectores customizados (ex.: Webscraping do sistema de pedidos).</p>

    <div class="card">
      <div class="actions" style="justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div class="actions">
          <button id="btnNew">Nova conexão customizada</button>
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
          <h2 id="modalTitle" style="margin: 0; font-size: 16px;">Conexão customizada</h2>
          <button id="btnCloseModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>

        <div class="row">
          <label>
            Nome
            <input id="name" placeholder="pedidos-web" />
          </label>
          <label>
            Conector
            <select id="kind">
              <option value="ordersWebscrape">Pedidos (Webscrape)</option>
              <option value="powerStock">PowerStock (Pedidos)</option>
            </select>
          </label>
        </div>

        <div style="margin-top: 10px;">
          <h3 style="margin: 0 0 8px; font-size: 14px;">Configuração</h3>
          <div class="row">
            <label>
              Base URL
              <input id="baseUrl" placeholder="https://sistema.exemplo.com" />
            </label>
            <label>
              Orders URL
              <input id="ordersUrl" placeholder="/pedidos" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              Login URL (opcional)
              <input id="loginUrl" placeholder="/login" />
            </label>
            <label>
              Table selector (opcional)
              <input id="tableSelector" placeholder="table#orders" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              Usuário (opcional)
              <input id="username" placeholder="usuario" />
            </label>
            <label>
              Senha (opcional)
              <input id="password" type="password" placeholder="••••••••" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              Campo usuário (login)
              <input id="usernameField" placeholder="username" />
            </label>
            <label>
              Campo senha (login)
              <input id="passwordField" placeholder="password" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              Source Order ID field
              <input id="sourceOrderIdField" placeholder="id" />
            </label>
            <label>
              Source System (opcional)
              <input id="sourceSystem" placeholder="ERP-X" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              Timeout (ms)
              <input id="timeoutMs" type="number" min="1000" step="1000" value="15000" />
            </label>
            <label>
              Max pages
              <input id="maxPages" type="number" min="1" step="1" value="1" />
            </label>
          </div>
        </div>

        <label style="margin-top: 10px;">
          Config gerado (JSON)
          <textarea id="configJson" readonly></textarea>
        </label>

        <div class="actions" style="margin-top: 10px;">
          <button id="btnSave">Salvar</button>
          <button id="btnCancel">Cancelar</button>
          <button id="btnExample">Exemplo</button>
        </div>
      </div>
    </div>
  `;

  const out = root.querySelector<HTMLPreElement>('#out')!;
  const rowsEl = root.querySelector<HTMLTableSectionElement>('#rows')!;
  const btnNew = root.querySelector<HTMLButtonElement>('#btnNew')!;
  const modalBackdrop = root.querySelector<HTMLDivElement>('#modalBackdrop')!;
  const modalTitle = root.querySelector<HTMLElement>('#modalTitle')!;
  const btnCloseModal = root.querySelector<HTMLButtonElement>('#btnCloseModal')!;
  const btnCancel = root.querySelector<HTMLButtonElement>('#btnCancel')!;
  const btnSave = root.querySelector<HTMLButtonElement>('#btnSave')!;
  const btnExample = root.querySelector<HTMLButtonElement>('#btnExample')!;

  const nameEl = root.querySelector<HTMLInputElement>('#name')!;
  const kindEl = root.querySelector<HTMLSelectElement>('#kind')!;
  const baseUrlEl = root.querySelector<HTMLInputElement>('#baseUrl')!;
  const ordersUrlEl = root.querySelector<HTMLInputElement>('#ordersUrl')!;
  const loginUrlEl = root.querySelector<HTMLInputElement>('#loginUrl')!;
  const tableSelectorEl = root.querySelector<HTMLInputElement>('#tableSelector')!;
  const usernameEl = root.querySelector<HTMLInputElement>('#username')!;
  const passwordEl = root.querySelector<HTMLInputElement>('#password')!;
  const usernameFieldEl = root.querySelector<HTMLInputElement>('#usernameField')!;
  const passwordFieldEl = root.querySelector<HTMLInputElement>('#passwordField')!;
  const sourceOrderIdFieldEl = root.querySelector<HTMLInputElement>('#sourceOrderIdField')!;
  const sourceSystemEl = root.querySelector<HTMLInputElement>('#sourceSystem')!;
  const timeoutMsEl = root.querySelector<HTMLInputElement>('#timeoutMs')!;
  const maxPagesEl = root.querySelector<HTMLInputElement>('#maxPages')!;
  const configJsonEl = root.querySelector<HTMLTextAreaElement>('#configJson')!;

  function log(value: unknown) {
    const line = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    out.textContent = `${line}\n\n${out.textContent}`;
  }

  let connections: ConnectionRow[] = [];
  let modalMode: 'create' | 'edit' = 'create';
  let editingId: string | null = null;
  let existingPassword: string | null = null;

  function buildConfig(): Record<string, unknown> {
    const timeoutMsRaw = Number(timeoutMsEl.value);
    const maxPagesRaw = Number(maxPagesEl.value);
    const password = passwordEl.value.trim() || existingPassword || undefined;

    return {
      kind: kindEl.value,
      baseUrl: baseUrlEl.value.trim(),
      ordersUrl: ordersUrlEl.value.trim(),
      loginUrl: loginUrlEl.value.trim() || undefined,
      tableSelector: tableSelectorEl.value.trim() || undefined,
      username: usernameEl.value.trim() || undefined,
      password,
      usernameField: usernameFieldEl.value.trim() || 'username',
      passwordField: passwordFieldEl.value.trim() || 'password',
      sourceOrderIdField: sourceOrderIdFieldEl.value.trim() || 'id',
      sourceSystem: sourceSystemEl.value.trim() || undefined,
      timeoutMs: Number.isFinite(timeoutMsRaw) ? timeoutMsRaw : 15000,
      maxPages: Number.isFinite(maxPagesRaw) ? maxPagesRaw : 1,
    };
  }

  function maskSecretsForPreview(config: Record<string, unknown>): Record<string, unknown> {
    const next = { ...config };
    if (typeof next.password === 'string' && next.password) next.password = '***';
    return next;
  }

  function updateConfigJsonPreview() {
    try {
      configJsonEl.value = JSON.stringify(maskSecretsForPreview(buildConfig()), null, 2);
    } catch {
      configJsonEl.value = '';
    }
  }

  function fillExample() {
    kindEl.value = 'powerStock';
    baseUrlEl.value = 'https://sistema.exemplo.com';
    ordersUrlEl.value = '/pedidos';
    loginUrlEl.value = '/login';
    tableSelectorEl.value = 'table';
    usernameEl.value = 'usuario';
    passwordEl.value = '';
    existingPassword = null;
    usernameFieldEl.value = 'username';
    passwordFieldEl.value = 'password';
    sourceOrderIdFieldEl.value = 'Pedido';
    sourceSystemEl.value = 'sistema-pedidos';
    timeoutMsEl.value = '15000';
    maxPagesEl.value = '1';
    updateConfigJsonPreview();
  }

  function openModal(mode: 'create' | 'edit', conn?: ConnectionRow) {
    modalMode = mode;
    editingId = conn?.id ?? null;
    modalTitle.textContent = mode === 'create' ? 'Nova conexão customizada' : 'Editar conexão customizada';

    if (mode === 'edit' && conn) {
      nameEl.value = conn.name;
      const cfg = asRecord(conn.config);
      kindEl.value = typeof cfg.kind === 'string' ? cfg.kind : 'ordersWebscrape';
      baseUrlEl.value = typeof cfg.baseUrl === 'string' ? cfg.baseUrl : '';
      ordersUrlEl.value = typeof cfg.ordersUrl === 'string' ? cfg.ordersUrl : '';
      loginUrlEl.value = typeof cfg.loginUrl === 'string' ? cfg.loginUrl : '';
      tableSelectorEl.value = typeof cfg.tableSelector === 'string' ? cfg.tableSelector : '';
      usernameEl.value = typeof cfg.username === 'string' ? cfg.username : '';
      existingPassword = typeof cfg.password === 'string' ? cfg.password : null;
      passwordEl.value = '';
      usernameFieldEl.value = typeof cfg.usernameField === 'string' ? cfg.usernameField : 'username';
      passwordFieldEl.value = typeof cfg.passwordField === 'string' ? cfg.passwordField : 'password';
      sourceOrderIdFieldEl.value = typeof cfg.sourceOrderIdField === 'string' ? cfg.sourceOrderIdField : 'id';
      sourceSystemEl.value = typeof cfg.sourceSystem === 'string' ? cfg.sourceSystem : '';
      timeoutMsEl.value = typeof cfg.timeoutMs === 'number' ? String(cfg.timeoutMs) : '15000';
      maxPagesEl.value = typeof cfg.maxPages === 'number' ? String(cfg.maxPages) : '1';
      updateConfigJsonPreview();
    } else {
      nameEl.value = '';
      fillExample();
    }

    modalBackdrop.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalBackdrop.style.display = 'none';
    document.body.style.overflow = '';
  }

  async function reload() {
    const all = await deps.api<ConnectionRow[]>('/connections');
    connections = all.filter((c) => c.type === 'custom');
    rowsEl.innerHTML = connections
      .map(
        (c) => `
        <tr>
          <td>${c.name}</td>
          <td>custom</td>
          <td>${c.id}</td>
          <td>
            <div class="actions">
              <button data-action="edit" data-id="${c.id}">Editar</button>
              <button data-action="test" data-id="${c.id}">Testar</button>
              <button data-action="delete" data-id="${c.id}">Excluir</button>
            </div>
          </td>
        </tr>
      `
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

    const current = connections.find((c) => c.id === id);
    if (action === 'edit' && current) {
      openModal('edit', current);
      return;
    }

    try {
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

      const config = buildConfig();
      const baseUrl = config.baseUrl;
      const ordersUrl = config.ordersUrl;
      if (typeof baseUrl !== 'string' || !baseUrl || typeof ordersUrl !== 'string' || !ordersUrl) {
        log({ ok: false, error: { message: 'Base URL e Orders URL são obrigatórios' } });
        return;
      }

      if (modalMode === 'create') {
        const body = await deps.api('/connections', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, type: 'custom', config }),
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

  btnCancel.addEventListener('click', closeModal);
  btnCloseModal.addEventListener('click', closeModal);
  btnNew.addEventListener('click', () => openModal('create'));
  btnExample.addEventListener('click', fillExample);

  for (const el of [
    nameEl,
    kindEl,
    baseUrlEl,
    ordersUrlEl,
    loginUrlEl,
    tableSelectorEl,
    usernameEl,
    passwordEl,
    usernameFieldEl,
    passwordFieldEl,
    sourceOrderIdFieldEl,
    sourceSystemEl,
    timeoutMsEl,
    maxPagesEl,
  ]) {
    el.addEventListener('input', updateConfigJsonPreview);
    el.addEventListener('change', updateConfigJsonPreview);
  }

  root.querySelector<HTMLButtonElement>('#btnReload')?.addEventListener('click', () => void reload());
  void reload();

  return root;
}
