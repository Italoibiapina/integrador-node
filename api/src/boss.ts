import PgBoss from 'pg-boss';

export async function startBoss(databaseUrl: string, queues: string[] = []): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl });
  await boss.start();
  for (const name of queues) {
    await boss.createQueue(name).catch(() => undefined);
  }
  return boss;
}
