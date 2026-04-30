import { ApiService, ApiServiceGetParam } from '../../../api/src/services/apiIntegrationTypes';

export type ApiServicesPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

export function renderApiServicesPage(deps: ApiServicesPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';
  let authConfigs: Array<{ id: string; name: string }> = [];
  let availableServices: string[] = [];

  root.innerHTML = `
    <h1>Api Services</h1>
    <p class="muted">Configuração dos serviços de integração, parâmetros GET tipados e parâmetros POST (JSON).</p>

    <div class="card">
      <div class="actions" style="justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div class="actions">
          <button id="btnNew">Novo Serviço</button>
          <button id="btnReload">Atualizar</button>
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Nome</th>
            <th>Service</th>
            <th>Endpoint URL</th>
            <th>Parâmetros GET</th>
            <th>Auth Config</th>
            <th>Status</th>
            <th>Ativo</th>
            <th>Última Execução</th>
            <th>Criado em</th>
            <th>Atualizado em</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>

    <!-- Modal CRUD -->
    <div id="modalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal api-service-modal">
        <div class="modal-header">
          <h2 id="modalTitle" style="margin: 0; font-size: 16px;">Configuração do Serviço</h2>
          <button id="btnCloseModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>
        
        <form id="serviceForm" class="api-service-form">
          <input type="hidden" id="serviceId" />
          <div class="row">
            <label>
              ID
              <input id="serviceIdView" readonly placeholder="Gerado automaticamente" />
            </label>
            <label>
              Status Atual
              <select id="currentStatus">
                <option value="idle">idle</option>
                <option value="running">running</option>
                <option value="error">error</option>
              </select>
            </label>
          </div>

          <div class="row">
            <label>
              Nome do Serviço
              <input id="name" required placeholder="Ex: PowerStock Pedidos" />
            </label>
            <label>
              Config de Autenticação
              <select id="authConfigId" required>
                <option value="">Selecione...</option>
              </select>
            </label>
          </div>

          <div class="row" style="margin-top: 10px;">
            <label>
              Service (diretório services)
              <select id="serviceName" required>
                <option value="">Selecione...</option>
              </select>
            </label>
            <label>
              Endpoint da API (URL)
              <input id="endpointUrl" required placeholder="https://api.exemplo.com/v1/recurso" />
            </label>
          </div>

          <div style="margin-top: 10px;">
            <h3 style="margin: 0 0 8px; font-size: 14px;">Parâmetros GET</h3>
            <div class="get-params-list">
              <table class="table compact-table" style="margin-bottom: 8px;">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Valor</th>
                    <th style="width: 90px;">Ações</th>
                  </tr>
                </thead>
                <tbody id="getParamsRows"></tbody>
              </table>
            </div>
            <button type="button" id="btnAddGetParam">Adicionar Parâmetro</button>
          </div>

          <div style="margin-top: 10px;">
            <label>
              Descrição
              <textarea id="description" style="min-height: 60px;"></textarea>
            </label>
          </div>

          <div class="row" style="margin-top: 10px;">
            <label style="flex-direction: row; align-items: center; gap: 8px;">
              <input id="isActive" type="checkbox" style="width: auto; margin: 0;" checked />
              Ativo
            </label>
            <label>
              Última Execução
              <input id="lastRunAt" type="datetime-local" />
            </label>
          </div>

          <div class="row" style="margin-top: 10px;">
            <label>
              Criado em
              <input id="createdAt" readonly />
            </label>
            <label>
              Atualizado em
              <input id="updatedAt" readonly />
            </label>
          </div>

          <div style="margin-top: 15px;">
            <h3 style="margin: 0 0 8px; font-size: 14px;">Parâmetros POST (JSONB - opcional)</h3>
            <label>
              <textarea id="parametros" placeholder='{ "cliente_id": 10, "filtro": "ativos" }'></textarea>
            </label>
          </div>

          <div class="actions" style="margin-top: 20px;">
            <button type="submit" id="btnSave">Salvar</button>
            <button type="button" id="btnCancel">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const rowsEl = root.querySelector<HTMLTableSectionElement>('#rows')!;
  const modalBackdrop = root.querySelector<HTMLDivElement>('#modalBackdrop')!;
  const serviceForm = root.querySelector<HTMLFormElement>('#serviceForm')!;
  const modalTitle = root.querySelector<HTMLElement>('#modalTitle')!;
  const authConfigIdSel = root.querySelector<HTMLSelectElement>('#authConfigId')!;
  
  // Form fields
  const idEl = root.querySelector<HTMLInputElement>('#serviceId')!;
  const idViewEl = root.querySelector<HTMLInputElement>('#serviceIdView')!;
  const nameEl = root.querySelector<HTMLInputElement>('#name')!;
  const serviceNameEl = root.querySelector<HTMLSelectElement>('#serviceName')!;
  const endpointUrlEl = root.querySelector<HTMLInputElement>('#endpointUrl')!;
  const getParamsRowsEl = root.querySelector<HTMLTableSectionElement>('#getParamsRows')!;
  const btnAddGetParam = root.querySelector<HTMLButtonElement>('#btnAddGetParam')!;
  const descriptionEl = root.querySelector<HTMLTextAreaElement>('#description')!;
  const isActiveEl = root.querySelector<HTMLInputElement>('#isActive')!;
  const currentStatusEl = root.querySelector<HTMLSelectElement>('#currentStatus')!;
  const lastRunAtEl = root.querySelector<HTMLInputElement>('#lastRunAt')!;
  const createdAtEl = root.querySelector<HTMLInputElement>('#createdAt')!;
  const updatedAtEl = root.querySelector<HTMLInputElement>('#updatedAt')!;
  const parametrosEl = root.querySelector<HTMLTextAreaElement>('#parametros')!;
  let getParamsDraft: Array<{ key: string; name: string; value_type: ApiServiceGetParam['value_type']; value: string }> = [];

  const newGetParamRow = (
    partial?: Partial<{ name: string; value_type: ApiServiceGetParam['value_type']; value: string }>
  ) => ({
    key: crypto.randomUUID(),
    name: partial?.name ?? '',
    value_type: partial?.value_type ?? 'text',
    value: partial?.value ?? '',
  });

  function renderGetParamsRows() {
    getParamsRowsEl.innerHTML = getParamsDraft.map((row) => `
      <tr data-key="${row.key}">
        <td><input class="gpName" value="${row.name}" placeholder="ex: dataEmissaoInicio" /></td>
        <td>
          <select class="gpType">
            <option value="text" ${row.value_type === 'text' ? 'selected' : ''}>Texto</option>
            <option value="number" ${row.value_type === 'number' ? 'selected' : ''}>Número</option>
            <option value="date" ${row.value_type === 'date' ? 'selected' : ''}>Data</option>
          </select>
        </td>
        <td><input class="gpValue" value="${row.value}" /></td>
        <td><button type="button" class="btnRemoveGetParam">Remover</button></td>
      </tr>
    `).join('');

    getParamsRowsEl.querySelectorAll<HTMLTableRowElement>('tr[data-key]').forEach((tr) => {
      const key = tr.dataset.key!;
      const draft = getParamsDraft.find((item) => item.key === key);
      if (!draft) return;
      const nameInput = tr.querySelector<HTMLInputElement>('.gpName')!;
      const typeSel = tr.querySelector<HTMLSelectElement>('.gpType')!;
      const valueInput = tr.querySelector<HTMLInputElement>('.gpValue')!;
      const removeBtn = tr.querySelector<HTMLButtonElement>('.btnRemoveGetParam')!;

      const applyValueInputType = () => {
        valueInput.type = draft.value_type === 'number' ? 'number' : draft.value_type === 'date' ? 'date' : 'text';
      };
      applyValueInputType();

      nameInput.addEventListener('input', () => {
        draft.name = nameInput.value;
      });
      typeSel.addEventListener('change', () => {
        draft.value_type = typeSel.value as ApiServiceGetParam['value_type'];
        applyValueInputType();
      });
      valueInput.addEventListener('input', () => {
        draft.value = valueInput.value;
      });
      removeBtn.addEventListener('click', () => {
        getParamsDraft = getParamsDraft.filter((item) => item.key !== key);
        renderGetParamsRows();
      });
    });
  }

  function parseLegacyParametroGet(parametroGet?: string | null): ApiServiceGetParam[] {
    if (!parametroGet) return [];
    return parametroGet
      .split(/[&\r\n]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const idx = entry.indexOf('=');
        if (idx < 0) return { name: entry, value_type: 'text', value: '' } as ApiServiceGetParam;
        return {
          name: entry.slice(0, idx).trim(),
          value_type: 'text',
          value: entry.slice(idx + 1).trim(),
        } as ApiServiceGetParam;
      })
      .filter((entry) => entry.name);
  }

  function collectGetParamsFromDraft(): ApiServiceGetParam[] {
    const cleaned = getParamsDraft
      .map((row, index) => ({
        name: row.name.trim(),
        value_type: row.value_type,
        value: row.value.trim(),
        sort_order: index,
      }))
      .filter((row) => row.name);

    for (const row of cleaned) {
      if (row.value_type === 'number' && row.value && !Number.isFinite(Number(row.value))) {
        throw new Error(`O valor do parâmetro "${row.name}" deve ser numérico.`);
      }
      if (row.value_type === 'date' && row.value && Number.isNaN(new Date(row.value).getTime())) {
        throw new Error(`O valor do parâmetro "${row.name}" deve ser uma data válida.`);
      }
    }
    return cleaned;
  }

  async function loadAuthConfigs() {
    try {
      const data = await deps.api<any[]>('/api-integration/auth-configs');
      authConfigs = data.map((c) => ({ id: c.id, name: c.name }));
      authConfigIdSel.innerHTML = '<option value="">Selecione...</option>' + 
        data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    } catch (err) {
      console.error('Erro ao carregar auth configs:', err);
    }
  }

  async function loadAvailableServices() {
    try {
      const data = await deps.api<string[]>('/api-integration/services/available');
      availableServices = data;
      serviceNameEl.innerHTML = '<option value="">Selecione...</option>' +
        availableServices.map((name) => `<option value="${name}">${name}</option>`).join('');
    } catch (err) {
      console.error('Erro ao carregar services disponíveis:', err);
    }
  }

  async function loadData() {
    try {
      const data = await deps.api<ApiService[]>('/api-integration/services');
      renderRows(data);
    } catch (err) {
      console.error('Erro ao carregar serviços:', err);
      alert('Erro ao carregar dados.');
    }
  }

  function renderRows(items: ApiService[]) {
    const authById = new Map(authConfigs.map((cfg) => [cfg.id, cfg.name]));
    rowsEl.innerHTML = items.map(item => `
      <tr>
        <td><small>${item.id}</small></td>
        <td>
          <strong>${item.name}</strong><br/>
          <small class="muted">${item.description || ''}</small>
        </td>
        <td>${item.service_name || '-'}</td>
        <td><small>${item.endpoint_url || '-'}</small></td>
        <td><small>${item.get_params?.length ? `${item.get_params.length} parâmetro(s)` : '-'}</small></td>
        <td>${item.auth_config_id ? (authById.get(item.auth_config_id) || item.auth_config_id) : '-'}</td>
        <td>${item.current_status || '-'}</td>
        <td>${item.is_active ? '✅' : '❌'}</td>
        <td>${item.last_run_at ? new Date(item.last_run_at).toLocaleString() : '-'}</td>
        <td>${item.created_at ? new Date(item.created_at).toLocaleString() : '-'}</td>
        <td>${item.updated_at ? new Date(item.updated_at).toLocaleString() : '-'}</td>
        <td>
          <div class="actions">
            <button class="btnEdit" data-id="${item.id}">Editar</button>
            <button class="btnDelete" data-id="${item.id}" style="color: #ff4d4f; border-color: rgba(255, 77, 79, 0.3);">Excluir</button>
          </div>
        </td>
      </tr>
    `).join('');

    rowsEl.querySelectorAll('.btnEdit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id;
        const item = items.find(i => i.id === id);
        if (item) openModal(item);
      });
    });

    rowsEl.querySelectorAll('.btnDelete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id;
        if (confirm('Tem certeza que deseja excluir este serviço?')) {
          try {
            await deps.api(`/api-integration/services/${id}`, { method: 'DELETE' });
            void loadData();
          } catch (err) {
            alert('Erro ao excluir.');
          }
        }
      });
    });
  }

  function toDateTimeLocal(value?: Date | string): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - offset * 60_000);
    return localDate.toISOString().slice(0, 16);
  }

  function openModal(item?: ApiService) {
    modalTitle.textContent = item ? 'Editar Serviço' : 'Novo Serviço';
    idEl.value = item?.id || '';
    idViewEl.value = item?.id || '';
    nameEl.value = item?.name || '';
    serviceNameEl.value = item?.service_name || '';
    endpointUrlEl.value = item?.endpoint_url || '';
    const getParams = item?.get_params?.length ? item.get_params : parseLegacyParametroGet(item?.parametro_get);
    getParamsDraft = getParams.map((p) => newGetParamRow({ name: p.name, value_type: p.value_type, value: p.value }));
    renderGetParamsRows();
    descriptionEl.value = item?.description || '';
    isActiveEl.checked = item ? item.is_active : true;
    currentStatusEl.value = item?.current_status || 'idle';
    lastRunAtEl.value = toDateTimeLocal(item?.last_run_at);
    createdAtEl.value = item?.created_at ? new Date(item.created_at).toLocaleString() : '';
    updatedAtEl.value = item?.updated_at ? new Date(item.updated_at).toLocaleString() : '';
    authConfigIdSel.value = item?.auth_config_id || '';
    const parametros = item?.parametros ?? item?.endpoints;
    parametrosEl.value = parametros ? JSON.stringify(parametros, null, 2) : '';
    
    modalBackdrop.style.display = 'flex';
  }

  function closeModal() {
    modalBackdrop.style.display = 'none';
  }

  root.querySelector('#btnNew')?.addEventListener('click', () => openModal());
  root.querySelector('#btnReload')?.addEventListener('click', () => loadData());
  root.querySelector('#btnCloseModal')?.addEventListener('click', closeModal);
  root.querySelector('#btnCancel')?.addEventListener('click', closeModal);
  btnAddGetParam.addEventListener('click', () => {
    getParamsDraft.push(newGetParamRow());
    renderGetParamsRows();
  });

  serviceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    let parametrosParsed: unknown = null;
    if (parametrosEl.value.trim()) {
      try {
        parametrosParsed = JSON.parse(parametrosEl.value);
      } catch (err) {
        alert('JSON de Parâmetros POST inválido.');
        return;
      }
    }

    let getParams: ApiServiceGetParam[];
    try {
      getParams = collectGetParamsFromDraft();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Parâmetros GET inválidos.');
      return;
    }

    const payload = {
      name: nameEl.value,
      service_name: serviceNameEl.value,
      endpoint_url: endpointUrlEl.value,
      parametro_get: null,
      get_params: getParams,
      description: descriptionEl.value,
      is_active: isActiveEl.checked,
      current_status: currentStatusEl.value,
      last_run_at: lastRunAtEl.value ? new Date(lastRunAtEl.value).toISOString() : null,
      auth_config_id: authConfigIdSel.value,
      parametros: parametrosParsed
    };

    try {
      const id = idEl.value;
      if (id) {
        await deps.api(`/api-integration/services/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await deps.api('/api-integration/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      closeModal();
      void loadData();
    } catch (err: any) {
      const message = err?.body?.error || err?.message || 'Erro ao salvar.';
      alert(message);
    }
  });

  void loadAuthConfigs();
  void loadAvailableServices();
  void loadData();
  return root;
}
