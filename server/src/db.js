import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export async function q(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const res = await fn({ q: async (t, p) => (await client.query(t, p)).rows });
    await client.query('commit');
    return res;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
