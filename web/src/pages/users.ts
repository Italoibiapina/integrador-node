export type UsersPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type ProfileRow = { role: string; name: string };
type UserRow = { id: string; email: string; role: string; created_at: string; role_name: string | null };

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback;
  const anyErr = err as any;
  const body = anyErr.body;
  if (typeof body === 'string' && body.trim()) return body;
  const msg = body?.error ?? body?.message ?? anyErr.message;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

export function renderUsersPage(deps: UsersPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Usuários</h1>
    <p class="muted">Cadastro de usuários e atribuição de perfil.</p>

    <div class="grid">
      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Novo usuário</h2>
        <div class="row">
          <label style="flex: 1;">
            Email
            <input id="createEmail" placeholder="usuario@local" />
          </label>
          <label style="flex: 1;">
            Senha
            <input id="createPassword" type="password" placeholder="mínimo 6" />
          </label>
          <label style="flex: 1;">
            Perfil
            <select id="createRole"></select>
          </label>
        </div>
        <div class="actions" style="margin-top: 10px;">
          <button id="btnCreate">Criar</button>
          <button id="btnReload">Atualizar</button>
        </div>
      </div>

      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Saída</h2>
        <pre id="out" style="height: 180px; overflow: auto;"></pre>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <div class="actions" style="justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h2 style="margin: 0; font-size: 16px;">Lista de usuários</h2>
        <div class="muted" id="count"></div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Perfil</th>
            <th>Criado em</th>
            <th style="width: 170px;">Ações</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>

    <div id="editModal" class="modal-backdrop" style="display:none;">
      <div class="modal">
        <div class="modal-header" style="display:flex; justify-content: space-between; align-items:center;">
          <h2 style="margin: 0; font-size: 16px;">Editar usuário</h2>
          <button id="btnCloseEditModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>
        <div class="row">
          <label style="flex: 1;">
            Email
            <input id="editEmail" />
          </label>
          <label style="flex: 1;">
            Nova senha (opcional)
            <input id="editPassword" type="password" placeholder="deixe em branco para manter" />
          </label>
          <label style="flex: 1;">
            Perfil
            <select id="editRole"></select>
          </label>
        </div>
        <div class="actions" style="margin-top: 10px;">
          <button id="btnSave">Salvar</button>
        </div>
      </div>
    </div>
  `;

  const outEl = root.querySelector<HTMLPreElement>('#out')!;
  const rowsEl = root.querySelector<HTMLTableSectionElement>('#rows')!;
  const countEl = root.querySelector<HTMLElement>('#count')!;

  const createEmailEl = root.querySelector<HTMLInputElement>('#createEmail')!;
  const createPasswordEl = root.querySelector<HTMLInputElement>('#createPassword')!;
  const createRoleEl = root.querySelector<HTMLSelectElement>('#createRole')!;
  const btnCreate = root.querySelector<HTMLButtonElement>('#btnCreate')!;
  const btnReload = root.querySelector<HTMLButtonElement>('#btnReload')!;

  const editModalEl = root.querySelector<HTMLElement>('#editModal')!;
  const btnCloseEditModal = root.querySelector<HTMLButtonElement>('#btnCloseEditModal')!;
  const editEmailEl = root.querySelector<HTMLInputElement>('#editEmail')!;
  const editPasswordEl = root.querySelector<HTMLInputElement>('#editPassword')!;
  const editRoleEl = root.querySelector<HTMLSelectElement>('#editRole')!;
  const btnSave = root.querySelector<HTMLButtonElement>('#btnSave')!;

  let profiles: ProfileRow[] = [];
  let users: UserRow[] = [];
  let editingUserId: string | null = null;

  function log(value: unknown) {
    const line = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    outEl.textContent = `${line}\n\n${outEl.textContent}`;
  }

  function setProfilesOptions(select: HTMLSelectElement, selectedRole?: string) {
    select.innerHTML = profiles
      .map((p) => {
        const selected = selectedRole === p.role ? 'selected' : '';
        return `<option value="${p.role}" ${selected}>${p.name} (${p.role})</option>`;
      })
      .join('');
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  function openEditModal(user: UserRow) {
    editingUserId = user.id;
    editEmailEl.value = user.email;
    editPasswordEl.value = '';
    setProfilesOptions(editRoleEl, user.role);
    editModalEl.style.display = '';
  }

  function closeEditModal() {
    editingUserId = null;
    editModalEl.style.display = 'none';
  }

  function renderTable() {
    countEl.textContent = `${users.length} usuário(s)`;
    rowsEl.innerHTML = users
      .map((u) => {
        const profileLabel = u.role_name ? `${u.role_name} (${u.role})` : u.role;
        return `
          <tr>
            <td>${u.email}</td>
            <td>${profileLabel}</td>
            <td>${formatDate(u.created_at)}</td>
            <td>
              <div class="actions">
                <button data-action="edit" data-id="${u.id}">Editar</button>
                <button data-action="delete" data-id="${u.id}">Excluir</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  async function reload() {
    try {
      const [profilesRes, usersRes] = await Promise.all([
        deps.api<ProfileRow[]>('/profiles', { method: 'GET' }),
        deps.api<UserRow[]>('/users', { method: 'GET' }),
      ]);
      profiles = profilesRes;
      users = usersRes;
      setProfilesOptions(createRoleEl);
      renderTable();
    } catch (e) {
      log({ ok: false, error: e });
    }
  }

  btnReload.addEventListener('click', () => {
    void reload();
  });

  btnCreate.addEventListener('click', async () => {
    try {
      const email = createEmailEl.value.trim();
      const password = createPasswordEl.value;
      const role = createRoleEl.value;
      const body = await deps.api<UserRow>('/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, role }),
      });
      log({ ok: true, created: body });
      createPasswordEl.value = '';
      await reload();
    } catch (e) {
      log({ ok: false, error: getApiErrorMessage(e, 'Falha ao criar usuário') });
    }
  });

  rowsEl.addEventListener('click', async (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest('button[data-action]') as HTMLButtonElement | null;
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id') ?? '';
    const user = users.find((u) => u.id === id);
    if (!user) return;

    if (action === 'edit') {
      openEditModal(user);
      return;
    }

    if (action === 'delete') {
      const ok = confirm(`Excluir usuário ${user.email}?`);
      if (!ok) return;
      try {
        const body = await deps.api('/users/' + encodeURIComponent(user.id), { method: 'DELETE' });
        log({ ok: true, deleted: body });
        await reload();
      } catch (e) {
        log({ ok: false, error: getApiErrorMessage(e, 'Falha ao excluir usuário') });
      }
    }
  });

  btnCloseEditModal.addEventListener('click', () => {
    closeEditModal();
  });

  editModalEl.addEventListener('click', (ev) => {
    if (ev.target === editModalEl) closeEditModal();
  });

  btnSave.addEventListener('click', async () => {
    if (!editingUserId) return;
    try {
      const email = editEmailEl.value.trim();
      const password = editPasswordEl.value;
      const role = editRoleEl.value;
      const payload: { email: string; role: string; password?: string } = { email, role };
      if (password) payload.password = password;

      const body = await deps.api<UserRow>('/users/' + encodeURIComponent(editingUserId), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      log({ ok: true, updated: body });
      closeEditModal();
      await reload();
    } catch (e) {
      log({ ok: false, error: getApiErrorMessage(e, 'Falha ao salvar usuário') });
    }
  });

  void reload();

  return root;
}
