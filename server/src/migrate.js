import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { loadTenants } from './tenants.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
// Общее для сервера (список семей и т. п.) — в схеме core, его миграции применяются один раз.
const coreDir = path.join(dir, 'core');

const sqlFiles = async (d) => (await fs.readdir(d)).filter((f) => f.endsWith('.sql')).sort();

// Миграции из папки d, которых ещё нет в таблице учёта table, — в схеме, выбранной у client.
// Каждая — своей транзакцией; whole — все в уже открытой транзакции (новая семья создаётся целиком или никак).
export async function applyMigrations(client, { d = dir, table = 'schema_migrations', log = () => {}, prefix = '', whole = false } = {}) {
  await client.query(`create table if not exists ${table} (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await client.query(`select name from ${table}`)).rows.map((r) => r.name));
  for (const file of await sqlFiles(d)) {
    if (done.has(file)) continue;
    const sql = await fs.readFile(path.join(d, file), 'utf8');
    if (!whole) await client.query('begin');
    try {
      await client.query(sql);
      await client.query(`insert into ${table} (name) values ($1)`, [file]);
      if (!whole) await client.query('commit');
    } catch (e) {
      if (!whole) await client.query('rollback');
      throw e;
    }
    log(`миграция ${prefix}${file} применена`);
  }
}

export async function migrate(log = console.log) {
  const client = await pool.connect();
  try {
    await client.query('create schema if not exists core');
    await applyMigrations(client, { d: coreDir, table: 'core.migrations', log, prefix: 'core/' });
    // Каждая семья — своя схема с одинаковыми таблицами: миграции дерева идут в каждую.
    for (const t of await loadTenants()) {
      if (!(await client.query('select 1 from pg_namespace where nspname = $1', [t.schema])).rows.length) {
        log(`семья ${t.id}: нет схемы ${t.schema} в базе, пропускаю`);
        continue;
      }
      await client.query(`set search_path to ${t.schema}`);
      client.drevoSchema = t.schema;
      await applyMigrations(client, { log, prefix: t.main ? '' : `${t.id}: ` });
    }
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
