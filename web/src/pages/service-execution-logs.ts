import { ApiBatch } from '../../../api/src/services/apiIntegrationTypes';

export type ServiceExecutionLogsPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

export function renderServiceExecutionLogsPage(deps: ServiceExecutionLogsPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';
  let availableServices: Array<{ id: string; name: string }> = [];

  root.innerHTML = `
    <h1>Logs de Execução de Serviços</h1>
    <p class="muted">Consulte o histórico de execuções e detalhes de cada lote.</p>

    <div class="card" style="margin-bottom: 20px;">
      <div class="row">
        <label>
          Serviço
          <select id="filterService">
            <option value="">Todos os Serviços</option>
          </select>
        </label>
        <label>
          Data Início
          <input type="date" id="filterDateStart" />
        </label>
        <label>
          Data Fim
          <input type="date" id="filterDateEnd" />
        </label>
        <div style="display: flex; align-items: flex-end;">
          <button id="btnFilter">Filtrar</button>
        </div>
        <div style="display: flex; align-items: flex-end;">
          <button id="btnNewExecution">Nova Execução</button>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2 style="font-size: 16px; margin-bottom: 12px;">Últimas Execuções</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Data/Hora</th>
              <th>Serviço</th>
              <th>Status</th>
              <th>Destinos</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="batchRows"></tbody>
        </table>
      </div>

      <div id="detailWorkspace" style="display: none;">
        <div class="log-detail-grid">
          <div id="detailSection" class="card">
            <h2 style="font-size: 16px; margin-bottom: 12px;">Detalhes da Execução</h2>
            <div id="batchDetail"></div>

            <h3 style="font-size: 14px; margin-top: 20px; margin-bottom: 10px;">Execuções de Serviço</h3>
            <table class="table">
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th>Início</th>
                  <th>Status</th>
                  <th>Duração</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="executionRows"></tbody>
            </table>
          </div>

          <div id="executionDetailSection" class="card" style="display: none;">
            <h2 style="font-size: 16px; margin-bottom: 12px;">Detalhes da Execução Selecionada</h2>
            <table class="table">
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th>Sub-etapa</th>
                  <th>Início</th>
                  <th>Status</th>
                  <th>Duração</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="executionDetailRows"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal para ver JSON bruto -->
    <div id="jsonModal" class="modal-backdrop" style="display:none;">
      <div class="modal">
        <div class="modal-header">
          <h2 style="margin: 0; font-size: 16px;">Resposta Bruta (JSON)</h2>
          <button id="btnCloseJsonModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>
        <pre id="jsonContent"></pre>
      </div>
    </div>

    <div id="newExecutionModal" class="modal-backdrop" style="display:none;">
      <div class="modal">
        <div class="modal-header">
          <h2 style="margin: 0; font-size: 16px;">Nova Execução</h2>
          <button id="btnCloseNewExecutionModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>
        <div class="row">
          <label>
            Serviço
            <select id="newExecutionService">
              <option value="">Selecione um serviço</option>
            </select>
          </label>
        </div>
        <div class="actions" style="margin-top: 16px;">
          <button id="btnExecuteService">Executar</button>
          <button id="btnCancelNewExecution" type="button">Cancelar</button>
        </div>
      </div>
    </div>
  `;

  const batchRowsEl = root.querySelector<HTMLTableSectionElement>('#batchRows')!;
  const executionRowsEl = root.querySelector<HTMLTableSectionElement>('#executionRows')!;
  const executionDetailRowsEl = root.querySelector<HTMLTableSectionElement>('#executionDetailRows')!;
  const batchDetailEl = root.querySelector<HTMLDivElement>('#batchDetail')!;
  const detailWorkspace = root.querySelector<HTMLDivElement>('#detailWorkspace')!;
  const executionDetailSection = root.querySelector<HTMLDivElement>('#executionDetailSection')!;
  const filterServiceSel = root.querySelector<HTMLSelectElement>('#filterService')!;
  const filterDateStart = root.querySelector<HTMLInputElement>('#filterDateStart')!;
  const filterDateEnd = root.querySelector<HTMLInputElement>('#filterDateEnd')!;
  const jsonModal = root.querySelector<HTMLDivElement>('#jsonModal')!;
  const jsonContent = root.querySelector<HTMLPreElement>('#jsonContent')!;
  const newExecutionModal = root.querySelector<HTMLDivElement>('#newExecutionModal')!;
  const newExecutionServiceSel = root.querySelector<HTMLSelectElement>('#newExecutionService')!;

  async function loadServices() {
    try {
      const services = await deps.api<any[]>('/api-integration/services');
      availableServices = services.map((s) => ({ id: s.id, name: s.name }));
      filterServiceSel.innerHTML = '<option value="">Todos os Serviços</option>' + 
        services.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      newExecutionServiceSel.innerHTML = '<option value="">Selecione um serviço</option>' +
        availableServices.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    } catch (err) {
      console.error(err);
    }
  }

  async function loadBatches() {
    try {
      const serviceId = filterServiceSel.value;
      const start = filterDateStart.value;
      const end = filterDateEnd.value;
      
      let url = '/api-integration/batches?limit=20';
      if (serviceId) url += `&serviceId=${serviceId}`;
      if (start) url += `&start=${start}`;
      if (end) url += `&end=${end}`;

      const batches = await deps.api<ApiBatch[]>(url);
      renderBatchRows(batches);
    } catch (err) {
      console.error(err);
      alert('Erro ao carregar lotes.');
    }
  }

  function resolveBatchServiceName(batch: any): string {
    return (
      batch?.snapshot_config?.service?.name ||
      batch?.service_name ||
      batch?.name ||
      'Serviço'
    );
  }

  type DispatcherDestinoStats = {
    sistema_nome: string;
    selected: number;
    success: number;
    error: number;
  };

  function extractDestinosFromBatch(batch: ApiBatch): DispatcherDestinoStats[] {
    const rr = batch?.raw_response;
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

  function resolveExecutionServiceAndStep(execution: any): { service: string; subStep: string } {
    const serviceName =
      execution?.snapshot_config?.service?.service_name ||
      execution?.snapshot_config?.service?.name ||
      'Serviço';

    const rawName = String(execution?.snapshot_config?.service?.name || '');
    if (rawName.includes(' - ')) {
      const parts = rawName.split(' - ');
      return {
        service: String(parts[0] || serviceName).trim() || serviceName,
        subStep: String(parts.slice(1).join(' - ') || 'Execução principal').trim(),
      };
    }

    return { service: String(serviceName), subStep: 'Execução principal' };
  }

  function renderBatchRows(batches: ApiBatch[]) {
    batchRowsEl.innerHTML = batches.map(b => `
      <tr>
        <td>${new Date(b.started_at).toLocaleString()}</td>
        <td>${resolveBatchServiceName(b)}</td>
        <td>
          <span class="pill" style="color: ${b.status === 'success' ? '#52c41a' : b.status === 'error' ? '#ff4d4f' : '#faad14'}">
            ${b.status}
          </span>
        </td>
        <td title="${formatDestinosInline(extractDestinosFromBatch(b)).title.replaceAll('"', '&quot;')}">${formatDestinosInline(extractDestinosFromBatch(b)).text}</td>
        <td>
          <button class="btnViewDetail" data-id="${b.id}">Ver Detalhes</button>
        </td>
      </tr>
    `).join('');

    batchRowsEl.querySelectorAll('.btnViewDetail').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id;
        void loadBatchDetail(id!);
      });
    });
  }

  async function loadBatchDetail(batchId: string) {
    try {
      const batch = await deps.api<ApiBatch>(`/api-integration/batches/${batchId}`);
      const executions = await deps.api<any[]>(`/api-integration/executions?batchId=${batchId}`);
      const destinosInline = formatDestinosInline(extractDestinosFromBatch(batch));
      
      detailWorkspace.style.display = 'block';
      executionDetailSection.style.display = 'none';
      
      batchDetailEl.innerHTML = `
        <div style="font-size: 13px;">
          <p><strong>ID:</strong> ${batch.id}</p>
          <p><strong>Serviço:</strong> ${resolveBatchServiceName(batch)}</p>
          <p><strong>Duração:</strong> ${batch.finished_at ? Math.round((new Date(batch.finished_at).getTime() - new Date(batch.started_at).getTime()) / 1000) + 's' : 'Em andamento'}</p>
          <p title="${destinosInline.title.replaceAll('"', '&quot;')}"><strong>Destinos:</strong> ${destinosInline.text}</p>
          ${batch.error_message ? `<p style="color: #ff4d4f;"><strong>Erro:</strong> ${batch.error_message}</p>` : ''}
          <button id="btnViewBatchRaw" class="pill">Ver JSON Bruto do Lote</button>
        </div>
      `;

      root.querySelector('#btnViewBatchRaw')?.addEventListener('click', () => {
        showJson(batch.raw_response);
      });

      executionRowsEl.innerHTML = executions.map((ex, idx) => {
        const executionInfo = resolveExecutionServiceAndStep(ex);
        const duration = ex.finished_at 
          ? Math.round((new Date(ex.finished_at).getTime() - new Date(ex.started_at).getTime()) / 1000) + 's'
          : '-';
        return `
          <tr>
            <td>${executionInfo.service}</td>
            <td>${new Date(ex.started_at).toLocaleString()}</td>
            <td>
              <span class="pill" style="color: ${ex.status === 'success' ? '#52c41a' : ex.status === 'error' ? '#ff4d4f' : '#faad14'}">
                ${ex.status}
              </span>
            </td>
            <td>${duration}</td>
            <td>
              <button class="btnViewExRaw" data-idx="${idx}">Ver JSON</button>
              <button class="btnViewExDetails" data-id="${ex.id}" style="margin-left: 8px;">Ver Detalhes</button>
            </td>
          </tr>
        `;
      }).join('');

      executionRowsEl.querySelectorAll('.btnViewExRaw').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt((btn as HTMLElement).dataset.idx!);
          showJson(executions[idx].raw_response);
        });
      });

      executionRowsEl.querySelectorAll('.btnViewExDetails').forEach(btn => {
        btn.addEventListener('click', () => {
          const executionId = (btn as HTMLElement).dataset.id!;
          void loadExecutionDetails(executionId);
        });
      });

      if (executions.length > 0 && executions[0]?.id) {
        await loadExecutionDetails(executions[0].id);
      } else {
        executionDetailRowsEl.innerHTML = '<tr><td colspan="6" class="muted">Sem detalhes para este lote.</td></tr>';
      }

    } catch (err) {
      console.error(err);
      alert('Erro ao carregar detalhes.');
    }
  }

  async function loadExecutionDetails(executionId: string) {
    try {
      executionDetailSection.style.display = 'block';
      const details = await deps.api<any[]>(`/api-integration/executions/${executionId}/details`);
      if (!details.length) {
        executionDetailRowsEl.innerHTML = '<tr><td colspan="6" class="muted">Sem sub-etapas para esta execução.</td></tr>';
        return;
      }

      executionDetailRowsEl.innerHTML = details.map((ex, idx) => {
        const executionInfo = resolveExecutionServiceAndStep(ex);
        const duration = ex.finished_at
          ? Math.round((new Date(ex.finished_at).getTime() - new Date(ex.started_at).getTime()) / 1000) + 's'
          : '-';
        return `
          <tr>
            <td>${executionInfo.service}</td>
            <td>${executionInfo.subStep}</td>
            <td>${new Date(ex.started_at).toLocaleString()}</td>
            <td>
              <span class="pill" style="color: ${ex.status === 'success' ? '#52c41a' : ex.status === 'error' ? '#ff4d4f' : '#faad14'}">
                ${ex.status}
              </span>
            </td>
            <td>${duration}</td>
            <td><button class="btnViewExDetailRaw" data-idx="${idx}">Ver JSON</button></td>
          </tr>
        `;
      }).join('');

      executionDetailRowsEl.querySelectorAll('.btnViewExDetailRaw').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt((btn as HTMLElement).dataset.idx || '0');
          showJson(details[idx]?.raw_response);
        });
      });
    } catch (err) {
      console.error(err);
      executionDetailRowsEl.innerHTML = '<tr><td colspan="6" class="muted">Erro ao carregar sub-etapas.</td></tr>';
    }
  }

  function showJson(data: any) {
    jsonContent.textContent = JSON.stringify(data, null, 2);
    jsonModal.style.display = 'flex';
  }

  function openNewExecutionModal() {
    newExecutionServiceSel.value = '';
    newExecutionModal.style.display = 'flex';
  }

  function closeNewExecutionModal() {
    newExecutionModal.style.display = 'none';
  }

  function getApiErrorMessage(err: unknown, fallback: string): string {
    if (!err || typeof err !== 'object') return fallback;
    const data = err as { status?: number; body?: unknown };
    const body = data.body;
    if (typeof body === 'string' && body.trim()) return body;
    if (body && typeof body === 'object') {
      const bodyObj = body as { error?: unknown; message?: unknown };
      if (typeof bodyObj.error === 'string' && bodyObj.error.trim()) return bodyObj.error;
      if (typeof bodyObj.message === 'string' && bodyObj.message.trim()) return bodyObj.message;
    }
    return fallback;
  }

  async function executeSelectedService() {
    const serviceId = newExecutionServiceSel.value;
    if (!serviceId) {
      alert('Selecione um serviço para executar.');
      return;
    }
    try {
      await deps.api(`/api-integration/services/${serviceId}/execute`, { method: 'POST' });
      closeNewExecutionModal();
      alert('Execução iniciada com sucesso.');
      await loadBatches();
    } catch (err) {
      console.error(err);
      alert(getApiErrorMessage(err, 'Erro ao executar serviço.'));
    }
  }

  root.querySelector('#btnCloseJsonModal')?.addEventListener('click', () => {
    jsonModal.style.display = 'none';
  });

  root.querySelector('#btnFilter')?.addEventListener('click', () => loadBatches());
  root.querySelector('#btnNewExecution')?.addEventListener('click', openNewExecutionModal);
  root.querySelector('#btnCloseNewExecutionModal')?.addEventListener('click', closeNewExecutionModal);
  root.querySelector('#btnCancelNewExecution')?.addEventListener('click', closeNewExecutionModal);
  root.querySelector('#btnExecuteService')?.addEventListener('click', () => {
    void executeSelectedService();
  });

  void loadServices();
  void loadBatches();

  return root;
}
