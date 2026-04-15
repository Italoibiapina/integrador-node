import { readdir, readFile } from 'node:fs/promises';

import { createDb } from './db.js';
import { env } from './env.js';

type MigrationRow = { id: string };

async function ensureMigrationsTable(db: ReturnType<typeof createDb>) {
  await db.query(
    `create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )`
  );
}

async function getAppliedMigrations(db: ReturnType<typeof createDb>): Promise<Set<string>> {
  const result = await db.query<MigrationRow>('select id from schema_migrations order by id asc');
  return new Set(result.rows.map((r) => r.id));
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const db = createDb(databaseUrl);
  try {
    await ensureMigrationsTable(db);
    const applied = await getAppliedMigrations(db);

    const migrationsDir = new URL('./migrations/', import.meta.url);
    const fileNames = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

    for (const fileName of fileNames) {
      if (applied.has(fileName)) continue;

      const sql = await readFile(new URL(fileName, migrationsDir), 'utf8');

      await db.tx(async (client) => {
        await client.query(sql);
        await client.query('insert into schema_migrations (id) values ($1)', [fileName]);
      });
    }
  } finally {
    await db.end();
  }
}

await runMigrations(env.databaseUrl);
