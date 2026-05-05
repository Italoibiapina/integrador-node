import { PrismaClient } from '@prisma/client';
import { DispatcherService } from '../services/DispatcherService.js';

async function main() {
  const prisma = new PrismaClient();
  const dispatcher = new DispatcherService(prisma, {
    pollIntervalMs: 30_000,
    maxConcurrency: 2,
    maxRetries: 3,
  });

  try {
    await dispatcher.processPendingBatch();
    console.log('DispatcherService: processamento único concluído.');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
