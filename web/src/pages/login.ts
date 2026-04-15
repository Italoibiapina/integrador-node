export type LoginPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
  setAuthStatus: (value: string) => void;
  navigate: (path: string) => void;
};

export function renderLoginPage(deps: LoginPageDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Login</h1>
    <p class="muted">Acesso às telas administrativas.</p>

    <div class="card">
      <div class="row">
        <label>
          Email
          <input id="email" placeholder="admin@local" />
        </label>
        <label>
          Senha
          <input id="password" type="password" placeholder="change-me" />
        </label>
      </div>
      <div class="row" style="margin-top: 10px;">
        <button id="btnLogin">Entrar</button>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <h2 style="margin: 0 0 10px; font-size: 16px;">Saída</h2>
      <pre id="out"></pre>
    </div>
  `;

  const out = root.querySelector<HTMLPreElement>('#out')!;
  const emailEl = root.querySelector<HTMLInputElement>('#email')!;
  const passwordEl = root.querySelector<HTMLInputElement>('#password')!;
  const btnLogin = root.querySelector<HTMLButtonElement>('#btnLogin')!;

  function log(value: unknown) {
    const line = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    out.textContent = `${line}\n\n${out.textContent}`;
  }

  btnLogin.addEventListener('click', async () => {
    try {
      const body = await deps.api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: emailEl.value, password: passwordEl.value }),
      });
      deps.setAuthStatus('logado');
      log({ ok: true, login: body });
      deps.navigate('/dashboard');
    } catch (e) {
      deps.setAuthStatus('deslogado');
      log({ ok: false, error: e });
    }
  });

  return root;
}
