export type NotifiersPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type NotifierRow = {
  id: string;
  integration_id: string;
  source_job_type: string;
  source_status: string;
  action_job_type: string;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type IntegrationRow = { id: string; name: string };

export function renderNotifiersPage(deps: NotifiersPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Notificadores</h1>
    <p class="muted">Configuração de disparos pós-job (ex.: Step1 success -> Step2).</p>

    <div class="grid">
      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Saída</h2>
        <pre id="out"></pre>
      </div>

      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Lista</h2>
        <div class="actions" style="margin-bottom: 10px;">
          <button id="btnNew">Novo</button>
          <button id="btnReload">Atualizar</button>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Integração</th>
              <th>Origem</th>
              <th>Ação</th>
              <th>Prioridade</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>

    <div id="modalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal">
        <div class="modal-header">
          <h2 id="modalTitle" style="margin: 0; font-size: 16px;">Notificador</h2>
          <button id="btnCloseModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>
        <div class="row">
          <label>
            Integração
            <select id="integrationId"></select>
          </label>
          <label>
            Evento origem
            <select id="sourceJobType">
              <option value="step1.captureOrders">step1.captureOrders</option>
              <option value="step2.sendOrders">step2.sendOrders</option>
            </select>
          </label>
        </div>
        <div class="row" style="margin-top: 10px;">
          <label>
            Status origem
            <select id="sourceStatus">
              <option value="success">success</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label>
            Ação destino
            <select id="actionJobType">
              <option value="step2.sendOrders">step2.sendOrders</option>
              <option value="step1.captureOrders">step1.captureOrders</option>
            </select>
          </label>
        </div>
        <div class="row" style="margin-top: 10px;">
          <label>
            Prioridade
            <input id="priority" type="number" value="100" />
          </label>
          <label>
            Habilitado
            <select id="enabled">
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </select>
          </label>
        </div>
        <div class="actions" style="margin-top: 10px;">
          <button id="btnSave">Salvar</button>
          <button id="btnCancel">Cancelar</button>
        </div>
      </div>
    </div>
  `;

  const out = root.querySelector<HTMLPreElement>('#out')!;
  const rowsEl = root.querySelector<HTMLTableSectionElement>('#rows')!;
  const integrationSel = root.querySelector<HTMLSelectElement>('#integrationId')!;
  const sourceJobTypeSel = root.querySelector<HTMLSelectElement>('#sourceJobType')!;
  const sourceStatusSel = root.querySelector<HTMLSelectElement>('#sourceStatus')!;
  const actionJobTypeSel = root.querySelector<HTMLSelectElement>('#actionJobType')!;
  const priorityEl = root.querySelector<HTMLInputElement>('#priority')!;
  const enabledSel = root.querySelector<HTMLSelectElement>('#enabled')!;
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

  let integrations: IntegrationRow[] = [];
  let notifiers: NotifierRow[] = [];

  async function loadIntegrations() {
    integrations = await deps.api<IntegrationRow[]>('/integrations');
    integrationSel.innerHTML = integrations.map((i) => `<option value="${i.id}">${i.name}</option>`).join('');
  }

  function integrationName(id: string) {
    return integrations.find((i) => i.id === id)?.name ?? id;
  }

  let modalMode: 'create' | 'edit' = 'create';
  let editingId: string | null = null;

  function openModal(mode: 'create' | 'edit', notifier?: NotifierRow) {
    modalMode = mode;
    editingId = notifier?.id ?? null;
    modalTitle.textContent = mode === 'create' ? 'Novo notificador' : 'Editar notificador';

    if (mode === 'edit' && notifier) {
      integrationSel.value = notifier.integration_id;
      sourceJobTypeSel.value = notifier.source_job_type;
      sourceStatusSel.value = notifier.source_status;
      actionJobTypeSel.value = notifier.action_job_type;
      priorityEl.value = String(notifier.priority);
      enabledSel.value = notifier.enabled ? 'true' : 'false';

      integrationSel.disabled = true;
      sourceJobTypeSel.disabled = true;
      sourceStatusSel.disabled = true;
      actionJobTypeSel.disabled = true;
    } else {
      editingId = null;
      integrationSel.disabled = false;
      sourceJobTypeSel.disabled = false;
      sourceStatusSel.disabled = false;
      actionJobTypeSel.disabled = false;

      priorityEl.value = '100';
      enabledSel.value = 'true';
      sourceJobTypeSel.value = 'step1.captureOrders';
      sourceStatusSel.value = 'success';
      actionJobTypeSel.value = 'step2.sendOrders';
    }

    modalBackdrop.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalBackdrop.style.display = 'none';
    document.body.style.overflow = '';
  }

  async function reload() {
    notifiers = await deps.api<NotifierRow[]>('/notifiers');
    rowsEl.innerHTML = notifiers
      .map(
        (n) => `
        <tr>
          <td>${integrationName(n.integration_id)}</td>
          <td>${n.source_job_type} (${n.source_status})</td>
          <td>${n.action_job_type}</td>
          <td>${n.priority}</td>
          <td>${n.enabled ? 'habilitado' : 'desabilitado'}</td>
          <td>
            <div class="actions">
              <button data-action="edit" data-id="${n.id}">Editar</button>
              <button data-action="toggle" data-id="${n.id}" data-enabled="${n.enabled ? 'true' : 'false'}">${
                n.enabled ? 'Desabilitar' : 'Habilitar'
              }</button>
              <button data-action="delete" data-id="${n.id}">Excluir</button>
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
        const current = notifiers.find((n) => n.id === id);
        if (current) openModal('edit', current);
      }
      if (action === 'toggle') {
        const enabled = btn.getAttribute('data-enabled') === 'true';
        const body = await deps.api(`/notifiers/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: !enabled }),
        });
        log({ ok: true, updated: body });
        await reload();
      }
      if (action === 'delete') {
        const body = await deps.api(`/notifiers/${encodeURIComponent(id)}`, { method: 'DELETE' });
        log({ ok: true, deleted: body });
        await reload();
      }
    } catch (e) {
      log({ ok: false, error: e });
    }
  });

  btnSave.addEventListener('click', async () => {
    try {
      if (modalMode === 'create') {
        const body = await deps.api('/notifiers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            integrationId: integrationSel.value,
            sourceJobType: sourceJobTypeSel.value,
            sourceStatus: sourceStatusSel.value,
            actionJobType: actionJobTypeSel.value,
            priority: Number(priorityEl.value),
            enabled: enabledSel.value === 'true',
          }),
        });
        log({ ok: true, created: body });
      } else {
        if (!editingId) throw new Error('Missing editingId');
        const body = await deps.api(`/notifiers/${encodeURIComponent(editingId)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            priority: Number(priorityEl.value),
            enabled: enabledSel.value === 'true',
          }),
        });
        log({ ok: true, updated: body });
      }
      await reload();
      closeModal();
    } catch (e) {
      log({ ok: false, error: e });
    }
  });

  root.querySelector<HTMLButtonElement>('#btnReload')?.addEventListener('click', () => void reload());
  btnCancel.addEventListener('click', closeModal);
  btnCloseModal.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (ev) => {
    if (ev.target === modalBackdrop) closeModal();
  });
  btnNew.addEventListener('click', () => openModal('create'));

  void (async () => {
    await loadIntegrations();
    await reload();
  })();

  return root;
}
