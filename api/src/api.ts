import { randomUUID } from 'node:crypto';

import cookie from '@fastify/cookie';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

import { signJwt, verifyJwt, verifyPassword, type JwtUser } from './auth.js';
import { startBoss } from './boss.js';
import { advisoryLockKey, createDb } from './db.js';
import { env } from './env.js';
import { runMigrations } from './migrate.js';
import { queueNames, type ExecutionStatus, type ExecutionTrigger, type QueueName } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtUser;
  }
}

type UserRow = { id: string; email: string; password_hash: string; role: 'admin' | 'operator' };
type ConnectionRow = {
  id: string;
  name: string;
  type: 'api' | 'db' | 'custom';
  config: unknown;
  created_at: string;
  updated_at: string;
};
type IntegrationRow = {
  id: string;
  name: string;
  source_connection_id: string | null;
  destination_connection_id: string | null;
  settings: unknown;
  created_at: string;
  updated_at: string;
};
type ScheduleRow = {
  id: string;
  integration_id: string;
  job_type: string;
  cron: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};
type NotifierConfigRow = {
  id: string;
  integration_id: string;
  source_job_type: string;
  source_status: string;
  action_job_type: string;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};
type ExecutionRow = {
  id: string;
  integration_id: string;
  job_type: string;
  status: ExecutionStatus;
  trigger: ExecutionTrigger;
  requested_by: string | null;
  correlation_id: string;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: unknown | null;
  metrics: unknown;
};

await runMigrations(env.databaseUrl);

const db = createDb(env.databaseUrl);
const boss = await startBoss(env.databaseUrl, [
  queueNames.step1CaptureOrders,
  queueNames.step2SendOrders,
  queueNames.notifierDispatch,
]);

const app = Fastify({ logger: true });

await app.register(cookie);

function isAllowedCorsOrigin(origin: string): boolean {
  if (
    env.nodeEnv === 'development' &&
    (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))
  ) {
    return true;
  }
  if (!env.corsOrigin) return true;
  const allowed = env.corsOrigin
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

app.addHook('onRequest', async (request, reply) => {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !origin) return;
  if (!isAllowedCorsOrigin(origin)) return;

  reply.header('access-control-allow-origin', origin);
  reply.header('access-control-allow-credentials', 'true');
  reply.header('vary', 'Origin');
});

app.options('*', async (request, reply) => {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin && isAllowedCorsOrigin(origin)) {
    reply.header('access-control-allow-origin', origin);
    reply.header('access-control-allow-credentials', 'true');
    reply.header('vary', 'Origin');
  }

  const reqHeaders = request.headers['access-control-request-headers'];
  reply.header(
    'access-control-allow-headers',
    typeof reqHeaders === 'string' && reqHeaders ? reqHeaders : 'content-type, authorization'
  );
  reply.header('access-control-allow-methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
  reply.header('access-control-max-age', '86400');
  reply.code(204).send();
});

function setAuthCookie(reply: FastifyReply, token: string) {
  reply.setCookie(env.authCookieName, token, {
    httpOnly: true,
    secure: env.authCookieSecure,
    sameSite: 'lax',
    path: '/',
  });
}

function clearAuthCookie(reply: FastifyReply) {
  reply.clearCookie(env.authCookieName, { path: '/' });
}

async function authRequired(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[env.authCookieName];
  if (!token) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    request.user = verifyJwt(token, env.jwtSecret);
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

app.get('/health', async () => ({ ok: true }));

app.get('/@vite/client', async (_request, reply) => {
  reply.type('application/javascript; charset=utf-8').send('');
});

app.get('/@vite/env', async (_request, reply) => {
  reply.type('application/javascript; charset=utf-8').send('');
});

app.get('/', async (_request, reply) => {
  reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="pt-br">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CANP Integração</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; }
      .row { display: flex; gap: 12px; flex-wrap: wrap; }
      .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; max-width: 980px; }
      input, textarea, select, button { font: inherit; }
      textarea { width: 100%; min-height: 120px; }
      button { padding: 8px 12px; cursor: pointer; }
      code { background: #f6f6f6; padding: 2px 6px; border-radius: 6px; }
      pre { background: #0b1020; color: #d6e0ff; padding: 12px; border-radius: 8px; overflow: auto; }
      .muted { color: #555; }
    </style>
  </head>
  <body>
    <h1>CANP Integração</h1>
    <p class="muted">Tela simples para testar a API (login, conexões, integrações e jobs).</p>

    <div class="row">
      <div class="card" style="flex: 1 1 360px;">
        <h2>Login</h2>
        <div class="row">
          <label style="flex: 1 1 220px;">
            Email<br />
            <input id="email" style="width: 100%;" placeholder="admin@local" />
          </label>
          <label style="flex: 1 1 220px;">
            Senha<br />
            <input id="password" style="width: 100%;" type="password" placeholder="change-me" />
          </label>
        </div>
        <div class="row" style="margin-top: 10px;">
          <button id="btnLogin">Entrar</button>
          <button id="btnLogout">Sair</button>
        </div>
      </div>

      <div class="card" style="flex: 1 1 360px;">
        <h2>Ações rápidas</h2>
        <div class="row">
          <button id="btnListConnections">Listar conexões</button>
          <button id="btnListIntegrations">Listar integrações</button>
          <button id="btnListExecutions">Últimas execuções</button>
        </div>
        <div class="row" style="margin-top: 10px;">
          <button id="btnRunStep1">Rodar Step1</button>
          <button id="btnRunStep2">Rodar Step2</button>
        </div>
        <div style="margin-top: 10px;">
          <label>
            Integration ID (para rodar Step1/Step2)<br />
            <input id="integrationId" style="width: 100%;" placeholder="cole o id aqui" />
          </label>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <h2>Criar conexão (JSON)</h2>
      <p class="muted">Endpoint: <code>POST /connections</code></p>
      <textarea id="connJson">{\n  "name": "demo-source",\n  "type": "api",\n  "config": {\n    "baseUrl": "https://jsonplaceholder.typicode.com",\n    "endpoint": "/todos",\n    "method": "GET",\n    "paginationType": "none",\n    "responseItemsPath": "",\n    "sourceOrderIdPath": "id"\n  }\n}</textarea>
      <div class="row" style="margin-top: 10px;">
        <button id="btnCreateConn">Criar conexão</button>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <h2>Criar integração (JSON)</h2>
      <p class="muted">Endpoint: <code>POST /integrations</code></p>
      <textarea id="integJson">{\n  "name": "demo-integration",\n  "sourceConnectionId": "",\n  "destinationConnectionId": "",\n  "settings": { "sourceSystem": "demo" }\n}</textarea>
      <div class="row" style="margin-top: 10px;">
        <button id="btnCreateIntegration">Criar integração</button>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <h2>Saída</h2>
      <pre id="out"></pre>
    </div>

    <script>
      const out = document.getElementById('out');
      const emailEl = document.getElementById('email');
      const passwordEl = document.getElementById('password');
      const integrationIdEl = document.getElementById('integrationId');
      const connJsonEl = document.getElementById('connJson');
      const integJsonEl = document.getElementById('integJson');

      function log(value) {
        const line = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        out.textContent = line + "\\n" + out.textContent;
      }

      async function api(path, init) {
        const res = await fetch(path, { credentials: 'include', ...init });
        const text = await res.text();
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        if (!res.ok) {
          throw { status: res.status, body };
        }
        return body;
      }

      document.getElementById('btnLogin').addEventListener('click', async () => {
        try {
          const body = await api('/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: emailEl.value, password: passwordEl.value })
          });
          log({ ok: true, login: body });
        } catch (e) {
          log({ ok: false, error: e });
        }
      });

      document.getElementById('btnLogout').addEventListener('click', async () => {
        try {
          const body = await api('/auth/logout', { method: 'POST' });
          log({ ok: true, logout: body });
        } catch (e) {
          log({ ok: false, error: e });
        }
      });

      document.getElementById('btnCreateConn').addEventListener('click', async () => {
        try {
          const parsed = JSON.parse(connJsonEl.value);
          const body = await api('/connections', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(parsed)
          });
          log({ ok: true, connection: body });
        } catch (e) {
          log({ ok: false, error: e });
        }
      });

      document.getElementById('btnCreateIntegration').addEventListener('click', async () => {
        try {
          const parsed = JSON.parse(integJsonEl.value);
          const body = await api('/integrations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(parsed)
          });
          log({ ok: true, integration: body });
        } catch (e) {
          log({ ok: false, error: e });
        }
      });

      document.getElementById('btnListConnections').addEventListener('click', async () => {
        try {
          const body = await api('/connections', { method: 'GET' });
          log({ ok: true, connections: body });
        } catch (e) {
          log({ ok: false, error: e });
        }
      });

      document.getElementById('btnListIntegrations').addEventListener('click', async () => {
        try {
          const body = await api('/integrations', { method: 'GET' });
          log({ ok: true, integrations: body });
        } catch (e) {
          log({ ok: false, error: e });
        }
      });

      document.getElementById('btnListExecutions').addEventListener('click', async () => {
        try {
          const body = await api('/executions?limit=20', { method: 'GET' });
          log({ ok: true, executions: body });
        } catch (e) {
          log({ ok: false, error: e });
        }
      });

      document.getElementById('btnRunStep1').addEventListener('click', async () => {
        try {
          const integrationId = integrationIdEl.value.trim();
          const body = await api('/jobs/step1/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ integrationId })
          });
          log({ ok: true, step1: body });
        } catch (e) {
          log({ ok: false, error: e });
        }
      });

      document.getElementById('btnRunStep2').addEventListener('click', async () => {
        try {
          const integrationId = integrationIdEl.value.trim();
          const body = await api('/jobs/step2/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ integrationId })
          });
          log({ ok: true, step2: body });
        } catch (e) {
          log({ ok: false, error: e });
        }
      });
    </script>
  </body>
</html>`);
});

app.post('/auth/login', async (request, reply) => {
  const body = request.body as { email?: string; password?: string } | undefined;
  const email = body?.email?.trim();
  const password = body?.password;

  if (!email || !password) {
    reply.code(400).send({ error: 'email and password are required' });
    return;
  }

  const result = await db.query<UserRow>('select id, email, password_hash, role from users where email = $1', [email]);
  const user = result.rows[0];
  if (!user) {
    reply.code(401).send({ error: 'Invalid credentials' });
    return;
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    reply.code(401).send({ error: 'Invalid credentials' });
    return;
  }

  const token = signJwt({ userId: user.id, email: user.email, role: user.role }, env.jwtSecret);
  setAuthCookie(reply, token);
  reply.send({ id: user.id, email: user.email, role: user.role });
});

app.post('/auth/logout', async (_request, reply) => {
  clearAuthCookie(reply);
  reply.send({ ok: true });
});

app.get('/auth/me', { preHandler: authRequired }, async (request) => {
  return request.user;
});

app.get('/connections', { preHandler: authRequired }, async () => {
  const result = await db.query<ConnectionRow>('select * from connections order by created_at desc');
  return result.rows;
});

app.post('/connections', { preHandler: authRequired }, async (request, reply) => {
  const body = request.body as { name?: string; type?: 'api' | 'db' | 'custom'; config?: unknown } | undefined;
  const name = body?.name?.trim();
  const type = body?.type;
  const config = body?.config ?? {};

  if (!name || (type !== 'api' && type !== 'db' && type !== 'custom')) {
    reply.code(400).send({ error: 'name and valid type are required' });
    return;
  }

  const result = await db.query<ConnectionRow>(
    `insert into connections (name, type, config)
     values ($1, $2, $3::jsonb)
     returning *`,
    [name, type, JSON.stringify(config)]
  );
  reply.code(201).send(result.rows[0]);
});

app.put('/connections/:id', { preHandler: authRequired }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { name?: string; config?: unknown } | undefined;
  const name = body?.name?.trim();
  const config = body?.config ?? {};

  if (!name) {
    reply.code(400).send({ error: 'name is required' });
    return;
  }

  const result = await db.query<ConnectionRow>(
    `update connections
     set name = $2, config = $3::jsonb, updated_at = now()
     where id = $1
     returning *`,
    [id, name, JSON.stringify(config)]
  );
  const updated = result.rows[0];
  if (!updated) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  reply.send(updated);
});

app.delete('/connections/:id', { preHandler: authRequired }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = await db.query<{ id: string }>('delete from connections where id = $1 returning id', [id]);
  if (!result.rows[0]) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  reply.send({ ok: true });
});

app.post('/connections/:id/test', { preHandler: authRequired }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = await db.query<ConnectionRow>('select * from connections where id = $1', [id]);
  const conn = result.rows[0];
  if (!conn) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }

  if (conn.type === 'db') {
    const config = (conn.config ?? {}) as Record<string, unknown>;
    const connectionString = config.connectionString;
    if (typeof connectionString !== 'string' || !connectionString) {
      reply.code(400).send({ error: 'DB connection requires config.connectionString' });
      return;
    }
    const testDb = createDb(connectionString);
    try {
      await testDb.query('select 1 as ok');
      reply.send({ ok: true });
    } finally {
      await testDb.end();
    }
    return;
  }

  if (conn.type === 'custom') {
    const config = (conn.config ?? {}) as Record<string, unknown>;
    const kind = config.kind;
    if (kind !== 'ordersWebscrape' && kind !== 'powerStock') {
      reply.code(400).send({ error: 'Unsupported custom connection kind' });
      return;
    }

    const baseUrl = config.baseUrl;
    const ordersUrl = config.ordersUrl;
    if (typeof baseUrl !== 'string' || !baseUrl || typeof ordersUrl !== 'string' || !ordersUrl) {
      reply.code(400).send({ error: 'Custom connection requires config.baseUrl and config.ordersUrl' });
      return;
    }

    const target = ordersUrl.startsWith('http://') || ordersUrl.startsWith('https://') ? ordersUrl : new URL(ordersUrl, baseUrl).toString();
    const response = await fetch(target, { signal: AbortSignal.timeout(5000) }).catch((e) => e as Error);
    if (response instanceof Error) {
      reply.code(400).send({ ok: false, error: response.message });
      return;
    }

    reply.send({ ok: response.ok, status: response.status });
    return;
  }

  const config = (conn.config ?? {}) as Record<string, unknown>;
  const baseUrl = config.baseUrl;
  if (typeof baseUrl !== 'string' || !baseUrl) {
    reply.code(400).send({ error: 'API connection requires config.baseUrl' });
    return;
  }

  const response = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) }).catch((e) => e as Error);
  if (response instanceof Error) {
    reply.code(400).send({ ok: false, error: response.message });
    return;
  }

  reply.send({ ok: response.ok, status: response.status });
});

app.get('/integrations', { preHandler: authRequired }, async () => {
  const result = await db.query<IntegrationRow>('select * from integrations order by created_at desc');
  return result.rows;
});

app.post('/integrations', { preHandler: authRequired }, async (request, reply) => {
  const body = request.body as
    | { name?: string; sourceConnectionId?: string | null; destinationConnectionId?: string | null; settings?: unknown }
    | undefined;
  const name = body?.name?.trim();
  if (!name) {
    reply.code(400).send({ error: 'name is required' });
    return;
  }

  const sourceConnectionId = body?.sourceConnectionId ?? null;
  const destinationConnectionId = body?.destinationConnectionId ?? null;
  const settings = body?.settings ?? {};

  const result = await db.query<IntegrationRow>(
    `insert into integrations (name, source_connection_id, destination_connection_id, settings)
     values ($1, $2, $3, $4::jsonb)
     returning *`,
    [name, sourceConnectionId, destinationConnectionId, JSON.stringify(settings)]
  );

  reply.code(201).send(result.rows[0]);
});

app.put('/integrations/:id', { preHandler: authRequired }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as
    | { name?: string; sourceConnectionId?: string | null; destinationConnectionId?: string | null; settings?: unknown }
    | undefined;
  const name = body?.name?.trim();
  if (!name) {
    reply.code(400).send({ error: 'name is required' });
    return;
  }

  const sourceConnectionId = body?.sourceConnectionId ?? null;
  const destinationConnectionId = body?.destinationConnectionId ?? null;
  const settings = body?.settings ?? {};

  const result = await db.query<IntegrationRow>(
    `update integrations
     set name = $2,
         source_connection_id = $3,
         destination_connection_id = $4,
         settings = $5::jsonb,
         updated_at = now()
     where id = $1
     returning *`,
    [id, name, sourceConnectionId, destinationConnectionId, JSON.stringify(settings)]
  );
  const updated = result.rows[0];
  if (!updated) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  reply.send(updated);
});

app.delete('/integrations/:id', { preHandler: authRequired }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = await db.query<{ id: string }>('delete from integrations where id = $1 returning id', [id]);
  if (!result.rows[0]) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  reply.send({ ok: true });
});

async function upsertSchedule(params: {
  integrationId: string;
  jobType: QueueName;
  cron: string;
  enabled: boolean;
}) {
  const result = await db.query<ScheduleRow>(
    `insert into schedules (integration_id, job_type, cron, enabled)
     values ($1, $2, $3, $4)
     on conflict (integration_id, job_type) do update
     set cron = excluded.cron,
         enabled = excluded.enabled,
         updated_at = now()
     returning *`,
    [params.integrationId, params.jobType, params.cron, params.enabled]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to upsert schedule');
  }

  return row;
}

app.get('/schedules', { preHandler: authRequired }, async () => {
  const result = await db.query<ScheduleRow>('select * from schedules order by created_at desc');
  return result.rows;
});

app.post('/schedules', { preHandler: authRequired }, async (request, reply) => {
  const body = request.body as { integrationId?: string; jobType?: QueueName; cron?: string; enabled?: boolean } | undefined;
  const integrationId = body?.integrationId;
  const jobType = body?.jobType;
  const cron = body?.cron?.trim();
  const enabled = body?.enabled ?? true;

  if (!integrationId || !jobType || !cron) {
    reply.code(400).send({ error: 'integrationId, jobType and cron are required' });
    return;
  }

  if (jobType !== queueNames.step1CaptureOrders && jobType !== queueNames.step2SendOrders) {
    reply.code(400).send({ error: 'Unsupported jobType' });
    return;
  }

  const row = await upsertSchedule({ integrationId, jobType, cron, enabled });
  reply.code(201).send(row);
});

app.post('/schedules/:id/enable', { preHandler: authRequired }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = await db.query<ScheduleRow>('select * from schedules where id = $1', [id]);
  const row = result.rows[0];
  if (!row) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  const updated = await upsertSchedule({
    integrationId: row.integration_id,
    jobType: row.job_type as QueueName,
    cron: row.cron,
    enabled: true,
  });
  reply.send(updated);
});

app.post('/schedules/:id/disable', { preHandler: authRequired }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = await db.query<ScheduleRow>('select * from schedules where id = $1', [id]);
  const row = result.rows[0];
  if (!row) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  const updated = await upsertSchedule({
    integrationId: row.integration_id,
    jobType: row.job_type as QueueName,
    cron: row.cron,
    enabled: false,
  });
  reply.send(updated);
});

app.get('/notifiers', { preHandler: authRequired }, async () => {
  const result = await db.query<NotifierConfigRow>('select * from notifier_configs order by created_at desc');
  return result.rows;
});

app.post('/notifiers', { preHandler: authRequired }, async (request, reply) => {
  const body = request.body as
    | {
        integrationId?: string;
        sourceJobType?: QueueName;
        sourceStatus?: string;
        actionJobType?: QueueName;
        priority?: number;
        enabled?: boolean;
      }
    | undefined;
  const integrationId = body?.integrationId;
  const sourceJobType = body?.sourceJobType ?? queueNames.step1CaptureOrders;
  const sourceStatus = body?.sourceStatus ?? 'success';
  const actionJobType = body?.actionJobType ?? queueNames.step2SendOrders;
  const priority = body?.priority ?? 100;
  const enabled = body?.enabled ?? true;

  if (!integrationId) {
    reply.code(400).send({ error: 'integrationId is required' });
    return;
  }

  const result = await db.query<NotifierConfigRow>(
    `insert into notifier_configs (integration_id, source_job_type, source_status, action_job_type, priority, enabled)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [integrationId, sourceJobType, sourceStatus, actionJobType, priority, enabled]
  );
  reply.code(201).send(result.rows[0]);
});

app.put('/notifiers/:id', { preHandler: authRequired }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { priority?: number; enabled?: boolean } | undefined;
  const priority = body?.priority;
  const enabled = body?.enabled;

  const result = await db.query<NotifierConfigRow>(
    `update notifier_configs
     set priority = coalesce($2, priority),
         enabled = coalesce($3, enabled),
         updated_at = now()
     where id = $1
     returning *`,
    [id, priority ?? null, enabled ?? null]
  );
  const row = result.rows[0];
  if (!row) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  reply.send(row);
});

app.delete('/notifiers/:id', { preHandler: authRequired }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = await db.query<{ id: string }>('delete from notifier_configs where id = $1 returning id', [id]);
  if (!result.rows[0]) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  reply.send({ ok: true });
});

async function createExecution(params: {
  integrationId: string;
  jobType: QueueName;
  trigger: ExecutionTrigger;
  requestedBy: string | null;
  correlationId: string;
}): Promise<ExecutionRow> {
  const result = await db.query<ExecutionRow>(
    `insert into executions (integration_id, job_type, status, trigger, requested_by, correlation_id)
     values ($1, $2, 'queued', $3, $4, $5)
     returning *`,
    [params.integrationId, params.jobType, params.trigger, params.requestedBy, params.correlationId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Failed to create execution');
  return row;
}

async function enqueueJob(params: {
  queueName: QueueName;
  executionId: string;
  integrationId: string;
  trigger: ExecutionTrigger;
  correlationId: string;
}) {
  const jobId = await boss.send(params.queueName, {
    executionId: params.executionId,
    integrationId: params.integrationId,
    trigger: params.trigger,
    correlationId: params.correlationId,
    lockKey: advisoryLockKey(params.queueName, params.integrationId).toString(),
  });
  if (!jobId) {
    throw new Error('Failed to enqueue job (pg-boss returned null). Check queue creation.');
  }
}

app.post('/jobs/step1/run', { preHandler: authRequired }, async (request, reply) => {
  const body = request.body as { integrationId?: string } | undefined;
  const integrationId = body?.integrationId;
  if (!integrationId) {
    reply.code(400).send({ error: 'integrationId is required' });
    return;
  }

  const correlationId = randomUUID();
  const requestedBy = request.user?.userId ?? null;

  const execution = await createExecution({
    integrationId,
    jobType: queueNames.step1CaptureOrders,
    trigger: 'manual',
    requestedBy,
    correlationId,
  });

  await enqueueJob({
    queueName: queueNames.step1CaptureOrders,
    executionId: execution.id,
    integrationId,
    trigger: 'manual',
    correlationId,
  });

  reply.code(202).send(execution);
});

app.post('/jobs/step2/run', { preHandler: authRequired }, async (request, reply) => {
  const body = request.body as { integrationId?: string } | undefined;
  const integrationId = body?.integrationId;
  if (!integrationId) {
    reply.code(400).send({ error: 'integrationId is required' });
    return;
  }

  const correlationId = randomUUID();
  const requestedBy = request.user?.userId ?? null;

  const execution = await createExecution({
    integrationId,
    jobType: queueNames.step2SendOrders,
    trigger: 'manual',
    requestedBy,
    correlationId,
  });

  await enqueueJob({
    queueName: queueNames.step2SendOrders,
    executionId: execution.id,
    integrationId,
    trigger: 'manual',
    correlationId,
  });

  reply.code(202).send(execution);
});

app.get('/executions', { preHandler: authRequired }, async (request) => {
  const query = request.query as Partial<{
    integrationId: string;
    status: ExecutionStatus;
    jobType: QueueName;
    trigger: ExecutionTrigger;
    limit: string;
    offset: string;
  }>;

  const where: string[] = [];
  const params: unknown[] = [];

  if (query.integrationId) {
    params.push(query.integrationId);
    where.push(`integration_id = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    where.push(`status = $${params.length}`);
  }
  if (query.jobType) {
    params.push(query.jobType);
    where.push(`job_type = $${params.length}`);
  }
  if (query.trigger) {
    params.push(query.trigger);
    where.push(`trigger = $${params.length}`);
  }

  const limit = Math.min(Number(query.limit ?? '50'), 200);
  const offset = Math.max(Number(query.offset ?? '0'), 0);
  params.push(limit);
  params.push(offset);

  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  const result = await db.query<ExecutionRow>(
    `select * from executions ${whereSql} order by queued_at desc limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return result.rows;
});

app.get('/executions/:id', { preHandler: authRequired }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = await db.query<ExecutionRow>('select * from executions where id = $1', [id]);
  const row = result.rows[0];
  if (!row) {
    reply.code(404).send({ error: 'Not found' });
    return;
  }
  return row;
});

app.addHook('onClose', async () => {
  await boss.stop().catch(() => undefined);
  await db.end();
});

await app.listen({ port: env.port, host: '0.0.0.0' });
