import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { readdir } from 'node:fs/promises';
import { ApiServiceRepository } from './repositories/ApiServiceRepository.js';
import { createDb } from './db.js';
import { env } from './env.js';
import { authRequired } from './api.js';
import { PowerStockGetOperationsService } from './services/PowerStockGetOperationsService.js';
import { PrismaClient } from '@prisma/client';
import { DispatcherService } from './services/DispatcherService.js';
import { IntegradorOperacoesLojaDoPowerStockService } from './services/IntegradorOperacoesLojaDoPowerStockService.js';

export async function apiIntegrationRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  const db = createDb(env.databaseUrl);
  const repository = new ApiServiceRepository(db);
  const powerStockGetOperationsService = new PowerStockGetOperationsService(repository);
  const dispatcherDefaults = {
    maxConcurrency: 2,
    maxRetries: 3,
    limit: 200,
  };

  fastify.addHook('preHandler', authRequired);

  async function countDispatcherPending(): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM integracao_pendente ip
       JOIN sistema_destino_config sdc ON sdc.nome = ip.sistema_nome
       WHERE ip.status = 'pendente'
         AND ip.tentativas < $1
         AND sdc.ativo = true`,
      [dispatcherDefaults.maxRetries]
    );
    const raw = result.rows[0]?.count ?? '0';
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Auth Configs
  fastify.get('/auth-configs', async () => {
    return await repository.listAuthConfigs();
  });

  fastify.post('/auth-configs', async (request, reply) => {
    const body = request.body as any;
    const result = await repository.createAuthConfig(body);
    reply.code(201).send(result);
  });

  fastify.put('/auth-configs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const result = await repository.updateAuthConfig(id, body);
    if (!result) return reply.code(404).send({ error: 'Not found' });
    reply.send(result);
  });

  fastify.delete('/auth-configs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const success = await repository.deleteAuthConfig(id);
    if (!success) return reply.code(404).send({ error: 'Not found' });
    reply.send({ ok: true });
  });

  // Sistema Destino Config
  fastify.get('/sistema-destino-configs', async () => {
    return await repository.listSistemaDestinoConfigs();
  });

  fastify.get('/sistema-destino-configs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const result = await repository.getSistemaDestinoConfigById(parsedId);
    if (!result) return reply.code(404).send({ error: 'Not found' });
    reply.send(result);
  });

  fastify.post('/sistema-destino-configs', async (request, reply) => {
    const body = request.body as any;
    const result = await repository.createSistemaDestinoConfig(body);
    reply.code(201).send(result);
  });

  fastify.put('/sistema-destino-configs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const body = request.body as any;
    const result = await repository.updateSistemaDestinoConfig(parsedId, body);
    if (!result) return reply.code(404).send({ error: 'Not found' });
    reply.send(result);
  });

  fastify.delete('/sistema-destino-configs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return reply.code(400).send({ error: 'Invalid id' });
    }
    const success = await repository.deleteSistemaDestinoConfig(parsedId);
    if (!success) return reply.code(404).send({ error: 'Not found' });
    reply.send({ ok: true });
  });

  // Services
  fastify.get('/services', async () => {
    return await repository.listServices();
  });

  fastify.get('/services/available', async () => {
    const servicesDir = new URL('./services/', import.meta.url);
    const fileNames = await readdir(servicesDir);
    return fileNames
      .filter((name) => /\.(js|ts)$/i.test(name))
      .map((name) => name.replace(/\.(js|ts)$/i, ''))
      .filter((name) => !/types?/i.test(name))
      .sort((a, b) => a.localeCompare(b));
  });

  fastify.post('/services', async (request, reply) => {
    const body = request.body as any;
    try {
      const result = await repository.createService(body);
      reply.code(201).send(result);
    } catch (error: any) {
      const message = String(error?.message ?? '');
      if (message.startsWith('Parâmetro GET inválido:')) {
        return reply.code(400).send({ error: message });
      }
      throw error;
    }
  });

  fastify.put('/services/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    try {
      const result = await repository.updateService(id, body);
      if (!result) return reply.code(404).send({ error: 'Not found' });
      reply.send(result);
    } catch (error: any) {
      const message = String(error?.message ?? '');
      if (message.startsWith('Parâmetro GET inválido:')) {
        return reply.code(400).send({ error: message });
      }
      throw error;
    }
  });

  fastify.delete('/services/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const success = await repository.deleteService(id);
    if (!success) return reply.code(404).send({ error: 'Not found' });
    reply.send({ ok: true });
  });

  fastify.post('/services/:id/execute', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const body = (request.body as Record<string, unknown> | undefined) ?? {};
    const dataEmissaoInicio = (body.dataEmissaoInicio ?? query.dataEmissaoInicio) as string | undefined;
    const dataEmissaoFim = (body.dataEmissaoFim ?? query.dataEmissaoFim) as string | undefined;
    try {
      const service = await repository.getServiceById(id);
      if (!service) {
        return reply.code(404).send({ ok: false, error: 'Serviço não encontrado' });
      }

      const serviceName = String(service.service_name ?? '').trim();
      if (serviceName === 'IntegradorOperacoesLojaDoPowerStockService') {
        const prisma = new PrismaClient();
        const integrador = new IntegradorOperacoesLojaDoPowerStockService(repository, prisma);
        try {
          const result = await integrador.execute('manual', {
            dataEmissaoInicio,
            dataEmissaoFim,
          });
          if (!result.success) {
            return reply.code(500).send({ ok: false, error: result.error ?? 'Falha ao executar integrador', batchId: result.batchId });
          }
          return reply.code(201).send({ ok: true, batchId: result.batchId });
        } finally {
          await prisma.$disconnect();
        }
      }

      const result = await powerStockGetOperationsService.executeService(service.id, {
        dataEmissaoInicio,
        dataEmissaoFim,
      });
      if (!result.success) {
        return reply.code(500).send({ ok: false, error: result.error ?? 'Falha ao executar serviço', batchId: null });
      }
      reply.code(201).send({ ok: true, data: result.data });
    } catch (error: any) {
      reply.code(500).send({ ok: false, error: error?.message ?? 'Falha ao executar serviço' });
    }
  });

  fastify.get('/dispatcher/pending', async () => {
    const pendingEligible = await countDispatcherPending();
    return {
      pendingEligible,
      batchLimit: dispatcherDefaults.limit,
      maxRetries: dispatcherDefaults.maxRetries,
      maxConcurrency: dispatcherDefaults.maxConcurrency,
    };
  });

  fastify.post('/dispatcher/execute', async (request, reply) => {
    const before = await countDispatcherPending();
    const prisma = new PrismaClient();
    const dispatcher = new DispatcherService(prisma, {
      maxConcurrency: dispatcherDefaults.maxConcurrency,
      maxRetries: dispatcherDefaults.maxRetries,
    });
    try {
      await dispatcher.processPendingBatch();
    } finally {
      await prisma.$disconnect();
    }
    const after = await countDispatcherPending();
    reply.code(201).send({ ok: true, pendingBefore: before, pendingAfter: after });
  });

  // Service Schedules (pg-boss cron) - para serviços do módulo api-integration
  fastify.get('/service-schedules', async () => {
    const result = await db.query<{
      id: string;
      api_service_id: string;
      cron: string;
      enabled: boolean;
      created_at: string;
      updated_at: string;
      service_display_name: string;
      service_name: string | null;
    }>(
      `SELECT
         s.id,
         s.api_service_id,
         s.cron,
         s.enabled,
         s.created_at,
         s.updated_at,
         svc.name AS service_display_name,
         svc.service_name
       FROM api_integration_service_schedules s
       JOIN api_services svc ON svc.id = s.api_service_id
       ORDER BY s.created_at DESC`
    );
    return result.rows;
  });

  fastify.post('/service-schedules', async (request, reply) => {
    const body = (request.body as { serviceId?: string; cron?: string; enabled?: boolean } | undefined) ?? {};
    const serviceId = String(body.serviceId ?? '').trim();
    const cron = String(body.cron ?? '').trim();
    const enabled = body.enabled ?? true;
    if (!serviceId || !cron) {
      return reply.code(400).send({ error: 'serviceId e cron são obrigatórios.' });
    }

    const result = await db.query<{
      id: string;
      api_service_id: string;
      cron: string;
      enabled: boolean;
      created_at: string;
      updated_at: string;
      service_display_name: string;
      service_name: string | null;
    }>(
      `WITH upserted AS (
         INSERT INTO api_integration_service_schedules (api_service_id, cron, enabled)
         VALUES ($1::uuid, $2, $3)
         ON CONFLICT (api_service_id)
         DO UPDATE SET cron = EXCLUDED.cron, enabled = EXCLUDED.enabled, updated_at = now()
         RETURNING *
       )
       SELECT
         u.id,
         u.api_service_id,
         u.cron,
         u.enabled,
         u.created_at,
         u.updated_at,
         svc.name AS service_display_name,
         svc.service_name
       FROM upserted u
       JOIN api_services svc ON svc.id = u.api_service_id`,
      [serviceId, cron, enabled]
    );
    const row = result.rows[0];
    if (!row) return reply.code(500).send({ error: 'Falha ao salvar agendamento.' });
    reply.code(201).send(row);
  });

  fastify.post('/service-schedules/:id/enable', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await db.query<{ id: string }>(
      `UPDATE api_integration_service_schedules
       SET enabled = true, updated_at = now()
       WHERE id = $1::uuid
       RETURNING id`,
      [id]
    );
    if (!result.rows[0]?.id) return reply.code(404).send({ error: 'Not found' });
    reply.send({ ok: true });
  });

  fastify.post('/service-schedules/:id/disable', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await db.query<{ id: string }>(
      `UPDATE api_integration_service_schedules
       SET enabled = false, updated_at = now()
       WHERE id = $1::uuid
       RETURNING id`,
      [id]
    );
    if (!result.rows[0]?.id) return reply.code(404).send({ error: 'Not found' });
    reply.send({ ok: true });
  });

  // Batches
  fastify.get('/batches', async (request) => {
    const query = request.query as any;
    return await repository.listBatches({
      serviceId: query.serviceId,
      status: query.status,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
  });

  fastify.get('/batches/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await repository.getBatch(id);
    if (!result) return reply.code(404).send({ error: 'Not found' });
    reply.send(result);
  });

  // Executions
  fastify.get('/executions', async (request) => {
    const query = request.query as any;
    return await repository.listExecutionsByBatch(query.batchId);
  });

  fastify.get('/executions/:id/details', async (request) => {
    const { id } = request.params as { id: string };
    return await repository.listExecutionDetails(id);
  });
}
