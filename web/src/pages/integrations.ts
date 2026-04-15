export type IntegrationsPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type ConnectionRow = {
  id: string;
  name: string;
  type: 'api' | 'db' | 'custom';
};

type IntegrationRow = {
  id: string;
  name: string;
  source_connection_id: string | null;
  destination_connection_id: string | null;
  settings: unknown;
  created_at: string;
  updated_at: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  if (Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function renderIntegrationsPage(deps: IntegrationsPageDeps, route: { id?: string | null } = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Integrações</h1>
    <p class="muted">Lista + pop-up para criar/editar. Defina conexões e a query do Passo 1 (quando a fonte for Banco).</p>

    <div class="card">
      <div class="actions" style="justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div class="actions">
          <button id="btnNew">Nova integração</button>
          <button id="btnReload">Atualizar</button>
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Fonte</th>
            <th>Destino</th>
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
          <h2 id="modalTitle" style="margin: 0; font-size: 16px;">Integração</h2>
          <button id="btnCloseModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>

        <div class="row">
          <label>
            Nome
            <input id="name" placeholder="minha-integracao" />
          </label>
        </div>

        <div class="row" style="margin-top: 10px;">
          <label>
            Conexão fonte
            <select id="sourceConnectionId"></select>
          </label>
          <label>
            Conexão destino
            <select id="destinationConnectionId"></select>
          </label>
        </div>

        <div id="step1DbFields" style="margin-top: 10px; display:none;">
          <h3 style="margin: 0 0 8px; font-size: 14px;">Passo 1 (captura) - Banco</h3>
          <label>
            Query (SQL)
            <textarea id="step1DbQuery" placeholder="select * from pedidos"></textarea>
          </label>
          <div class="row" style="margin-top: 10px;">
            <label>
              Paginação
              <select id="step1DbPaginationType">
                <option value="none">none</option>
                <option value="offset">offset</option>
                <option value="cursor">cursor</option>
              </select>
            </label>
            <label>
              Page size
              <input id="step1DbPageSize" type="number" min="1" step="1" value="200" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              Cursor column (se cursor)
              <input id="step1DbCursorColumn" placeholder="updated_at" />
            </label>
            <label>
              Cursor type
              <select id="step1DbCursorType">
                <option value="text">text</option>
                <option value="timestamptz">timestamptz</option>
                <option value="timestamp">timestamp</option>
                <option value="bigint">bigint</option>
                <option value="integer">integer</option>
                <option value="uuid">uuid</option>
              </select>
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              Initial cursor (opcional)
              <input id="step1DbInitialCursor" placeholder="2026-01-01T00:00:00Z" />
            </label>
            <label>
              Source order ID path
              <input id="step1DbSourceOrderIdPath" placeholder="id" />
            </label>
          </div>
          <div class="row" style="margin-top: 10px;">
            <label>
              Source system (opcional)
              <input id="step1DbSourceSystem" placeholder="ERP-X" />
            </label>
            <label>
              Max pages
              <input id="step1DbMaxPages" type="number" min="1" step="1" value="50" />
            </label>
          </div>
        </div>

        <label style="margin-top: 10px;">
          Settings (JSON)
          <textarea id="settingsJson" readonly></textarea>
        </label>

        <div class="actions" style="margin-top: 10px;">
          <button id="btnSave">Salvar</button>
          <button id="btnCancel">Cancelar</button>
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
  const nameEl = root.querySelector<HTMLInputElement>('#name')!;
  const sourceConnectionSel = root.querySelector<HTMLSelectElement>('#sourceConnectionId')!;
  const destinationConnectionSel = root.querySelector<HTMLSelectElement>('#destinationConnectionId')!;
  const step1DbFields = root.querySelector<HTMLDivElement>('#step1DbFields')!;
  const step1DbQueryEl = root.querySelector<HTMLTextAreaElement>('#step1DbQuery')!;
  const step1DbPaginationTypeEl = root.querySelector<HTMLSelectElement>('#step1DbPaginationType')!;
  const step1DbPageSizeEl = root.querySelector<HTMLInputElement>('#step1DbPageSize')!;
  const step1DbCursorColumnEl = root.querySelector<HTMLInputElement>('#step1DbCursorColumn')!;
  const step1DbCursorTypeEl = root.querySelector<HTMLSelectElement>('#step1DbCursorType')!;
  const step1DbInitialCursorEl = root.querySelector<HTMLInputElement>('#step1DbInitialCursor')!;
  const step1DbSourceOrderIdPathEl = root.querySelector<HTMLInputElement>('#step1DbSourceOrderIdPath')!;
  const step1DbSourceSystemEl = root.querySelector<HTMLInputElement>('#step1DbSourceSystem')!;
  const step1DbMaxPagesEl = root.querySelector<HTMLInputElement>('#step1DbMaxPages')!;
  const settingsJsonEl = root.querySelector<HTMLTextAreaElement>('#settingsJson')!;

  function log(value: unknown) {
    const line = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    out.textContent = `${line}\n\n${out.textContent}`;
  }

  let connections: ConnectionRow[] = [];
  let integrations: IntegrationRow[] = [];

  function connectionLabel(id: string | null): string {
    if (!id) return '(nenhuma)';
    const c = connections.find((x) => x.id === id);
    if (!c) return id;
    return `${c.name} (${c.type})`;
  }

  function selectedSourceType(): ConnectionRow['type'] | null {
    const id = sourceConnectionSel.value || '';
    const c = connections.find((x) => x.id === id);
    return c?.type ?? null;
  }

  let modalMode: 'create' | 'edit' = 'create';
  let editingId: string | null = null;
  let extraSettings: Record<string, unknown> = {};

  function buildSettings(): Record<string, unknown> {
    const settings: Record<string, unknown> = { ...extraSettings };
    if (selectedSourceType() === 'db') {
      const pageSize = Number(step1DbPageSizeEl.value);
      const maxPages = Number(step1DbMaxPagesEl.value);

      settings.step1Db = {
        query: step1DbQueryEl.value,
        paginationType: step1DbPaginationTypeEl.value,
        pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 200,
        cursorColumn: step1DbCursorColumnEl.value.trim() || null,
        cursorType: step1DbCursorTypeEl.value,
        initialCursor: step1DbInitialCursorEl.value.trim() || null,
        sourceOrderIdPath: step1DbSourceOrderIdPathEl.value.trim() || 'id',
        sourceSystem: step1DbSourceSystemEl.value.trim() || undefined,
        maxPages: Number.isFinite(maxPages) && maxPages > 0 ? maxPages : 50,
      };
    }
    return settings;
  }

  function updateSettingsPreview() {
    try {
      settingsJsonEl.value = JSON.stringify(buildSettings(), null, 2);
    } catch {
      settingsJsonEl.value = '';
    }
  }

  function showFieldsForSourceType(type: ConnectionRow['type'] | null) {
    step1DbFields.style.display = type === 'db' ? 'block' : 'none';
  }

  function resetStep1DbDefaults() {
    step1DbQueryEl.value = '';
    step1DbPaginationTypeEl.value = 'none';
    step1DbPageSizeEl.value = '200';
    step1DbCursorColumnEl.value = '';
    step1DbCursorTypeEl.value = 'text';
    step1DbInitialCursorEl.value = '';
    step1DbSourceOrderIdPathEl.value = 'id';
    step1DbSourceSystemEl.value = '';
    step1DbMaxPagesEl.value = '50';
  }

  function openModal(mode: 'create' | 'edit', row?: IntegrationRow) {
    modalMode = mode;
    editingId = row?.id ?? null;
    modalTitle.textContent = mode === 'create' ? 'Nova integração' : 'Editar integração';

    if (mode === 'edit' && row) {
      nameEl.value = row.name;
      sourceConnectionSel.value = row.source_connection_id ?? '';
      destinationConnectionSel.value = row.destination_connection_id ?? '';

      const settings = asRecord(row.settings);
      extraSettings = { ...settings };
      delete extraSettings.step1Db;

      const step1Db = asRecord(settings.step1Db);
      step1DbQueryEl.value = safeString(step1Db.query);
      step1DbPaginationTypeEl.value = safeString(step1Db.paginationType, 'none');
      step1DbPageSizeEl.value = String(safeNumber(step1Db.pageSize, 200));
      step1DbCursorColumnEl.value = safeString(step1Db.cursorColumn);
      step1DbCursorTypeEl.value = safeString(step1Db.cursorType, 'text');
      step1DbInitialCursorEl.value = safeString(step1Db.initialCursor);
      step1DbSourceOrderIdPathEl.value = safeString(step1Db.sourceOrderIdPath, 'id');
      step1DbSourceSystemEl.value = safeString(step1Db.sourceSystem);
      step1DbMaxPagesEl.value = String(safeNumber(step1Db.maxPages, 50));
    } else {
      nameEl.value = '';
      sourceConnectionSel.value = '';
      destinationConnectionSel.value = '';
      extraSettings = {};
      resetStep1DbDefaults();
    }

    showFieldsForSourceType(selectedSourceType());
    updateSettingsPreview();

    modalBackdrop.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalBackdrop.style.display = 'none';
    document.body.style.overflow = '';
  }

  async function loadConnections() {
    connections = await deps.api<ConnectionRow[]>('/connections');
    const sourceOptions = ['<option value="">(nenhuma)</option>']
      .concat(connections.map((c) => `<option value="${c.id}">${c.name} (${c.type})</option>`))
      .join('');
    const destinationOptions = ['<option value="">(nenhuma)</option>']
      .concat(connections.filter((c) => c.type !== 'custom').map((c) => `<option value="${c.id}">${c.name} (${c.type})</option>`))
      .join('');
    sourceConnectionSel.innerHTML = sourceOptions;
    destinationConnectionSel.innerHTML = destinationOptions;
  }

  async function reload() {
    integrations = await deps.api<IntegrationRow[]>('/integrations');
    rowsEl.innerHTML = integrations
      .map(
        (i) => `
        <tr>
          <td>${i.name}</td>
          <td>${connectionLabel(i.source_connection_id)}</td>
          <td>${connectionLabel(i.destination_connection_id)}</td>
          <td>${i.id}</td>
          <td>
            <div class="actions">
              <button data-action="edit" data-id="${i.id}">Editar</button>
              <button data-action="delete" data-id="${i.id}">Excluir</button>
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

    if (action === 'edit') {
      const current = integrations.find((x) => x.id === id);
      if (current) openModal('edit', current);
      return;
    }

    if (action === 'delete') {
      try {
        const body = await deps.api(`/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        log({ ok: true, deleted: body });
        await reload();
      } catch (e) {
        log({ ok: false, error: e });
      }
    }
  });

  root.querySelector<HTMLButtonElement>('#btnReload')?.addEventListener('click', () => void reload());
  btnNew.addEventListener('click', () => openModal('create'));
  btnCancel.addEventListener('click', closeModal);
  btnCloseModal.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (ev) => {
    if (ev.target === modalBackdrop) closeModal();
  });

  nameEl.addEventListener('input', updateSettingsPreview);
  sourceConnectionSel.addEventListener('change', () => {
    showFieldsForSourceType(selectedSourceType());
    updateSettingsPreview();
  });
  destinationConnectionSel.addEventListener('change', updateSettingsPreview);
  step1DbQueryEl.addEventListener('input', updateSettingsPreview);
  step1DbPaginationTypeEl.addEventListener('change', updateSettingsPreview);
  step1DbPageSizeEl.addEventListener('input', updateSettingsPreview);
  step1DbCursorColumnEl.addEventListener('input', updateSettingsPreview);
  step1DbCursorTypeEl.addEventListener('change', updateSettingsPreview);
  step1DbInitialCursorEl.addEventListener('input', updateSettingsPreview);
  step1DbSourceOrderIdPathEl.addEventListener('input', updateSettingsPreview);
  step1DbSourceSystemEl.addEventListener('input', updateSettingsPreview);
  step1DbMaxPagesEl.addEventListener('input', updateSettingsPreview);

  btnSave.addEventListener('click', async () => {
    try {
      const name = nameEl.value.trim();
      if (!name) {
        log({ ok: false, error: { message: 'Nome é obrigatório' } });
        return;
      }

      const sourceType = selectedSourceType();
      const settings = buildSettings();

      if (sourceType === 'db') {
        const step1Db = asRecord(settings.step1Db);
        const q = step1Db.query;
        if (typeof q !== 'string' || !q.trim()) {
          log({ ok: false, error: { message: 'Query do Passo 1 (Banco) é obrigatória' } });
          return;
        }
      }

      const payload = {
        name,
        sourceConnectionId: sourceConnectionSel.value || null,
        destinationConnectionId: destinationConnectionSel.value || null,
        settings,
      };

      if (modalMode === 'create') {
        const body = await deps.api('/integrations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        log({ ok: true, created: body });
      } else {
        if (!editingId) throw new Error('Missing editingId');
        const body = await deps.api(`/integrations/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        log({ ok: true, updated: body });
      }

      await reload();
      closeModal();
    } catch (e) {
      log({ ok: false, error: e });
    }
  });

  void (async () => {
    await loadConnections();
    await reload();
    if (route.id) {
      const r = integrations.find((x) => x.id === route.id);
      if (r) openModal('edit', r);
    }
  })();

  return root;
}
