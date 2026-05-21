import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { readdir } from 'node:fs/promises';
import { ApiServiceRepository } from './repositories/ApiServiceRepository.js';
import { createDb } from './db.js';
import { env } from './env.js';
import { authRequired } from './api.js';
import { PowerStockGetOperationsService } from './services/PowerStockGetOperationsService.js';
import { PrismaClient } from '@prisma/client';
import { DispatcherService } from './services/DispatcherService.js';

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
      const result = await powerStockGetOperationsService.executeService(id, {
        dataEmissaoInicio,
        dataEmissaoFim,
      });
      if (!result.success) {
        return reply.code(500).send({ ok: false, error: result.error ?? 'Falha ao executar serviço' });
      }
      reply.code(201).send({ ok: true, data: result.data });
    } catch (error: any) {
      if (error?.message === 'Serviço não encontrado') {
        return reply.code(404).send({ ok: false, error: error.message });
      }
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
