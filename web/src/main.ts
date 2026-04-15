import './style.css';

import { renderDashboardPage } from './pages/dashboard';
import { renderExecutionsPage } from './pages/executions';
import { renderLoginPage } from './pages/login';
import { renderManualRunPage } from './pages/manual-run';
import { renderNotifiersPage } from './pages/notifiers';
import { renderConnectionsPage } from './pages/connections';
import { renderSchedulesPage } from './pages/schedules';
import { renderIntegrationsPage } from './pages/integrations';
import { renderCustomConnectionsPage } from './pages/custom-connections';

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3005';

type JwtUser = { userId: string; email: string; role: string };

function parseHash(): { path: string; query: URLSearchParams } {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const cleaned = raw.startsWith('/') ? raw : '/dashboard';
  const [path, qs] = cleaned.split('?', 2);
  return { path: path || '/dashboard', query: new URLSearchParams(qs ?? '') };
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

app.innerHTML = `
  <div class="app">
    <aside>
      <div class="brand">CANP Integração</div>
      <div class="pill">API: <strong id="apiBase"></strong></div>
      <div class="pill" style="margin-top: 8px;">Auth: <strong id="authStatus">desconhecido</strong></div>
      <div class="divider"></div>
      <nav id="nav">
        <a href="#/dashboard" data-path="/dashboard">Dashboard</a>
        <a href="#/integrations" data-path="/integrations">Integrações</a>
        <a href="#/schedules" data-path="/schedules">Agendamentos</a>
        <a href="#/manual-run" data-path="/manual-run">Disparo Manual</a>
        <a href="#/executions" data-path="/executions">Execuções</a>
        <a href="#/connections" data-path="/connections">Conexões</a>
        <a href="#/custom-connections" data-path="/custom-connections">Conexões Customizadas</a>
        <a href="#/notifiers" data-path="/notifiers">Notificadores</a>
      </nav>
      <div class="footer">
        <button id="btnLogout">Sair</button>
      </div>
    </aside>
    <main>
      <div id="view"></div>
    </main>
  </div>
`;

const apiBaseEl = document.querySelector<HTMLElement>('#apiBase')!;
const authStatusEl = document.querySelector<HTMLElement>('#authStatus')!;
const viewEl = document.querySelector<HTMLDivElement>('#view')!;
const navEl = document.querySelector<HTMLElement>('#nav')!;
apiBaseEl.textContent = apiBase;

function setAuthStatus(value: string) {
  authStatusEl.textContent = value;
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw { status: res.status, body };
  return body as T;
}

async function me(): Promise<JwtUser | null> {
  try {
    const u = await api<JwtUser>('/auth/me', { method: 'GET' });
    setAuthStatus('logado');
    return u;
  } catch {
    setAuthStatus('deslogado');
    return null;
  }
}

function navigate(path: string) {
  location.hash = `#${path}`;
}

function setActiveNav(path: string) {
  for (const a of Array.from(navEl.querySelectorAll<HTMLAnchorElement>('a[data-path]'))) {
    a.classList.toggle('active', a.getAttribute('data-path') === path);
  }
}

document.querySelector<HTMLButtonElement>('#btnLogout')?.addEventListener('click', async () => {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    setAuthStatus('deslogado');
    navigate('/login');
  }
});

async function render() {
  const { path, query } = parseHash();
  setActiveNav(path);

  const user = await me();
  if (!user && path !== '/login') {
    navigate('/login');
    return;
  }

  viewEl.innerHTML = '';

  if (path === '/login') {
    viewEl.appendChild(
      renderLoginPage({
        api,
        setAuthStatus,
        navigate,
      })
    );
    return;
  }

  if (path === '/dashboard') {
    viewEl.appendChild(renderDashboardPage({ api, navigate }));
    return;
  }

  if (path === '/schedules') {
    viewEl.appendChild(renderSchedulesPage({ api }, { id: query.get('id') }));
    return;
  }

  if (path === '/integrations') {
    viewEl.appendChild(renderIntegrationsPage({ api }, { id: query.get('id') }));
    return;
  }

  if (path === '/manual-run') {
    viewEl.appendChild(renderManualRunPage({ api }));
    return;
  }

  if (path === '/executions') {
    viewEl.appendChild(renderExecutionsPage({ api }, { id: query.get('id') }));
    return;
  }

  if (path === '/connections') {
    viewEl.appendChild(renderConnectionsPage({ api }));
    return;
  }

  if (path === '/custom-connections') {
    viewEl.appendChild(renderCustomConnectionsPage({ api }));
    return;
  }

  if (path === '/notifiers') {
    viewEl.appendChild(renderNotifiersPage({ api }));
    return;
  }

  navigate('/dashboard');
}

window.addEventListener('hashchange', () => {
  void render();
});

void render();
