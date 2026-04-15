export type DashboardPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
  navigate: (path: string) => void;
};

type ExecutionRow = {
  id: string;
  integration_id: string;
  job_type: string;
  status: string;
  trigger: string;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export function renderDashboardPage(deps: DashboardPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Dashboard</h1>
    <p class="muted">Visão geral (mínimo) das execuções.</p>

    <div class="grid">
      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">KPIs (placeholder)</h2>
        <div class="row">
          <span class="pill">Execuções 24h: <strong id="kpiExec24h">-</strong></span>
          <span class="pill">Falhas 24h: <strong id="kpiFails24h">-</strong></span>
        </div>
      </div>

      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Ações</h2>
        <div class="actions">
          <button id="btnGoManual">Disparo Manual</button>
          <button id="btnGoExecutions">Execuções</button>
          <button id="btnGoSchedules">Agendamentos</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <h2 style="margin: 0 0 10px; font-size: 16px;">Últimas execuções</h2>
      <div class="actions" style="margin-bottom: 10px;">
        <button id="btnReload">Atualizar</button>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Integração</th>
            <th>Job</th>
            <th>Status</th>
            <th>Gatilho</th>
            <th>Queued</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  `;

  const rowsEl = root.querySelector<HTMLTableSectionElement>('#rows')!;
  const kpiExec24h = root.querySelector<HTMLElement>('#kpiExec24h')!;
  const kpiFails24h = root.querySelector<HTMLElement>('#kpiFails24h')!;

  root.querySelector<HTMLButtonElement>('#btnGoManual')?.addEventListener('click', () => deps.navigate('/manual-run'));
  root.querySelector<HTMLButtonElement>('#btnGoExecutions')?.addEventListener('click', () => deps.navigate('/executions'));
  root.querySelector<HTMLButtonElement>('#btnGoSchedules')?.addEventListener('click', () => deps.navigate('/schedules'));

  async function load() {
    const executions = await deps.api<ExecutionRow[]>('/executions?limit=20');
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

    const now = Date.now();
    const last24h = executions.filter((x) => now - new Date(x.queued_at).getTime() <= 24 * 60 * 60 * 1000);
    const fails24h = last24h.filter((x) => x.status === 'failed');
    kpiExec24h.textContent = String(last24h.length);
    kpiFails24h.textContent = String(fails24h.length);
  }

  root.querySelector<HTMLButtonElement>('#btnReload')?.addEventListener('click', () => {
    void load();
  });

  void load();
  return root;
}
