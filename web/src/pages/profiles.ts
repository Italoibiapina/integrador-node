export type ProfilesPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type ProfileRow = { role: string; name: string; created_at: string };
type ScreenCatalogItem = { path: string; label: string; group: string };

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback;
  const anyErr = err as any;
  const body = anyErr.body;
  if (typeof body === 'string' && body.trim()) return body;
  const msg = body?.error ?? body?.message ?? anyErr.message;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

export function renderProfilesPage(deps: ProfilesPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Perfis</h1>
    <p class="muted">Cadastro de perfis e definição de quais telas cada perfil pode acessar.</p>

    <div class="grid">
      <div class="card">
        <h2 style="margin: 0 0 10px; font-size: 16px;">Novo perfil</h2>
        <div class="row">
          <label style="flex: 1;">
            Código (role)
            <input id="createRole" placeholder="ex: gerente" />
          </label>
          <label style="flex: 1;">
            Nome
            <input id="createName" placeholder="ex: Gerente" />
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
      <table class="table">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nome</th>
            <th>Criado em</th>
            <th style="width: 240px;">Ações</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>

    <div id="permModal" class="modal-backdrop" style="display:none;">
      <div class="modal api-service-modal">
        <div class="modal-header" style="display:flex; justify-content: space-between; align-items:center;">
          <h2 style="margin: 0; font-size: 16px;">Permissões do perfil</h2>
          <button id="btnClosePermModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>
        <div class="muted" id="permTitle"></div>
        <div class="actions" style="margin: 10px 0;">
          <button id="btnMarkAll">Marcar todas</button>
          <button id="btnClearAll">Limpar</button>
          <button id="btnSavePerms">Salvar</button>
        </div>
        <div class="divider"></div>
        <div id="permList"></div>
      </div>
    </div>
  `;

  const outEl = root.querySelector<HTMLPreElement>('#out')!;
  const rowsEl = root.querySelector<HTMLTableSectionElement>('#rows')!;
  const createRoleEl = root.querySelector<HTMLInputElement>('#createRole')!;
  const createNameEl = root.querySelector<HTMLInputElement>('#createName')!;
  const btnCreate = root.querySelector<HTMLButtonElement>('#btnCreate')!;
  const btnReload = root.querySelector<HTMLButtonElement>('#btnReload')!;

  const permModalEl = root.querySelector<HTMLElement>('#permModal')!;
  const btnClosePermModal = root.querySelector<HTMLButtonElement>('#btnClosePermModal')!;
  const permTitleEl = root.querySelector<HTMLElement>('#permTitle')!;
  const permListEl = root.querySelector<HTMLElement>('#permList')!;
  const btnMarkAll = root.querySelector<HTMLButtonElement>('#btnMarkAll')!;
  const btnClearAll = root.querySelector<HTMLButtonElement>('#btnClearAll')!;
  const btnSavePerms = root.querySelector<HTMLButtonElement>('#btnSavePerms')!;

  let profiles: ProfileRow[] = [];
  let screenCatalog: ScreenCatalogItem[] = [];
  let editingRole: string | null = null;
  let editingScreens = new Set<string>();

  function log(value: unknown) {
    const line = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    outEl.textContent = `${line}\n\n${outEl.textContent}`;
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  function groupCatalog(items: ScreenCatalogItem[]): Array<{ group: string; items: ScreenCatalogItem[] }> {
    const map = new Map<string, ScreenCatalogItem[]>();
    for (const it of items) {
      const list = map.get(it.group) ?? [];
      list.push(it);
      map.set(it.group, list);
    }
    return Array.from(map.entries()).map(([group, groupItems]) => ({
      group,
      items: groupItems.slice().sort((a, b) => a.label.localeCompare(b.label)),
    }));
  }

  function renderProfilesTable() {
    rowsEl.innerHTML = profiles
      .map((p) => {
        return `
          <tr>
            <td>${p.role}</td>
            <td>${p.name}</td>
            <td>${formatDate(p.created_at)}</td>
            <td>
              <div class="actions">
                <button data-action="perms" data-role="${p.role}">Permissões</button>
                <button data-action="edit" data-role="${p.role}">Renomear</button>
                <button data-action="delete" data-role="${p.role}">Excluir</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function openPermModal(role: string, name: string) {
    editingRole = role;
    editingScreens = new Set<string>();
    permTitleEl.textContent = `${name} (${role})`;
    permListEl.innerHTML = '';
    permModalEl.style.display = '';
  }

  function closePermModal() {
    editingRole = null;
    editingScreens = new Set<string>();
    permModalEl.style.display = 'none';
  }

  function renderPerms() {
    const grouped = groupCatalog(screenCatalog);
    permListEl.innerHTML = grouped
      .map((g) => {
        const rows = g.items
          .map((it) => {
            const checked = editingScreens.has(it.path) ? 'checked' : '';
            return `
              <label style="display:flex; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.08);">
                <input type="checkbox" data-screen="${it.path}" ${checked} />
                <div>
                  <div style="font-weight: 600; font-size: 13px;">${it.label}</div>
                  <div class="muted" style="margin: 0; font-size: 12px;">${it.path}</div>
                </div>
              </label>
            `;
          })
          .join('');
        return `
          <div class="card" style="margin-bottom: 12px;">
            <div class="nav-group-title" style="padding: 0; margin: 0 0 8px;">${g.group}</div>
            ${rows}
          </div>
        `;
      })
      .join('');
  }

  async function reload() {
    try {
      const [profilesRes, screensRes] = await Promise.all([
        deps.api<ProfileRow[]>('/profiles', { method: 'GET' }),
        deps.api<ScreenCatalogItem[]>('/admin/screens', { method: 'GET' }),
      ]);
      profiles = profilesRes;
      screenCatalog = screensRes;
      renderProfilesTable();
    } catch (e) {
      log({ ok: false, error: e });
    }
  }

  btnReload.addEventListener('click', () => {
    void reload();
  });

  btnCreate.addEventListener('click', async () => {
    try {
      const role = createRoleEl.value;
      const name = createNameEl.value;
      const body = await deps.api<ProfileRow>('/profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role, name }),
      });
      log({ ok: true, created: body });
      createRoleEl.value = '';
      createNameEl.value = '';
      await reload();
    } catch (e) {
      log({ ok: false, error: getApiErrorMessage(e, 'Falha ao criar perfil') });
    }
  });

  rowsEl.addEventListener('click', async (ev) => {
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest('button[data-action]') as HTMLButtonElement | null;
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const role = btn.getAttribute('data-role') ?? '';
    const profile = profiles.find((p) => p.role === role);
    if (!profile) return;

    if (action === 'delete') {
      const ok = confirm(`Excluir perfil ${profile.name} (${profile.role})?`);
      if (!ok) return;
      try {
        const body = await deps.api('/profiles/' + encodeURIComponent(profile.role), { method: 'DELETE' });
        log({ ok: true, deleted: body });
        await reload();
      } catch (e) {
        log({ ok: false, error: getApiErrorMessage(e, 'Falha ao excluir perfil') });
      }
      return;
    }

    if (action === 'edit') {
      const newName = prompt('Novo nome do perfil:', profile.name);
      if (!newName) return;
      try {
        const body = await deps.api<ProfileRow>('/profiles/' + encodeURIComponent(profile.role), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        });
        log({ ok: true, updated: body });
        await reload();
      } catch (e) {
        log({ ok: false, error: getApiErrorMessage(e, 'Falha ao renomear perfil') });
      }
      return;
    }

    if (action === 'perms') {
      openPermModal(profile.role, profile.name);
      try {
        const allowed = await deps.api<string[]>('/profiles/' + encodeURIComponent(profile.role) + '/screens', {
          method: 'GET',
        });
        editingScreens = new Set(allowed);
        renderPerms();
      } catch (e) {
        log({ ok: false, error: getApiErrorMessage(e, 'Falha ao carregar permissões') });
      }
    }
  });

  btnClosePermModal.addEventListener('click', () => {
    closePermModal();
  });

  permModalEl.addEventListener('click', (ev) => {
    if (ev.target === permModalEl) closePermModal();
  });

  permListEl.addEventListener('change', (ev) => {
    const target = ev.target as HTMLElement | null;
    const cb = target?.closest('input[type="checkbox"][data-screen]') as HTMLInputElement | null;
    if (!cb) return;
    const screen = cb.getAttribute('data-screen') ?? '';
    if (cb.checked) editingScreens.add(screen);
    else editingScreens.delete(screen);
  });

  btnMarkAll.addEventListener('click', () => {
    editingScreens = new Set(screenCatalog.map((s) => s.path));
    renderPerms();
  });

  btnClearAll.addEventListener('click', () => {
    editingScreens = new Set<string>();
    renderPerms();
  });

  btnSavePerms.addEventListener('click', async () => {
    if (!editingRole) return;
    try {
      const screens = Array.from(editingScreens.values());
      const body = await deps.api('/profiles/' + encodeURIComponent(editingRole) + '/screens', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ screens }),
      });
      log({ ok: true, saved: body });
      closePermModal();
    } catch (e) {
      log({ ok: false, error: getApiErrorMessage(e, 'Falha ao salvar permissões') });
    }
  });

  void reload();

  return root;
}
