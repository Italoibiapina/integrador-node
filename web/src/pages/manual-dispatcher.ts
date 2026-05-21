export type ManualDispatcherPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type PendingSummary = {
  pendingEligible: number;
  batchLimit: number;
  maxRetries: number;
  maxConcurrency: number;
};

type ServiceRow = {
  id: string;
  name: string;
  service_name?: string | null;
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

type DispatcherDestinoStats = {
  sistema_nome: string;
  selected: number;
  success: number;
  error: number;
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

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback;
  const anyErr = err as any;
  const body = anyErr.body;
  if (typeof body === 'string' && body.trim()) return body;
  const msg = body?.error ?? body?.message ?? anyErr.message;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

export function renderManualDispatcherPage(deps: ManualDispatcherPageDeps): HTMLElement {
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
    <h1>Processar Pendências (Dispatcher)</h1>
    <p class="muted">Disparo manual do processamento de pendências para o sistema destino.</p>

    <div class="grid">
      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Status</h2>
        <div class="row">
          <span class="pill">Pendentes elegíveis: <strong id="pendingCount">-</strong></span>
          <span class="pill">Limite do lote: <strong id="batchLimit">-</strong></span>
          <span class="pill">Máx retries: <strong id="maxRetries">-</strong></span>
          <span class="pill">Concorrência: <strong id="maxConcurrency">-</strong></span>
        </div>
        <div class="actions" style="margin-top: 12px;">
          <button id="btnReload">Atualizar</button>
          <button id="btnExecute">Processar Pendências Agora</button>
        </div>
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
            <th>Destinos</th>
            <th>Selecionadas</th>
            <th>Sucesso</th>
            <th>Erro</th>
            <th>Fim</th>
            <th>Erro (msg)</th>
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
        <div style="font-size: 14px; font-weight: 600;">Processando...</div>
        <div style="margin-top: 6px; font-size: 12px; opacity: 0.85;">Aguarde a finalização do processamento.</div>
      </div>
    </div>
  `;

  const pendingCountEl = root.querySelector<HTMLElement>('#pendingCount')!;
  const batchLimitEl = root.querySelector<HTMLElement>('#batchLimit')!;
  const maxRetriesEl = root.querySelector<HTMLElement>('#maxRetries')!;
  const maxConcurrencyEl = root.querySelector<HTMLElement>('#maxConcurrency')!;
  const btnReload = root.querySelector<HTMLButtonElement>('#btnReload')!;
  const btnExecute = root.querySelector<HTMLButtonElement>('#btnExecute')!;
  const outEl = root.querySelector<HTMLPreElement>('#out')!;
  const historyRowsEl = root.querySelector<HTMLTableSectionElement>('#historyRows')!;
  const historyDetailEl = root.querySelector<HTMLPreElement>('#historyDetail')!;
  const btnReloadHistory = root.querySelector<HTMLButtonElement>('#btnReloadHistory')!;
  const historyModalEl = root.querySelector<HTMLDivElement>('#historyModal')!;
  const btnCloseHistoryModal = root.querySelector<HTMLButtonElement>('#btnCloseHistoryModal')!;
  const historyModalMetaEl = root.querySelector<HTMLDivElement>('#historyModalMeta')!;
  const historyModalContentEl = root.querySelector<HTMLPreElement>('#historyModalContent')!;
  const loadingOverlayEl = root.querySelector<HTMLDivElement>('#loadingOverlay')!;

  let busyLock = false;
  let dispatcherServiceId: string | null = null;
  let history: BatchRow[] = [];

  function log(value: unknown) {
    const line = typeof value === 'string' ? value : safeStringify(value);
    outEl.textContent = `${line}\n\n${outEl.textContent}`;
  }

  function setBusy(busy: boolean) {
    btnReload.disabled = busy;
    btnExecute.disabled = busy;
    btnReloadHistory.disabled = busy;
    loadingOverlayEl.style.display = busy ? 'block' : 'none';
    busyLock = busy;
  }

  const lockKeyboard = (ev: KeyboardEvent) => {
    if (!busyLock) return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  window.addEventListener('keydown', lockKeyboard, true);

  function openHistoryModal() {
    historyModalEl.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeHistoryModal() {
    historyModalEl.style.display = 'none';
    document.body.style.overflow = '';
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

      const counts = extractCounts(batch);
      const destinos = extractDestinos(batch);
      const destinosInline = formatDestinosInline(destinos);
      const errorMessage =
        batch.error_message ||
        executions.find((e) => e.status === 'failed' && e.error_message)?.error_message ||
        null;

      historyModalMetaEl.innerHTML = `
        <div style="display: grid; gap: 6px;">
          <div><strong>Status:</strong> ${batch.status} &nbsp; <strong>Trigger:</strong> ${batch.trigger_type}</div>
          <div><strong>Início:</strong> ${formatDateTime(batch.started_at)} &nbsp; <strong>Fim:</strong> ${formatDateTime(batch.finished_at ?? null)}</div>
          <div title="${destinosInline.title ? destinosInline.title.replaceAll('"', '&quot;') : ''}"><strong>Destinos:</strong> ${destinosInline.text}</div>
          <div><strong>Selecionadas:</strong> ${counts.selected ?? '-'} &nbsp; <strong>Sucesso:</strong> ${counts.success ?? '-'} &nbsp; <strong>Erro:</strong> ${counts.error ?? '-'}</div>
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

  function formatDateTime(value?: string | null): string {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('pt-BR');
  }

  function extractCounts(row: BatchRow): { selected: number | null; success: number | null; error: number | null } {
    const rr = row.raw_response;
    if (!rr || typeof rr !== 'object') return { selected: null, success: null, error: null };
    const obj = rr as Record<string, unknown>;
    const selected = typeof obj.total_pending_selected === 'number' ? obj.total_pending_selected : null;
    const success = typeof obj.success === 'number' ? obj.success : null;
    const error = typeof obj.error === 'number' ? obj.error : null;
    return { selected, success, error };
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
      .filter((x): x is DispatcherDestinoStats => Boolean(x));
  }

  function formatDestinosInline(destinos: DispatcherDestinoStats[]): { text: string; title: string } {
    if (!destinos.length) return { text: '-', title: '' };
    const sorted = [...destinos].sort((a, b) => a.sistema_nome.localeCompare(b.sistema_nome));
    const title = sorted.map((d) => `${d.sistema_nome} (ok:${d.success} err:${d.error} sel:${d.selected})`).join(', ');
    const maxInline = 2;
    const inlineNames = sorted.slice(0, maxInline).map((d) => d.sistema_nome).join(', ');
    const text = sorted.length > maxInline ? `${inlineNames} +${sorted.length - maxInline}` : inlineNames;
    return { text, title };
  }

  function renderHistory() {
    historyRowsEl.innerHTML = history.map((b) => {
      const counts = extractCounts(b);
      const destinos = extractDestinos(b);
      const destinosInline = formatDestinosInline(destinos);
      return `
        <tr data-id="${b.id}">
          <td>${formatDateTime(b.started_at)}</td>
          <td>${b.status}</td>
          <td>${b.trigger_type}</td>
          <td title="${destinosInline.title ? destinosInline.title.replaceAll('"', '&quot;') : ''}">${destinosInline.text}</td>
          <td>${counts.selected ?? '-'}</td>
          <td>${counts.success ?? '-'}</td>
          <td>${counts.error ?? '-'}</td>
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

  async function loadPendingSummary() {
    const summary = await deps.api<PendingSummary>('/api-integration/dispatcher/pending');
    pendingCountEl.textContent = String(summary.pendingEligible);
    batchLimitEl.textContent = String(summary.batchLimit);
    maxRetriesEl.textContent = String(summary.maxRetries);
    maxConcurrencyEl.textContent = String(summary.maxConcurrency);
  }

  async function resolveDispatcherServiceId() {
    const services = await deps.api<ServiceRow[]>('/api-integration/services');
    const dispatcher =
      services.find((s) => String(s.service_name || '') === 'DispatcherService') ??
      services.find((s) => s.name === 'Dispatcher Service') ??
      null;
    dispatcherServiceId = dispatcher?.id ?? null;
  }

  async function loadHistory() {
    if (!dispatcherServiceId) {
      history = [];
      renderHistory();
      return;
    }
    const batches = await deps.api<BatchRow[]>(
      `/api-integration/batches?serviceId=${encodeURIComponent(dispatcherServiceId)}&limit=20`
    );
    history = batches;
    historyDetailEl.style.display = 'none';
    historyDetailEl.textContent = '';
    renderHistory();
  }

  async function executeOnce() {
    outEl.textContent = '';
    setBusy(true);
    try {
      const res = await deps.api('/api-integration/dispatcher/execute', { method: 'POST' });
      log({ ok: true, response: res });
      await loadPendingSummary();
      await loadHistory();
      alert('Processamento iniciado com sucesso.');
    } catch (err) {
      log({ ok: false, error: err });
      alert(getApiErrorMessage(err, 'Erro ao executar dispatcher.'));
    } finally {
      setBusy(false);
    }
  }

  btnReload.addEventListener('click', async () => {
    setBusy(true);
    try {
      await loadPendingSummary();
    } catch (err) {
      log({ ok: false, error: err });
      alert(getApiErrorMessage(err, 'Erro ao carregar status.'));
    } finally {
      setBusy(false);
    }
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

  btnExecute.addEventListener('click', async () => {
    await executeOnce();
  });

  void (async () => {
    setBusy(true);
    try {
      await resolveDispatcherServiceId();
      await loadPendingSummary();
      await loadHistory();
    } catch (err) {
      log({ ok: false, error: err });
      alert(getApiErrorMessage(err, 'Erro ao inicializar tela.'));
    } finally {
      setBusy(false);
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
