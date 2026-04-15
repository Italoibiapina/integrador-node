export type ManualRunPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type IntegrationRow = { id: string; name: string };

export function renderManualRunPage(deps: ManualRunPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Disparo Manual</h1>
    <p class="muted">Executar Passo 1 / Passo 2 manualmente.</p>

    <div class="grid">
      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Selecionar</h2>
        <label>
          Integração
          <select id="integrationId"></select>
        </label>
        <div class="actions" style="margin-top: 10px;">
          <button id="btnRunStep1">Executar Passo 1</button>
          <button id="btnRunStep2">Executar Passo 2</button>
        </div>
      </div>

      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Saída</h2>
        <pre id="out"></pre>
      </div>
    </div>
  `;

  const out = root.querySelector<HTMLPreElement>('#out')!;
  const integrationSel = root.querySelector<HTMLSelectElement>('#integrationId')!;
  const btnRunStep1 = root.querySelector<HTMLButtonElement>('#btnRunStep1')!;
  const btnRunStep2 = root.querySelector<HTMLButtonElement>('#btnRunStep2')!;

  function log(value: unknown) {
    const line = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    out.textContent = `${line}\n\n${out.textContent}`;
  }

  async function loadIntegrations() {
    const integrations = await deps.api<IntegrationRow[]>('/integrations');
    integrationSel.innerHTML = integrations.map((i) => `<option value="${i.id}">${i.name}</option>`).join('');
  }

  btnRunStep1.addEventListener('click', async () => {
    try {
      const body = await deps.api('/jobs/step1/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ integrationId: integrationSel.value }),
      });
      log({ ok: true, step1: body });
    } catch (e) {
      log({ ok: false, error: e });
    }
  });

  btnRunStep2.addEventListener('click', async () => {
    try {
      const body = await deps.api('/jobs/step2/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ integrationId: integrationSel.value }),
      });
      log({ ok: true, step2: body });
    } catch (e) {
      log({ ok: false, error: e });
    }
  });

  void loadIntegrations();
  return root;
}
