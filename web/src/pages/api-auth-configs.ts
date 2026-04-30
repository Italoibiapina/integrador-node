import { ApiAuthConfig } from '../../../api/src/services/apiIntegrationTypes';

export type ApiAuthConfigsPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

export function renderApiAuthConfigsPage(deps: ApiAuthConfigsPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Api Auth Config</h1>
    <p class="muted">Gerencie as configurações de autenticação para os serviços de API.</p>

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
            <th>Nome</th>
            <th>Tipo</th>
            <th>URL de Login</th>
            <th>Usuário</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>

    <!-- Modal CRUD -->
    <div id="modalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal">
        <div class="modal-header">
          <h2 id="modalTitle" style="margin: 0; font-size: 16px;">Configuração de Autenticação</h2>
          <button id="btnCloseModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>
        
        <form id="authForm">
          <input type="hidden" id="authId" />
          <div class="row">
            <label>
              Nome
              <input id="name" required placeholder="Ex: PowerStock Login" />
            </label>
            <label>
              Tipo de Auth
              <select id="authType">
                <option value="bearer">Bearer Token (Login API)</option>
              </select>
            </label>
          </div>

          <div class="row" style="margin-top: 10px;">
            <label>
              URL de Login
              <input id="loginUrl" required placeholder="https://api.exemplo.com/api/login" />
            </label>
          </div>

          <div class="row" style="margin-top: 10px;">
            <label>
              Usuário / E-mail
              <input id="username" required />
            </label>
            <label>
              Senha
              <input id="password" type="password" placeholder="••••••••" />
            </label>
          </div>

          <div style="margin-top: 10px;">
            <label>
              Payload de Login (JSON Opcional)
              <textarea id="loginPayload" placeholder='{ "extra_field": "value" }'></textarea>
            </label>
          </div>

          <div style="margin-top: 10px;">
            <label>
              Headers Adicionais (JSON Opcional)
              <textarea id="headers" placeholder='{ "Http_referer_multiempresa": "..." }'></textarea>
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
  const authForm = root.querySelector<HTMLFormElement>('#authForm')!;
  const modalTitle = root.querySelector<HTMLElement>('#modalTitle')!;
  
  // Form fields
  const idEl = root.querySelector<HTMLInputElement>('#authId')!;
  const nameEl = root.querySelector<HTMLInputElement>('#name')!;
  const authTypeEl = root.querySelector<HTMLSelectElement>('#authType')!;
  const loginUrlEl = root.querySelector<HTMLInputElement>('#loginUrl')!;
  const usernameEl = root.querySelector<HTMLInputElement>('#username')!;
  const passwordEl = root.querySelector<HTMLInputElement>('#password')!;
  const loginPayloadEl = root.querySelector<HTMLTextAreaElement>('#loginPayload')!;
  const headersEl = root.querySelector<HTMLTextAreaElement>('#headers')!;

  async function loadData() {
    try {
      const data = await deps.api<ApiAuthConfig[]>('/api-integration/auth-configs');
      renderRows(data);
    } catch (err) {
      console.error('Erro ao carregar auth configs:', err);
      alert('Erro ao carregar dados.');
    }
  }

  function renderRows(items: ApiAuthConfig[]) {
    rowsEl.innerHTML = items.map(item => `
      <tr>
        <td>${item.name}</td>
        <td>${item.auth_type || 'bearer'}</td>
        <td><small>${item.base_url || ''}</small></td>
        <td>${item.username}</td>
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
        if (confirm('Tem certeza que deseja excluir esta configuração?')) {
          try {
            await deps.api(`/api-integration/auth-configs/${id}`, { method: 'DELETE' });
            void loadData();
          } catch (err) {
            alert('Erro ao excluir.');
          }
        }
      });
    });
  }

  function openModal(item?: ApiAuthConfig) {
    modalTitle.textContent = item ? 'Editar Configuração' : 'Nova Configuração';
    idEl.value = item?.id || '';
    nameEl.value = item?.name || '';
    authTypeEl.value = item?.auth_type || 'bearer';
    loginUrlEl.value = item?.base_url || '';
    usernameEl.value = item?.username || '';
    passwordEl.value = ''; // Password always empty for security, only send if changed
    loginPayloadEl.value = '';
    headersEl.value = item?.extra_headers ? JSON.stringify(item.extra_headers, null, 2) : '';
    
    modalBackdrop.style.display = 'flex';
  }

  function closeModal() {
    modalBackdrop.style.display = 'none';
  }

  root.querySelector('#btnNew')?.addEventListener('click', () => openModal());
  root.querySelector('#btnReload')?.addEventListener('click', () => loadData());
  root.querySelector('#btnCloseModal')?.addEventListener('click', closeModal);
  root.querySelector('#btnCancel')?.addEventListener('click', closeModal);

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const payload: any = {
      name: nameEl.value,
      auth_type: authTypeEl.value,
      base_url: loginUrlEl.value,
      username: usernameEl.value,
    };

    if (passwordEl.value) {
      payload.password = passwordEl.value;
    }

    try {
      if (headersEl.value.trim()) payload.extra_headers = JSON.parse(headersEl.value);
    } catch (err) {
      alert('JSON inválido no campo de Headers.');
      return;
    }

    try {
      const id = idEl.value;
      if (id) {
        await deps.api(`/api-integration/auth-configs/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await deps.api('/api-integration/auth-configs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      closeModal();
      void loadData();
    } catch (err) {
      alert('Erro ao salvar.');
    }
  });

  void loadData();
  return root;
}
