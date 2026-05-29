export type ManualIntegradorPowerStockDispatcherPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type BatchRow = {
  id: string;
  trigger_type: 'manual' | 'scheduled';
  status: 'running' | 'success' | 'failed' | 'partial';
  started_at: string;
  finished_at?: string | null;
  error_message?: string | null;
  raw_response?: unknown;
};

type ExecutionRow = {
  id: string;
  batch_id: string;
  service_id: string;
  parent_execution_id?: string | null;
  started_at: string;
  finished_at?: string | null;
  status: 'success' | 'failed' | 'running';
  error_message?: string | null;
  raw_response?: unknown;
  snapshot_config?: unknown;
};

type ServiceRow = {
  id: string;
  name: string;
  service_name?: string | null;
  is_active?: boolean;
};

type DispatcherDestinoStats = {
  sistema_nome: string;
  selected: number;
  success: number;
  error: number;
};

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback;
  const anyErr = err as any;
  const body = anyErr.body;
  if (typeof body === 'string' && body.trim()) return body;
  const msg = body?.error ?? body?.message ?? anyErr.message;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

export function renderManualIntegradorPowerStockDispatcherPage(
  deps: ManualIntegradorPowerStockDispatcherPageDeps
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  function safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  root.innerHTML = `
    <h1>PowerStock + Processar Pendências</h1>
    <p class="muted">Disparo manual: busca operações no PowerStock e, ao finalizar, processa pendências (Dispatcher).</p>

    <div class="grid">
      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Configuração</h2>
        <div class="row">
          <label style="flex: 1;">
            Data Início
            <input type="date" id="dateStart" />
          </label>
          <label style="flex: 1;">
            Data Fim
            <input type="date" id="dateEnd" />
          </label>
        </div>

        <div class="actions" style="margin-top: 12px;">
          <button id="btnRunDefault">Buscar Dados de Ontem + Processar Pendências</button>
          <button id="btnRunWithDates">Executar com datas informadas</button>
        </div>
        <div class="divider" style="margin: 12px 0;"></div>
        <div class="muted" id="hint"></div>
      </div>

      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Saída</h2>
        <pre id="out" style="height: 220px; overflow: auto;"></pre>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <div class="actions" style="justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h2 style="margin: 0; font-size: 16px;">Histórico de Execuções</h2>
        <button id="btnReloadHistory">Atualizar</button>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Início</th>
            <th>Status</th>
            <th>Trigger</th>
            <th>Emissão Início</th>
            <th>Emissão Fim</th>
            <th>Destinos</th>
            <th>Fim</th>
            <th>Erro</th>
            <th style="width: 90px;">Ações</th>
          </tr>
        </thead>
        <tbody id="historyRows"></tbody>
      </table>
      <pre id="historyDetail" style="margin-top: 10px; display:none;"></pre>
    </div>

    <div id="historyModal" class="modal-backdrop" style="display:none;">
      <div class="modal">
        <div class="modal-header">
          <h2 style="margin: 0; font-size: 16px;">Log da Execução</h2>
          <button id="btnCloseHistoryModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>
        <div id="historyModalMeta" style="font-size: 13px;"></div>
        <div class="divider"></div>
        <pre id="historyModalContent" style="max-height: calc(100vh - 240px); overflow: auto;"></pre>
      </div>
    </div>

    <div id="loadingOverlay" style="display:none; position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 9999;">
      <div style="position:absolute; left:50%; top:50%; transform: translate(-50%, -50%); background:#111827; color:#fff; padding:16px 18px; border-radius:10px; min-width: 280px; box-shadow: 0 10px 30px rgba(0,0,0,0.35);">
        <div style="font-size: 14px; font-weight: 600;">Executando...</div>
        <div style="margin-top: 6px; font-size: 12px; opacity: 0.85;">Aguarde a finalização do disparo.</div>
      </div>
    </div>
  `;

  const dateStartEl = root.querySelector<HTMLInputElement>('#dateStart')!;
  const dateEndEl = root.querySelector<HTMLInputElement>('#dateEnd')!;
  const btnRunDefault = root.querySelector<HTMLButtonElement>('#btnRunDefault')!;
  const btnRunWithDates = root.querySelector<HTMLButtonElement>('#btnRunWithDates')!;
  const outEl = root.querySelector<HTMLPreElement>('#out')!;
  const hintEl = root.querySelector<HTMLDivElement>('#hint')!;
  const historyRowsEl = root.querySelector<HTMLTableSectionElement>('#historyRows')!;
  const historyDetailEl = root.querySelector<HTMLPreElement>('#historyDetail')!;
  const btnReloadHistory = root.querySelector<HTMLButtonElement>('#btnReloadHistory')!;
  const historyModalEl = root.querySelector<HTMLDivElement>('#historyModal')!;
  const btnCloseHistoryModal = root.querySelector<HTMLButtonElement>('#btnCloseHistoryModal')!;
  const historyModalMetaEl = root.querySelector<HTMLDivElement>('#historyModalMeta')!;
  const historyModalContentEl = root.querySelector<HTMLPreElement>('#historyModalContent')!;
  const loadingOverlayEl = root.querySelector<HTMLDivElement>('#loadingOverlay')!;
  let selectedService: { id: string; name: string } | null = null;
  let history: BatchRow[] = [];
  let busyLock = false;

  function log(value: unknown) {
    const line = typeof value === 'string' ? value : safeStringify(value);
    outEl.textContent = `${line}\n\n${outEl.textContent}`;
  }

  function formatDateTime(value?: string | null): string {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('pt-BR');
  }

  function formatDateOnly(value?: string | null): string {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('pt-BR');
  }

  function extractRange(row: BatchRow): { start: string | null; end: string | null } {
    const rr = row.raw_response;
    if (!rr || typeof rr !== 'object') return { start: null, end: null };
    const obj = rr as Record<string, unknown>;
    const start = typeof obj.dataEmissaoInicio === 'string' ? obj.dataEmissaoInicio : null;
    const end = typeof obj.dataEmissaoFim === 'string' ? obj.dataEmissaoFim : null;
    return { start, end };
  }

  function extractDestinos(row: BatchRow): DispatcherDestinoStats[] {
    const rr = row.raw_response;
    if (!rr || typeof rr !== 'object') return [];
    const obj = rr as Record<string, unknown>;
    const destinos = obj.destinos;
    if (!Array.isArray(destinos)) return [];
    return destinos
      .map((d) => {
        if (!d || typeof d !== 'object') return null;
        const rec = d as Record<string, unknown>;
        const sistema_nome = String(rec.sistema_nome ?? '').trim();
        const selected = Number(rec.selected ?? 0);
        const success = Number(rec.success ?? 0);
        const error = Number(rec.error ?? 0);
        if (!sistema_nome) return null;
        return {
          sistema_nome,
          selected: Number.isFinite(selected) ? selected : 0,
          success: Number.isFinite(success) ? success : 0,
          error: Number.isFinite(error) ? error : 0,
        };
      })
      .filter((x): x is DispatcherDestinoStats => Boolean(x))
      .sort((a, b) => a.sistema_nome.localeCompare(b.sistema_nome));
  }

  function formatDestinosInline(destinos: DispatcherDestinoStats[]): { text: string; title: string } {
    if (!destinos.length) return { text: '-', title: '' };
    const title = destinos.map((d) => `${d.sistema_nome} (ok:${d.success} err:${d.error} sel:${d.selected})`).join(', ');
    const maxInline = 2;
    const inlineNames = destinos.slice(0, maxInline).map((d) => d.sistema_nome).join(', ');
    const text = destinos.length > maxInline ? `${inlineNames} +${destinos.length - maxInline}` : inlineNames;
    return { text, title };
  }

  function setBusy(busy: boolean) {
    btnRunDefault.disabled = busy;
    btnRunWithDates.disabled = busy;
    dateStartEl.disabled = busy;
    dateEndEl.disabled = busy;
    btnReloadHistory.disabled = busy;
    loadingOverlayEl.style.display = busy ? 'block' : 'none';
    busyLock = busy;
  }

  function openHistoryModal() {
    historyModalEl.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeHistoryModal() {
    historyModalEl.style.display = 'none';
    document.body.style.overflow = '';
  }

  function resolveExecByServiceName(executions: ExecutionRow[], serviceName: string): ExecutionRow | null {
    const target = serviceName.trim().toLowerCase();
    for (const ex of executions) {
      const sc = ex.snapshot_config as any;
      const sn = String(sc?.service?.service_name ?? '').trim().toLowerCase();
      if (sn === target) return ex;
    }
    for (const ex of executions) {
      const sc = ex.snapshot_config as any;
      const nm = String(sc?.service?.name ?? '').trim().toLowerCase();
      if (nm.includes(target)) return ex;
    }
    return null;
  }

  async function showHistoryLog(batchId: string) {
    historyModalMetaEl.innerHTML = `
      <div class="muted" style="margin: 0;">Carregando log...</div>
      <div class="muted" style="margin: 6px 0 0;">ID: ${batchId}</div>
    `;
    historyModalContentEl.textContent = '';
    openHistoryModal();

    try {
      const batch = await deps.api<BatchRow>(`/api-integration/batches/${encodeURIComponent(batchId)}`);
      const executions = await deps.api<ExecutionRow[]>(
        `/api-integration/executions?batchId=${encodeURIComponent(batchId)}`
      );

      const range = extractRange(batch);
      const destinosInline = formatDestinosInline(extractDestinos(batch));
      const powerStockEx = resolveExecByServiceName(executions, 'PowerStockGetOperationsService');
      const dispatcherEx = resolveExecByServiceName(executions, 'DispatcherService');
      const errorMessage =
        batch.error_message ||
        executions.find((e) => e.status === 'failed' && e.error_message)?.error_message ||
        null;

      historyModalMetaEl.innerHTML = `
        <div style="display: grid; gap: 6px;">
          <div><strong>Status:</strong> ${batch.status} &nbsp; <strong>Trigger:</strong> ${batch.trigger_type}</div>
          <div><strong>Início:</strong> ${formatDateTime(batch.started_at)} &nbsp; <strong>Fim:</strong> ${formatDateTime(batch.finished_at ?? null)}</div>
          <div><strong>Emissão Início:</strong> ${formatDateOnly(range.start)} &nbsp; <strong>Emissão Fim:</strong> ${formatDateOnly(range.end)}</div>
          <div><strong>PowerStock:</strong> ${powerStockEx?.status ?? '-'} &nbsp; <strong>Dispatcher:</strong> ${dispatcherEx?.status ?? '-'}</div>
          <div title="${destinosInline.title.replaceAll('"', '&quot;')}"><strong>Destinos:</strong> ${destinosInline.text}</div>
          ${
            errorMessage
              ? `<div style="color: #ff4d4f;"><strong>Erro:</strong> ${String(errorMessage)}</div>`
              : `<div style="color: #52c41a;"><strong>Resultado:</strong> sucesso</div>`
          }
        </div>
      `;

      historyModalContentEl.textContent = safeStringify({ batch, executions });
    } catch (err) {
      historyModalMetaEl.innerHTML = `<div style="color: #ff4d4f; font-size: 13px;"><strong>Erro ao carregar log:</strong> ${getApiErrorMessage(err, 'Falha ao buscar detalhes do lote.')}</div>`;
      historyModalContentEl.textContent = safeStringify(err);
    }
  }

  function renderHint() {
    const name = selectedService?.name || '';
    hintEl.textContent = name
      ? `Serviço: ${name}`
      : 'Serviço Integrador não encontrado no cadastro. Verifique se existe um service "Integrador Operacoes Loja PowerStock".';
  }

  function renderHistory() {
    historyRowsEl.innerHTML = history.map((b) => {
      const range = extractRange(b);
      const destinosInline = formatDestinosInline(extractDestinos(b));
      return `
        <tr data-id="${b.id}">
          <td>${formatDateTime(b.started_at)}</td>
          <td>${b.status}</td>
          <td>${b.trigger_type}</td>
          <td>${formatDateOnly(range.start)}</td>
          <td>${formatDateOnly(range.end)}</td>
          <td title="${destinosInline.title.replaceAll('"', '&quot;')}">${destinosInline.text}</td>
          <td>${formatDateTime(b.finished_at ?? null)}</td>
          <td>${b.error_message ? String(b.error_message) : '-'}</td>
          <td><button type="button" class="btnViewHistory">Ver</button></td>
        </tr>
      `;
    }).join('');

    historyRowsEl.querySelectorAll<HTMLButtonElement>('button.btnViewHistory').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const id = tr?.getAttribute('data-id');
        const row = id ? history.find((x) => x.id === id) : null;
        if (!row) return;
        void showHistoryLog(row.id);
      });
    });
  }

  async function loadHistory() {
    if (!selectedService?.id) {
      history = [];
      renderHistory();
      return;
    }
    const batches = await deps.api<BatchRow[]>(
      `/api-integration/batches?serviceId=${encodeURIComponent(selectedService.id)}&limit=20`
    );
    history = batches;
    historyDetailEl.style.display = 'none';
    historyDetailEl.textContent = '';
    renderHistory();
  }

  async function loadServices() {
    const services = await deps.api<ServiceRow[]>('/api-integration/services');
    const sorted = [...services].sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const preferred =
      sorted.find((s) => String(s.service_name || '') === 'IntegradorOperacoesLojaDoPowerStockService') ??
      sorted.find((s) => s.name === 'Integrador Operacoes Loja PowerStock') ??
      sorted.find((s) => s.name.toLowerCase().includes('integrador') && s.name.toLowerCase().includes('powerstock')) ??
      null;

    selectedService = preferred ? { id: preferred.id, name: preferred.name } : null;
    btnRunDefault.disabled = !selectedService;
    btnRunWithDates.disabled = !selectedService;
    renderHint();
    await loadHistory();
  }

  async function runExecute(payload?: { dataEmissaoInicio?: string; dataEmissaoFim?: string }) {
    if (!selectedService?.id) {
      alert('Serviço Integrador não encontrado no cadastro.');
      return;
    }
    outEl.textContent = '';
    setBusy(true);
    try {
      const body = payload ? JSON.stringify(payload) : undefined;
      const res = await deps.api(`/api-integration/services/${encodeURIComponent(selectedService.id)}/execute`, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body,
      });
      log({ ok: true, request: payload ?? null, response: res });
      alert('Execução iniciada com sucesso.');
      await loadHistory();
    } catch (err) {
      log({ ok: false, request: payload ?? null, error: err });
      alert(getApiErrorMessage(err, 'Erro ao executar integrador.'));
    } finally {
      setBusy(false);
    }
  }

  btnRunDefault.addEventListener('click', async () => {
    await runExecute(undefined);
  });

  btnRunWithDates.addEventListener('click', async () => {
    const dataEmissaoInicio = dateStartEl.value?.trim();
    const dataEmissaoFim = dateEndEl.value?.trim();
    if (!dataEmissaoInicio || !dataEmissaoFim) {
      alert('Informe Data Início e Data Fim.');
      return;
    }
    const start = new Date(`${dataEmissaoInicio}T00:00:00`);
    const end = new Date(`${dataEmissaoFim}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      alert('Informe datas válidas.');
      return;
    }
    if (start.getTime() > end.getTime()) {
      alert('A Data Início não pode ser maior que a Data Fim.');
      return;
    }
    await runExecute({ dataEmissaoInicio, dataEmissaoFim });
  });

  btnReloadHistory.addEventListener('click', async () => {
    setBusy(true);
    try {
      await loadHistory();
    } catch (err) {
      log({ ok: false, error: err });
      alert(getApiErrorMessage(err, 'Erro ao carregar histórico.'));
    } finally {
      setBusy(false);
    }
  });

  void (async () => {
    try {
      await loadServices();
    } catch (err) {
      log({ ok: false, error: err });
      alert(getApiErrorMessage(err, 'Erro ao carregar serviços.'));
    }
  })();

  btnCloseHistoryModal.addEventListener('click', closeHistoryModal);
  historyModalEl.addEventListener('click', (ev) => {
    if (ev.target === historyModalEl) closeHistoryModal();
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !busyLock) closeHistoryModal();
  });

  return root;
}
