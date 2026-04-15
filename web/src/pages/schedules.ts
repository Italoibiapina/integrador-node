export type SchedulesPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type ScheduleRow = {
  id: string;
  integration_id: string;
  job_type: string;
  cron: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type IntegrationRow = { id: string; name: string };

export function renderSchedulesPage(deps: SchedulesPageDeps, route: { id?: string | null } = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Agendamentos</h1>
    <p class="muted">Listar, criar/editar e habilitar/desabilitar agendamentos.</p>

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
              <th>Job</th>
              <th>Cron</th>
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
          <h2 id="modalTitle" style="margin: 0; font-size: 16px;">Agendamento</h2>
          <button id="btnCloseModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>
        <div class="row">
          <label>
            Integração
            <select id="integrationId"></select>
          </label>
          <label>
            Job
            <select id="jobType">
              <option value="step1.captureOrders">Passo 1 (captura)</option>
              <option value="step2.sendOrders">Passo 2 (envio)</option>
            </select>
          </label>
        </div>
        <div class="row" style="margin-top: 10px;">
          <label>
            Cron
            <input id="cron" placeholder="*/5 * * * *" />
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
  const jobTypeSel = root.querySelector<HTMLSelectElement>('#jobType')!;
  const cronEl = root.querySelector<HTMLInputElement>('#cron')!;
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
  let schedules: ScheduleRow[] = [];

  async function loadIntegrations() {
    integrations = await deps.api<IntegrationRow[]>('/integrations');
    integrationSel.innerHTML = integrations.map((i) => `<option value="${i.id}">${i.name}</option>`).join('');
  }

  function integrationName(id: string) {
    return integrations.find((i) => i.id === id)?.name ?? id;
  }

  function fillFromSchedule(s: ScheduleRow) {
    integrationSel.value = s.integration_id;
    jobTypeSel.value = s.job_type;
    cronEl.value = s.cron;
    enabledSel.value = s.enabled ? 'true' : 'false';
  }

  let modalMode: 'create' | 'edit' = 'create';

  function openModal(mode: 'create' | 'edit', schedule?: ScheduleRow) {
    modalMode = mode;
    modalTitle.textContent = mode === 'create' ? 'Novo agendamento' : 'Editar agendamento';

    if (mode === 'edit' && schedule) {
      fillFromSchedule(schedule);
      integrationSel.disabled = true;
      jobTypeSel.disabled = true;
    } else {
      integrationSel.disabled = false;
      jobTypeSel.disabled = false;
      cronEl.value = '*/5 * * * *';
      enabledSel.value = 'true';
    }

    modalBackdrop.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalBackdrop.style.display = 'none';
    document.body.style.overflow = '';
  }

  async function reload() {
    schedules = await deps.api<ScheduleRow[]>('/schedules');
    rowsEl.innerHTML = schedules
      .map((s) => {
        const status = s.enabled ? 'habilitado' : 'desabilitado';
        return `
          <tr>
            <td>${integrationName(s.integration_id)}</td>
            <td>${s.job_type}</td>
            <td>${s.cron}</td>
            <td>${status}</td>
            <td>
              <div class="actions">
                <button data-action="edit" data-id="${s.id}">Editar</button>
                <button data-action="enable" data-id="${s.id}">Habilitar</button>
                <button data-action="disable" data-id="${s.id}">Desabilitar</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  rowsEl.addEventListener('click', async (ev) => {
    const el = ev.target as HTMLElement;
    const btn = el.closest('button');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    if (!action || !id) return;

    const current = schedules.find((s) => s.id === id);
    if (action === 'edit' && current) {
      openModal('edit', current);
      return;
    }

    try {
      if (action === 'enable') {
        const body = await deps.api(`/schedules/${encodeURIComponent(id)}/enable`, { method: 'POST' });
        log({ ok: true, enabled: body });
      } else if (action === 'disable') {
        const body = await deps.api(`/schedules/${encodeURIComponent(id)}/disable`, { method: 'POST' });
        log({ ok: true, disabled: body });
      }
      await reload();
    } catch (e) {
      log({ ok: false, error: e });
    }
  });

  btnSave.addEventListener('click', async () => {
    try {
      const body = await deps.api('/schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          integrationId: integrationSel.value,
          jobType: jobTypeSel.value,
          cron: cronEl.value,
          enabled: enabledSel.value === 'true',
        }),
      });
      log({ ok: true, saved: body });
      await reload();
      closeModal();
    } catch (e) {
      log({ ok: false, error: e });
    }
  });

  btnCancel.addEventListener('click', closeModal);
  btnCloseModal.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (ev) => {
    if (ev.target === modalBackdrop) closeModal();
  });
  btnNew.addEventListener('click', () => openModal('create'));

  root.querySelector<HTMLButtonElement>('#btnReload')?.addEventListener('click', () => void reload());

  void (async () => {
    await loadIntegrations();
    await reload();
    if (route.id) {
      const s = schedules.find((x) => x.id === route.id);
      if (s) openModal('edit', s);
    }
  })();

  return root;
}
