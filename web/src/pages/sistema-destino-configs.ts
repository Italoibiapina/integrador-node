import { ApiAuthConfig, SistemaDestinoConfig } from '../../../api/src/services/apiIntegrationTypes';

export type SistemaDestinoConfigsPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

export function renderSistemaDestinoConfigsPage(deps: SistemaDestinoConfigsPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  let authConfigs: ApiAuthConfig[] = [];

  root.innerHTML = `
    <h1>Sistema Destino Config</h1>
    <p class="muted">Configure os sistemas de destino que receberão os payloads processados pelo DispatcherService.</p>

    <div class="card">
      <div class="actions" style="justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div class="actions">
          <button id="btnNew">Nova Configuração</button>
          <button id="btnReload">Atualizar</button>
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Nome</th>
            <th>Tabela Origem</th>
            <th>Entidade/View</th>
            <th>Endpoint URL</th>
            <th>Método</th>
            <th>Conexão API</th>
            <th>Ativo</th>
            <th>Criado em</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>

    <div id="modalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal">
        <div class="modal-header">
          <h2 id="modalTitle" style="margin: 0; font-size: 16px;">Configuração de Sistema de Destino</h2>
          <button id="btnCloseModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>

        <form id="configForm">
          <input type="hidden" id="configId" />
          <div class="row">
            <label>
              Nome
              <input id="nome" required placeholder="Ex: EspoCRM" />
            </label>
            <label>
              Conexão API
              <select id="conexaoApiId" required>
                <option value="">Selecione...</option>
              </select>
            </label>
          </div>

          <div class="row" style="margin-top: 10px;">
            <label>
              Tabela de Origem
              <input id="tabelaOrigem" required placeholder="Ex: operacoes" />
            </label>
            <label>
              Entidade/View
              <input id="entidadeView" required placeholder="Ex: vw_operacoes_dispatch" />
            </label>
          </div>

          <div class="row" style="margin-top: 10px;">
            <label>
              Endpoint URL
              <input id="endpointUrl" required placeholder="/api/webhooks/operacoes" />
            </label>
            <label>
              Método
              <select id="metodo">
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </select>
            </label>
          </div>

          <div class="row" style="margin-top: 10px;">
            <label style="flex-direction: row; align-items: center; gap: 8px;">
              <input id="ativo" type="checkbox" style="width: auto; margin: 0;" checked />
              Ativo
            </label>
          </div>

          <div class="actions" style="margin-top: 20px;">
            <button type="submit">Salvar</button>
            <button type="button" id="btnCancel">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const rowsEl = root.querySelector<HTMLTableSectionElement>('#rows')!;
  const modalBackdrop = root.querySelector<HTMLDivElement>('#modalBackdrop')!;
  const configForm = root.querySelector<HTMLFormElement>('#configForm')!;
  const modalTitle = root.querySelector<HTMLElement>('#modalTitle')!;

  const idEl = root.querySelector<HTMLInputElement>('#configId')!;
  const nomeEl = root.querySelector<HTMLInputElement>('#nome')!;
  const tabelaOrigemEl = root.querySelector<HTMLInputElement>('#tabelaOrigem')!;
  const entidadeViewEl = root.querySelector<HTMLInputElement>('#entidadeView')!;
  const endpointUrlEl = root.querySelector<HTMLInputElement>('#endpointUrl')!;
  const metodoEl = root.querySelector<HTMLSelectElement>('#metodo')!;
  const ativoEl = root.querySelector<HTMLInputElement>('#ativo')!;
  const conexaoApiIdEl = root.querySelector<HTMLSelectElement>('#conexaoApiId')!;

  async function loadAuthConfigs() {
    try {
      authConfigs = await deps.api<ApiAuthConfig[]>('/api-integration/auth-configs');
      conexaoApiIdEl.innerHTML =
        '<option value="">Selecione...</option>' +
        authConfigs.map((item) => `<option value="${item.id}">${item.name}</option>`).join('');
    } catch (err) {
      console.error('Erro ao carregar conexões de API:', err);
    }
  }

  async function loadData() {
    try {
      const data = await deps.api<SistemaDestinoConfig[]>('/api-integration/sistema-destino-configs');
      renderRows(data);
    } catch (err) {
      console.error('Erro ao carregar sistema destino configs:', err);
      alert('Erro ao carregar dados.');
    }
  }

  function renderRows(items: SistemaDestinoConfig[]) {
    const authById = new Map(authConfigs.map((cfg) => [cfg.id, cfg.name]));
    rowsEl.innerHTML = items
      .map(
        (item) => `
      <tr>
        <td>${item.id}</td>
        <td>${item.nome}</td>
        <td>${item.tabela_origem}</td>
        <td>${item.entidade_view}</td>
        <td><small>${item.endpoint_url}</small></td>
        <td>${item.metodo}</td>
        <td>${authById.get(item.conexao_api_id) || item.conexao_api_id}</td>
        <td>${item.ativo ? '✅' : '❌'}</td>
        <td>${item.criado_em ? new Date(item.criado_em).toLocaleString() : '-'}</td>
        <td>
          <div class="actions">
            <button class="btnEdit" data-id="${item.id}">Editar</button>
            <button class="btnDelete" data-id="${item.id}" style="color: #ff4d4f; border-color: rgba(255, 77, 79, 0.3);">Excluir</button>
          </div>
        </td>
      </tr>
    `
      )
      .join('');

    rowsEl.querySelectorAll<HTMLButtonElement>('.btnEdit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number((btn as HTMLElement).dataset.id);
        const item = items.find((entry) => entry.id === id);
        if (item) openModal(item);
      });
    });

    rowsEl.querySelectorAll<HTMLButtonElement>('.btnDelete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number((btn as HTMLElement).dataset.id);
        if (!id) return;
        if (!confirm('Tem certeza que deseja excluir esta configuração?')) return;
        try {
          await deps.api(`/api-integration/sistema-destino-configs/${id}`, { method: 'DELETE' });
          await loadData();
        } catch (err) {
          console.error('Erro ao excluir sistema destino config:', err);
          alert('Erro ao excluir.');
        }
      });
    });
  }

  function openModal(item?: SistemaDestinoConfig) {
    modalTitle.textContent = item ? 'Editar Configuração' : 'Nova Configuração';
    idEl.value = item?.id ? String(item.id) : '';
    nomeEl.value = item?.nome || '';
    tabelaOrigemEl.value = item?.tabela_origem || 'operacoes';
    entidadeViewEl.value = item?.entidade_view || 'vw_operacoes_dispatch';
    endpointUrlEl.value = item?.endpoint_url || '';
    metodoEl.value = (item?.metodo || 'POST').toUpperCase();
    ativoEl.checked = item ? item.ativo : true;
    conexaoApiIdEl.value = item?.conexao_api_id || '';
    modalBackdrop.style.display = 'flex';
  }

  function closeModal() {
    modalBackdrop.style.display = 'none';
  }

  root.querySelector('#btnNew')?.addEventListener('click', () => openModal());
  root.querySelector('#btnReload')?.addEventListener('click', () => void loadData());
  root.querySelector('#btnCloseModal')?.addEventListener('click', closeModal);
  root.querySelector('#btnCancel')?.addEventListener('click', closeModal);

  configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      nome: nomeEl.value.trim(),
      tabela_origem: tabelaOrigemEl.value.trim(),
      entidade_view: entidadeViewEl.value.trim(),
      endpoint_url: endpointUrlEl.value.trim(),
      metodo: metodoEl.value.toUpperCase(),
      ativo: ativoEl.checked,
      conexao_api_id: conexaoApiIdEl.value,
    };

    if (!payload.nome || !payload.tabela_origem || !payload.entidade_view || !payload.endpoint_url || !payload.conexao_api_id) {
      alert('Preencha todos os campos obrigatórios.');
      return;
    }

    try {
      const id = idEl.value;
      if (id) {
        await deps.api(`/api-integration/sistema-destino-configs/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await deps.api('/api-integration/sistema-destino-configs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      closeModal();
      await loadData();
    } catch (err) {
      console.error('Erro ao salvar sistema destino config:', err);
      alert('Erro ao salvar.');
    }
  });

  void loadAuthConfigs().then(() => loadData());
  return root;
}
