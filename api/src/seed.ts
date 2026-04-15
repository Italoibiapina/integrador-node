import { createDb } from './db.js';
import { hashPassword } from './auth.js';
import { env } from './env.js';

type UserRow = { id: string; email: string; role: 'admin' | 'operator' };

async function main() {
  const db = createDb(env.databaseUrl);
  try {
    const passwordHash = await hashPassword(env.adminPassword);

    const result = await db.query<UserRow>(
      `insert into users (email, password_hash, role)
       values ($1, $2, 'admin')
       on conflict (email) do update
       set password_hash = excluded.password_hash
       returning id, email, role`,
      [env.adminEmail, passwordHash]
    );

    const user = result.rows[0];
    if (!user) {
      throw new Error('Failed to seed admin user');
    }

    process.stdout.write(JSON.stringify({ seededAdmin: user }, null, 2));
    process.stdout.write('\n');
  } finally {
    await db.end();
  }
}

await main();
