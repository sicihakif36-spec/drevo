// Несколько семей на одном сервере. У каждой семьи — своё дерево, свои люди, приглашения, входы и файлы;
// друг друга семьи не видят. Данные семьи — в своей схеме базы с теми же таблицами (главная — public, остальные — f_<номер>),
// файлы — в своей папке. Почти весь код о семьях не знает: семья запроса стоит в scope (src/db.js) на весь запрос,
// и q()/tx() работают только с её таблицами. Список семей — в core.tenants (migrations/core/).
//
// Какая семья у запроса: по ключу ссылки без входа (анкета, вопрос, интервью) — та, где этот ключ есть;
// иначе — выбранная на телефоне (cookie drevo_t), иначе главная. Вход в каждую семью — своя cookie сессии:
// так один телефон состоит в нескольких семьях и переключается между ними («Профиль → Мои семьи»).
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { AsyncResource } from 'node:async_hooks';
import { pool, core, scope, setStrict, q } from './db.js';
import { config } from './config.js';
import { HttpError } from './tree.js';
import { applyMigrations } from './migrate.js';

export const TENANT_COOKIE = 'drevo_t';
// Главная семья — та, что была на сервере до появления других; её cookie входа прежняя, старые входы не слетают.
const MAIN = { id: 'main', schema: 'public', main: true, title: '', quota_mb: null, closed_at: null };
const DIRS = ['media', 'ask', 'interview', 'survey', 'import'];
const MB = 1024 * 1024;
// Ссылки без входа: заголовок с ключом → таблица, где лежит хеш ключа (token_hash).
const LINKS = { 'x-survey': 'surveys', 'x-ask': 'asks', 'x-interview': 'interviews' };

let list = [MAIN];

export async function loadTenants() {
  list = await core('select id, schema, main, title, created_at, created_by, link_label, quota_mb, closed_at from core.tenants order by main desc, created_at, id');
  if (!list.some((t) => t.main)) list.unshift(MAIN);
  // Семей больше одной — запрос к базе без семьи становится ошибкой, а не тихим чтением главной.
  setStrict(list.length > 1);
  return list;
}

export const tenants = () => list;
export const mainTenant = () => list.find((t) => t.main);
export const tenantById = (id) => list.find((t) => t.id === id) || null;

// fn — в семье t: все q()/tx() внутри — в её схеме.
export const withTenant = (t, fn) => scope.run({ tenant: t }, fn);

export function currentTenant() {
  const s = scope.getStore();
  if (s) return s.tenant;
  if (list.length > 1) throw new Error('Действие вне семьи');
  return mainTenant();
}

// Cookie входа в семью: у главной — прежняя drevo_s.
export const sessionCookie = (t) => (t.main ? 'drevo_s' : `drevo_s_${t.id}`);
// Из имени cookie — в какую семью этот вход (для «Мои семьи»).
export function tenantOfCookie(name) {
  if (name === 'drevo_s') return mainTenant();
  const m = /^drevo_s_([a-z0-9]{1,16})$/.exec(name);
  return m ? tenantById(m[1]) : null;
}

// Папка файлов семьи: у главной — прежняя, у остальных — families/<номер> внутри неё.
export const dataDir = (t = currentTenant()) => (t.main ? config.dataDir : path.join(config.dataDir, 'families', t.id));
export const ensureDirs = (t) => Promise.all(DIRS.map((d) => fsp.mkdir(path.join(dataDir(t), d), { recursive: true })));

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Схемы семьи в базе уже нет: её удалили скриптом (bin/families.js), а список семей здесь ещё прежний.
export const gone = (err) => err?.code === '42P01' || err?.code === '3F000';

// В какой открытой семье есть ссылка с этим хешем ключа. Семей немного — один запрос на все схемы.
export async function findByToken(table, tokenHash, again = false) {
  const open = list.filter((t) => !t.closed_at);
  const parts = open.map((t) => `select '${t.id}' as id from ${t.schema}.${table} where token_hash = $1`);
  try {
    const [r] = await core(`select id from (${parts.join(' union all ')}) x limit 1`, [tokenHash]);
    return r ? tenantById(r.id) : null;
  } catch (err) {
    if (again || !gone(err)) throw err;
    await loadTenants();
    return findByToken(table, tokenHash, true);
  }
}

async function pick(req) {
  for (const [header, table] of Object.entries(LINKS)) {
    const token = req.headers[header];
    if (typeof token === 'string' && token.length >= 20 && token.length <= 100) return (await findByToken(table, sha(token))) || mainTenant();
  }
  return tenantById(req.cookies?.[TENANT_COOKIE]) || mainTenant();
}

export function tenantPlugin(app) {
  app.decorateRequest('tenant', null);
  app.decorateRequest('tenantScope', null);
  app.addHook('onRequest', (req, reply, done) => {
    pick(req).then((t) => {
      req.tenant = t;
      scope.run({ tenant: t }, () => {
        req.tenantScope = new AsyncResource('drevo-tenant');
        done();
      });
    }, done);
  });
  // Обработчик маршрута Fastify зовёт уже после чтения тела запроса, из другого асинхронного контекста:
  // возвращаем семью запроса (так же делает @fastify/request-context).
  app.addHook('preValidation', (req, reply, done) => {
    if (req.tenantScope) req.tenantScope.runInAsyncScope(done, req.raw);
    else done();
  });
  // Список семей перечитывается раз в минуту: его могли поменять скриптом на сервере.
  let timer = null;
  app.addHook('onReady', async () => {
    await loadTenants();
    await Promise.all(list.map(ensureDirs));
    timer = setInterval(() => loadTenants().catch((err) => app.log.warn({ err }, 'не удалось перечитать список семей')), 60000);
    timer.unref();
  });
  app.addHook('onClose', async () => clearInterval(timer));
}

// Занято места файлами семьи (фото, документы, записи голоса, файлы ответов, интервью и анкет), в байтах.
// Удалённое мягко тоже на диске — тоже считается. Миниатюры не считаются.
export const USED = `(select coalesce(sum(bytes), 0) from media) + (select coalesce(sum(bytes), 0) from ask_files)
  + (select coalesce(sum(bytes), 0) from interview_files) + (select coalesce(sum(bytes), 0) from survey_files)`;

export function sizeText(n) {
  if (n < MB) return `${Math.max(n ? 1 : 0, Math.round(n / 1024))} КБ`;
  if (n < 1024 * MB) return `${Math.round(n / MB)} МБ`;
  return `${(n / 1024 / MB).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ГБ`;
}

// Место семьи: { used, quota } в байтах (quota null — без предела).
export async function space(t = currentTenant()) {
  const [r] = await q(`select ${USED} as used`);
  return { used: Number(r.used), quota: t.quota_mb ? t.quota_mb * MB : null };
}

// Перед загрузкой файла: место семьи закончилось — отказ. Файл, который уже грузится, предел может чуть превысить.
export async function checkSpace() {
  const t = currentTenant();
  if (!t.quota_mb) return;
  const { used, quota } = await space(t);
  if (used >= quota) {
    throw new HttpError(413, `Место на сервере для фото и записей этого дерева закончилось: занято ${sizeText(used)} из ${sizeText(quota)}. `
      + 'Сообщите владельцу дерева: место прибавляет хозяин сервера.');
  }
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const newId = () => [...crypto.randomBytes(10)].map((b) => ALPHABET[b & 31]).join('');

// Новая пустая семья: схема со всеми таблицами, название дерева — всё одной транзакцией. Возвращает семью из списка.
// Семей, кроме главной, не больше config.maxFamilies: счёт — под блокировкой, две ссылки разом лишнюю не создадут.
export async function createTenant({ title, createdBy = '', linkLabel = '', quotaMb = config.familyQuotaMb }) {
  const id = newId();
  const schema = `f_${id}`;
  const client = await pool.connect();
  let broken;
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('drevo-tenants'))");
    const [{ n }] = (await client.query('select count(*)::int as n from core.tenants where not main')).rows;
    if (n >= config.maxFamilies) throw new HttpError(409, `На сервере уже ${config.maxFamilies} семей — больше завести нельзя. Напишите тому, кто дал ссылку.`);
    await client.query(`create schema ${schema}`);
    await client.query(`set search_path to ${schema}`);
    client.drevoSchema = schema;
    await applyMigrations(client, { whole: true });
    await client.query("update settings set value = to_jsonb($1::text) where key = 'title'", [title]);
    await client.query(
      'insert into core.tenants (id, schema, title, created_by, link_label, quota_mb) values ($1, $2, $3, $4, $5, $6)',
      [id, schema, title, createdBy, linkLabel, quotaMb || null],
    );
    await client.query('commit');
  } catch (e) {
    broken = await client.query('rollback').then(() => undefined, (err) => err);
    // Откат вернул и прежнюю схему подключения: пусть следующий запрос поставит её заново.
    client.drevoSchema = undefined;
    throw e;
  } finally {
    client.release(broken);
  }
  await loadTenants();
  const t = tenantById(id);
  await ensureDirs(t);
  return t;
}
