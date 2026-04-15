import { randomUUID } from 'node:crypto';

import { advisoryLockKey, createDb } from './db.js';
import { startBoss } from './boss.js';
import { env } from './env.js';
import { runStep1CaptureOrders, runStep2SendOrders } from './job-runners.js';
import { queueNames, type ExecutionStatus, type ExecutionTrigger, type QueueName } from './types.js';

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

type NotifierConfigRow = {
  id: string;
  integration_id: string;
  source_job_type: string;
  source_status: string;
  action_job_type: string;
  priority: number;
  enabled: boolean;
};

type JobData = {
  executionId: string;
  integrationId: string;
  trigger: ExecutionTrigger;
  correlationId: string;
  lockKey: string;
};

type NotifierDispatchData = {
  sourceExecutionId: string;
};

type ScheduleRow = {
  id: string;
  integration_id: string;
  job_type: string;
  cron: string;
  enabled: boolean;
};

type ScheduleData = {
  integrationId: string;
  jobType: QueueName;
};

const db = createDb(env.databaseUrl);
const boss = await startBoss(env.databaseUrl, [
  queueNames.step1CaptureOrders,
  queueNames.step2SendOrders,
  queueNames.notifierDispatch,
]);

function scheduleJobName(jobType: QueueName, integrationId: string) {
  return `schedule:${jobType}:${integrationId}`;
}

async function updateExecutionStatus(
  executionId: string,
  patch: Partial<{ status: ExecutionStatus; error: unknown | null; metrics: unknown }>
) {
  const fields: string[] = [];
  const values: unknown[] = [executionId];

  if (patch.status) {
    values.push(patch.status);
    fields.push(`status = $${values.length}`);
    if (patch.status === 'running') {
      fields.push('started_at = now()');
    }
    if (patch.status === 'success' || patch.status === 'failed' || patch.status === 'skipped') {
      fields.push('finished_at = now()');
    }
  }

  if (patch.error !== undefined) {
    values.push(patch.error === null ? null : JSON.stringify(patch.error));
    fields.push(`error = $${values.length}::jsonb`);
  }

  if (patch.metrics !== undefined) {
    values.push(JSON.stringify(patch.metrics));
    fields.push(`metrics = $${values.length}::jsonb`);
  }

  if (!fields.length) return;

  await db.query(`update executions set ${fields.join(', ')} where id = $1`, values);
}

async function loadExecution(executionId: string): Promise<ExecutionRow> {
  const result = await db.query<ExecutionRow>('select * from executions where id = $1', [executionId]);
  const row = result.rows[0];
  if (!row) throw new Error(`Execution not found: ${executionId}`);
  return row;
}

async function tryAcquireLock(jobType: string, integrationId: string): Promise<{ ok: boolean; key: bigint }> {
  const key = advisoryLockKey(jobType, integrationId);
  const result = await db.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [key.toString()]);
  return { ok: Boolean(result.rows[0]?.ok), key };
}

async function releaseLock(key: bigint) {
  await db.query('select pg_advisory_unlock($1)', [key.toString()]);
}

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

async function handleScheduleFire(data: ScheduleData) {
  const correlationId = randomUUID();
  const execution = await createExecution({
    integrationId: data.integrationId,
    jobType: data.jobType,
    trigger: 'scheduled',
    requestedBy: null,
    correlationId,
  });

  const jobId = await boss.send(data.jobType, {
    executionId: execution.id,
    integrationId: data.integrationId,
    trigger: 'scheduled',
    correlationId,
    lockKey: advisoryLockKey(data.jobType, data.integrationId).toString(),
  });

  if (!jobId) {
    throw new Error('Failed to enqueue scheduled job (pg-boss returned null). Check queue creation.');
  }
}

async function handleStepJob(queueName: QueueName, data: JobData) {
  const execution = await loadExecution(data.executionId);
  await updateExecutionStatus(execution.id, { status: 'running', error: null });

  const lock = await tryAcquireLock(queueName, data.integrationId);
  if (!lock.ok) {
    await updateExecutionStatus(execution.id, { status: 'skipped' });
    return;
  }

  try {
    const metrics =
      queueName === queueNames.step1CaptureOrders
        ? await runStep1CaptureOrders(db, data.integrationId)
        : await runStep2SendOrders(db, data.integrationId, execution.id);

    await updateExecutionStatus(execution.id, { status: 'success', error: null, metrics });
    if (queueName === queueNames.step1CaptureOrders) {
      await boss.send(queueNames.notifierDispatch, { sourceExecutionId: execution.id });
    }
  } catch (error) {
    await updateExecutionStatus(execution.id, {
      status: 'failed',
      error: error instanceof Error ? { message: error.message } : error,
    });
    throw error;
  } finally {
    await releaseLock(lock.key).catch(() => undefined);
  }
}

async function handleNotifierDispatch(data: NotifierDispatchData) {
  const sourceExecution = await loadExecution(data.sourceExecutionId);
  if (sourceExecution.status !== 'success') {
    return;
  }

  const notifiersResult = await db.query<NotifierConfigRow>(
    `select id, integration_id, source_job_type, source_status, action_job_type, priority, enabled
     from notifier_configs
     where enabled = true
       and integration_id = $1
       and source_job_type = $2
       and source_status = $3
     order by priority asc`,
    [sourceExecution.integration_id, sourceExecution.job_type, 'success']
  );

  for (const notifier of notifiersResult.rows) {
    await db.tx(async (client) => {
      const dispatchResult = await client.query<{ id: string }>(
        `insert into notifier_dispatches (notifier_config_id, source_execution_id, status)
         values ($1, $2, 'queued')
         returning id`,
        [notifier.id, sourceExecution.id]
      );
      const dispatchId = dispatchResult.rows[0]?.id;
      if (!dispatchId) throw new Error('Failed to create notifier dispatch');

      await client.query('update notifier_dispatches set status = $2, started_at = now() where id = $1', [
        dispatchId,
        'running',
      ]);

      try {
        const exec = await createExecution({
          integrationId: sourceExecution.integration_id,
          jobType: notifier.action_job_type as QueueName,
          trigger: 'notifier',
          requestedBy: null,
          correlationId: sourceExecution.correlation_id,
        });

        await boss.send(notifier.action_job_type, {
          executionId: exec.id,
          integrationId: sourceExecution.integration_id,
          trigger: 'notifier',
          correlationId: sourceExecution.correlation_id,
          lockKey: advisoryLockKey(notifier.action_job_type, sourceExecution.integration_id).toString(),
        });

        await client.query('update notifier_dispatches set status = $2, finished_at = now() where id = $1', [
          dispatchId,
          'success',
        ]);
      } catch (error) {
        const err = error instanceof Error ? { message: error.message } : error;
        await client.query(
          'update notifier_dispatches set status = $2, error = $3::jsonb, finished_at = now() where id = $1',
          [dispatchId, 'failed', JSON.stringify(err)]
        );
        throw error;
      }
    });
  }
}

async function main() {
  const scheduleRegistry = new Map<string, { scheduleName: string; cron: string }>();

  async function syncSchedules() {
    const result = await db.query<ScheduleRow>(
      `select id, integration_id, job_type, cron, enabled
       from schedules
       where enabled = true
       order by created_at asc`
    );

    const active = new Set<string>();
    for (const row of result.rows) {
      if (row.job_type !== queueNames.step1CaptureOrders && row.job_type !== queueNames.step2SendOrders) {
        continue;
      }

      const jobType = row.job_type as QueueName;
      const sName = scheduleJobName(jobType, row.integration_id);
      active.add(row.id);

      const prev = scheduleRegistry.get(row.id);
      if (prev && prev.scheduleName === sName && prev.cron === row.cron) {
        continue;
      }

      await boss.createQueue(sName).catch(() => undefined);
      await boss.unschedule(sName).catch(() => undefined);
      await boss.schedule(sName, row.cron, { integrationId: row.integration_id, jobType });

      if (!prev || prev.scheduleName !== sName) {
        await boss.work<ScheduleData>(sName, async (jobs) => {
          for (const job of jobs) {
            await handleScheduleFire(job.data);
          }
        });
      }

      scheduleRegistry.set(row.id, { scheduleName: sName, cron: row.cron });
    }

    for (const [id, prev] of scheduleRegistry.entries()) {
      if (active.has(id)) continue;
      await boss.unschedule(prev.scheduleName).catch(() => undefined);
      await boss.offWork(prev.scheduleName).catch(() => undefined);
      scheduleRegistry.delete(id);
    }
  }

  await boss.work<JobData>(queueNames.step1CaptureOrders, async (jobs) => {
    for (const job of jobs) {
      await handleStepJob(queueNames.step1CaptureOrders, job.data);
    }
  });

  await boss.work<JobData>(queueNames.step2SendOrders, async (jobs) => {
    for (const job of jobs) {
      await handleStepJob(queueNames.step2SendOrders, job.data);
    }
  });

  await boss.work<NotifierDispatchData>(queueNames.notifierDispatch, async (jobs) => {
    for (const job of jobs) {
      await handleNotifierDispatch(job.data);
    }
  });

  await syncSchedules();
  const scheduleTimer = setInterval(() => {
    void syncSchedules().catch(() => undefined);
  }, 15000);

  const shutdown = async () => {
    clearInterval(scheduleTimer);
    await boss.stop().catch(() => undefined);
    await db.end().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

await main();
