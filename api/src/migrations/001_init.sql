create extension if not exists pgcrypto;

create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'operator')),
  created_at timestamptz not null default now()
);

create table if not exists connections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('api', 'db', 'custom')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_connection_id uuid null references connections(id) on delete set null,
  destination_connection_id uuid null references connections(id) on delete set null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integrations(id) on delete cascade,
  job_type text not null,
  cron text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, job_type)
);

create table if not exists executions (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integrations(id) on delete cascade,
  job_type text not null,
  status text not null check (status in ('queued', 'running', 'success', 'failed', 'skipped')),
  trigger text not null check (trigger in ('manual', 'scheduled', 'notifier')),
  requested_by uuid null references users(id) on delete set null,
  correlation_id uuid not null,
  queued_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null,
  error jsonb null,
  metrics jsonb not null default '{}'::jsonb
);

create index if not exists executions_integration_queued_at_idx on executions(integration_id, queued_at desc);
create index if not exists executions_status_idx on executions(status);

create table if not exists notifier_configs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integrations(id) on delete cascade,
  source_job_type text not null,
  source_status text not null default 'success',
  action_job_type text not null,
  priority int not null default 100,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, source_job_type, source_status, action_job_type)
);

create index if not exists notifier_configs_integration_source_idx on notifier_configs(integration_id, source_job_type, source_status);

create table if not exists notifier_dispatches (
  id uuid primary key default gen_random_uuid(),
  notifier_config_id uuid not null references notifier_configs(id) on delete cascade,
  source_execution_id uuid not null references executions(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'success', 'failed')),
  started_at timestamptz null,
  finished_at timestamptz null,
  error jsonb null,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integrations(id) on delete cascade,
  source_system text not null,
  source_order_id text not null,
  source_payload jsonb not null default '{}'::jsonb,
  mapped_payload jsonb null,
  source_payload_hash text null,
  mapped_payload_hash text null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, source_system, source_order_id)
);

create index if not exists orders_integration_source_idx on orders(integration_id, source_system, source_order_id);

create table if not exists send_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  execution_id uuid not null references executions(id) on delete cascade,
  status text not null check (status in ('queued', 'success', 'failed')),
  request_payload jsonb null,
  response_payload jsonb null,
  status_code int null,
  error jsonb null,
  created_at timestamptz not null default now()
);
