import pg from 'pg';

export type Db = {
  pool: pg.Pool;
  end: () => Promise<void>;
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
  ) => Promise<pg.QueryResult<T>>;
  tx: <T>(fn: (client: pg.PoolClient) => Promise<T>) => Promise<T>;
};

export function createDb(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl });

  return {
    pool,
    end: async () => {
      await pool.end();
    },
    query: <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) =>
      pool.query<T>(text, params),
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(client);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

export function advisoryLockKey(jobType: string, integrationId: string): bigint {
  const h1 = BigInt(fnv1a32(jobType));
  const h2 = BigInt(fnv1a32(integrationId));
  return (h1 << 32n) ^ (h2 & 0xffffffffn);
}
