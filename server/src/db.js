import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

// Несколько семей на одном сервере (src/tenants.js): у каждой — своя схема в базе с теми же таблицами.
// Семья запроса живёт в scope (её ставит src/tenants.js на весь запрос), и q()/tx() работают только с её таблицами.
// Главная семья — схема public. Общие таблицы сервера — в схеме core, к ним обращаются только с её именем.
export const scope = new AsyncLocalStorage();
// strict — на сервере больше одной семьи: запрос к базе без семьи — ошибка, а не данные главной.
// Пока семья одна, всё как раньше: тесты и скрипты в bin/ ходят в базу без scope.
let strict = false;
export const setStrict = (on) => { strict = on; };

export function schemaNow() {
  const s = scope.getStore();
  if (s) return s.tenant.schema;
  if (strict) throw new Error('Запрос к базе вне семьи');
  return 'public';
}

// Подключение из общего пула с нужной схемой. Схема запоминается у подключения: пока семья та же, лишнего запроса нет.
async function connect() {
  const schema = schemaNow();
  const client = await pool.connect();
  if (client.drevoSchema !== schema) {
    try {
      await client.query(`set search_path to ${schema}`);
    } catch (e) {
      client.release(e);
      throw e;
    }
    client.drevoSchema = schema;
  }
  return client;
}

export async function q(text, params) {
  const client = await connect();
  try {
    const r = await client.query(text, params);
    client.release();
    return r.rows;
  } catch (e) {
    // Как pool.query: подключение после ошибки не возвращается в пул.
    client.release(e);
    throw e;
  }
}

export async function tx(fn) {
  const client = await connect();
  try {
    await client.query('begin');
    // op — общий номер записей журнала за это действие: откат отменяет его целиком.
    const res = await fn({ q: async (t, p) => (await client.query(t, p)).rows, op: crypto.randomUUID() });
    await client.query('commit');
    client.release();
    return res;
  } catch (e) {
    // Не удалось даже откатить — подключение испорчено, в пул его не возвращаем.
    const broken = await client.query('rollback').then(() => undefined, (err) => err);
    client.release(broken);
    throw e;
  }
}

// Общие таблицы сервера (core.*): не зависят от семьи, имя схемы — в самом запросе.
export const core = async (text, params) => (await pool.query(text, params)).rows;
