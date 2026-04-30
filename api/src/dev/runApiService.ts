import { createDb } from '../db.js';
import { env } from '../env.js';
import { ApiServiceRepository } from '../repositories/ApiServiceRepository.js';
import { PowerStockGetOperationsService } from '../services/PowerStockGetOperationsService.js';

type CliArgs = {
  id?: string;
  name?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]?.trim();
    if (!token) continue;

    if (token.startsWith('--id=')) {
      out.id = token.slice('--id='.length).trim();
      continue;
    }
    if (token === '--id') {
      out.id = (argv[i + 1] ?? '').trim();
      i += 1;
      continue;
    }

    if (token.startsWith('--name=')) {
      out.name = token.slice('--name='.length).trim();
      continue;
    }
    if (token === '--name') {
      out.name = (argv[i + 1] ?? '').trim();
      i += 1;
      continue;
    }
  }
  return out;
}

function printUsage(): void {
  process.stdout.write(
    [
      'Uso:',
      '  npm run run:api-service -- --id <service_id>',
      '  npm run run:api-service -- --name "<nome do service>"',
      '',
      'Exemplos:',
      '  npm run run:api-service -- --id 123e4567-e89b-12d3-a456-426614174000',
      '  npm run run:api-service -- --name "PowerStock Integracao"',
      '',
    ].join('\n')
  );
}

async function resolveServiceId(repository: ApiServiceRepository, args: CliArgs): Promise<string> {
  if (args.id) return args.id;

  if (!args.name) {
    printUsage();
    throw new Error('Informe --id ou --name para executar o service.');
  }

  const services = await repository.listServices();
  const match = services.find((s) => s.name.trim().toLowerCase() === args.name?.trim().toLowerCase());
  if (!match) {
    throw new Error(`Service nao encontrado pelo nome: "${args.name}"`);
  }
  return match.id;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = createDb(env.databaseUrl);

  try {
    const repository = new ApiServiceRepository(db);
    const serviceId = await resolveServiceId(repository, args);
    const runner = new PowerStockGetOperationsService(repository);

    process.stdout.write(`Executando service: ${serviceId}\n`);
    const result = await runner.executeService(serviceId);

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.success) {
      process.exitCode = 1;
    }
  } finally {
    await db.end().catch(() => undefined);
  }
}

await main();
