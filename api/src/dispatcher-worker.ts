import './env.js';
import { PrismaClient } from '@prisma/client';
import { DispatcherService } from './services/DispatcherService.js';

const prisma = new PrismaClient();

async function main() {
  const dispatcher = new DispatcherService(prisma, {
    maxConcurrency: 2,
    maxRetries: 3,
  });
  try {
    await dispatcher.processPendingBatch();
    console.log('DispatcherService: execução manual concluída.');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
