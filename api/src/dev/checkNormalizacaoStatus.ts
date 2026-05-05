import { createDb } from '../db.js';
import { env } from '../env.js';

async function main() {
  const db = createDb(env.databaseUrl);
  try {
    const raw = await db.query(
      `SELECT id, id_venda_externo, status_processamento, COALESCE(log_erro, '') AS log_erro, data_extracao
       FROM operacoes_raw
       ORDER BY id DESC
       LIMIT 20`
    );
    const triggers = await db.query(
      `SELECT tg.tgname
       FROM pg_trigger tg
       JOIN pg_class c ON c.oid = tg.tgrelid
       WHERE c.relname = 'operacoes_raw'
         AND NOT tg.tgisinternal`
    );
    const functions = await db.query(
      `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('fn_normalizar_operacoes')`
    );
    const operacoes = await db.query(
      `SELECT id, id_venda_externo, numero_operacao, atualizado_em
       FROM operacoes
       ORDER BY id DESC
       LIMIT 20`
    );

    console.log(
      JSON.stringify(
        {
          raw: raw.rows,
          triggers: triggers.rows,
          functions: functions.rows,
          operacoes: operacoes.rows,
        },
        null,
        2
      )
    );
  } finally {
    await db.end();
  }
}

void main();
