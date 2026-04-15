export type ExecutionsPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type ExecutionRow = {
  id: string;
  integration_id: string;
  job_type: string;
  status: string;
  trigger: string;
  requested_by: string | null;
  correlation_id: string;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: unknown | null;
  metrics: unknown;
};

export function renderExecutionsPage(deps: ExecutionsPageDeps, route: { id?: string | null } = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Execuções</h1>
    <p class="muted">Histórico de execuções (lista + detalhe).</p>

    <div class="grid">
      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Lista</h2>
        <div class="row">
          <label>
            Status
            <select id="status">
              <option value="">(todos)</option>
              <option value="queued">queued</option>
              <option value="running">running</option>
              <option value="success">success</option>
              <option value="failed">failed</option>
              <option value="skipped">skipped</option>
            </select>
          </label>
          <label>
            Job
            <select id="jobType">
              <option value="">(todos)</option>
              <option value="step1.captureOrders">step1.captureOrders</option>
              <option value="step2.sendOrders">step2.sendOrders</option>
            </select>
          </label>
          <label>
            Trigger
            <select id="trigger">
              <option value="">(todos)</option>
              <option value="manual">manual</option>
              <option value="schedule">schedule</option>
            </select>
          </label>
        </div>
        <div class="actions" style="margin-top: 10px;">
          <button id="btnReload">Buscar</button>
        </div>
        <div class="divider"></div>
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Integração</th>
              <th>Job</th>
              <th>Status</th>
              <th>Trigger</th>
              <th>Queued</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>

      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Detalhe</h2>
        <p class="muted" id="detailHint">Selecione uma execução na lista.</p>
        <div class="actions" id="detailActions" style="display:none; margin-bottom: 10px;">
          <a id="linkThis" href="#">Link</a>
        </div>
        <pre id="detail"></pre>
      </div>
    </div>
  `;

  const rowsEl = root.querySelector<HTMLTableSectionElement>('#rows')!;
  const statusSel = root.querySelector<HTMLSelectElement>('#status')!;
  const jobTypeSel = root.querySelector<HTMLSelectElement>('#jobType')!;
  const triggerSel = root.querySelector<HTMLSelectElement>('#trigger')!;
  const detailEl = root.querySelector<HTMLPreElement>('#detail')!;
  const detailHint = root.querySelector<HTMLElement>('#detailHint')!;
  const detailActions = root.querySelector<HTMLElement>('#detailActions')!;
  const linkThis = root.querySelector<HTMLAnchorElement>('#linkThis')!;

  let executions: ExecutionRow[] = [];

  async function loadList() {
    const qs = new URLSearchParams();
    if (statusSel.value) qs.set('status', statusSel.value);
    if (jobTypeSel.value) qs.set('jobType', jobTypeSel.value);
    if (triggerSel.value) qs.set('trigger', triggerSel.value);
    qs.set('limit', '50');
    executions = await deps.api<ExecutionRow[]>(`/executions?${qs.toString()}`);
    rowsEl.innerHTML = executions
      .map(
        (e) => `
        <tr>
          <td><a href="#/executions?id=${encodeURIComponent(e.id)}">${e.id}</a></td>
          <td>${e.integration_id}</td>
          <td>${e.job_type}</td>
          <td>${e.status}</td>
          <td>${e.trigger}</td>
          <td>${new Date(e.queued_at).toLocaleString()}</td>
        </tr>`
      )
      .join('');
  }

  async function loadDetail(id: string) {
    const row = await deps.api<ExecutionRow>(`/executions/${encodeURIComponent(id)}`);
    detailHint.style.display = 'none';
    detailActions.style.display = 'flex';
    linkThis.href = `#/executions?id=${encodeURIComponent(id)}`;
    detailEl.textContent = JSON.stringify(row, null, 2);
  }

  root.querySelector<HTMLButtonElement>('#btnReload')?.addEventListener('click', () => {
    void loadList();
  });

  void (async () => {
    await loadList();
    if (route.id) {
      await loadDetail(route.id);
    }
  })();

  return root;
}
