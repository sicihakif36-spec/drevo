// Обновление с первой версии (коммит 8b36643, стоит у владельца с настоящими данными) на текущую.
// Данные набраны первой версией через её API (tools/upgrade/check.sh): люди и связи, правки и откаты,
// удаления и возвраты, заменённые и убранные фото, приглашения, входы с нескольких телефонов, название дерева.
// Здесь база собирается из её схемы и этих данных, затем идут все миграции, как при запуске нового кода.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { config } from '../src/config.js';

const FIX = new URL('./fixtures/v1/', import.meta.url);
const state = JSON.parse(fs.readFileSync(new URL('state.json', FIX)));
const { cookies, invites, ids, photos } = state;
const H = { 'x-drevo': '1' };
const MIN = 60000;
let app;
let now = null;
const sent = [];
const push = { send: async (sub, payload) => sent.push(JSON.parse(payload)), clock: () => now || new Date(), timer: false };

const raw = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });
async function call(cookie, method, url, payload) {
  const r = await raw(cookie, method, url, payload);
  assert.equal(r.statusCode, 200, `${method} ${url}: ${r.body}`);
  return r.json();
}

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  // Схема первой версии: 001 с тех пор не менялась.
  await pool.query(fs.readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8'));
  await pool.query("create table schema_migrations (name text primary key, applied_at timestamptz not null default now()); insert into schema_migrations (name) values ('001_init.sql')");
  // Данные — как в дампе; у users и persons взаимные ключи, поэтому без проверки порядка.
  const client = await pool.connect();
  try {
    await client.query("set session_replication_role = replica; delete from settings;");
    await client.query(fs.readFileSync(new URL('data.sql', FIX), 'utf8'));
    await client.query('set session_replication_role = default');
  } finally { client.release(); }
  // Набор сделан однажды; приглашения к этому дню могли истечь — сдвигаем время как при свежих данных.
  await pool.query("update invites set expires_at = now() + interval '10 days' where used_at is null");
  const media = path.join(config.dataDir, 'media');
  fs.mkdirSync(media, { recursive: true });
  for (const f of fs.readdirSync(new URL('media/', FIX))) fs.copyFileSync(new URL(`media/${f}`, FIX), path.join(media, f));

  await migrate(() => {});
  app = await buildApp({ logger: false, push });
});
after(async () => { await app.close(); await pool.end(); });

test('вошедшие остаются вошедшими, роли на месте; кто правит — придумывает пароль', async () => {
  assert.equal((await call(cookies.owner, 'GET', '/api/me')).user.role, 'owner');
  assert.equal((await call(cookies.ownerTablet, 'GET', '/api/me')).user.role, 'owner');
  const e = (await call(cookies.editor, 'GET', '/api/me')).user;
  assert.equal(e.name, 'Елена');
  assert.equal(e.role, 'editor');
  assert.equal(e.needs_password, true);
  const g = (await call(cookies.guest, 'GET', '/api/me')).user;
  assert.equal(g.role, 'viewer');
  assert.ok(!g.needs_password);
  // Без пароля дерево видно, но правка закрыта; придумали пароль — правят, как раньше, и на других устройствах тоже.
  assert.ok((await call(cookies.editor, 'GET', '/api/tree')).persons.length);
  const r = await raw(cookies.editor, 'PATCH', `/api/persons/${ids.dad}`, { occupation: 'кузнец' });
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().password, true);
  await call(cookies.editor, 'POST', '/api/me/password', { password: 'пароль-елены' });
  await call(cookies.owner, 'POST', '/api/me/password', { password: 'пароль-владельца' });
  assert.equal((await call(cookies.ownerTablet, 'GET', '/api/me')).user.needs_password, undefined);
  // С новым кодом вошедший может подписаться на уведомления: подписка держится за его вход.
  await call(cookies.editor, 'PUT', '/api/push/subscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/elena', keys: { p256dh: 'BKey', auth: 'auth' } });
  await call(cookies.owner, 'PUT', '/api/push/subscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/owner', keys: { p256dh: 'BKey', auth: 'auth' } });
});

test('уведомления не разошлют старые правки, лента не считает их новыми', async () => {
  sent.length = 0;
  now = new Date(Date.now() + 15 * MIN);
  await app.push.tick();
  await app.push.settled();
  now = null;
  assert.deepEqual(sent.filter((m) => m.title === 'Правки в дереве'), []);
  for (const c of [cookies.owner, cookies.editor, cookies.guest]) {
    const feed = await call(c, 'GET', '/api/feed');
    assert.ok(feed.items.length > 0);
    assert.deepEqual(feed.items.filter((i) => i.fresh), []);
  }
});

test('дерево, карточки и название на месте; гость не видит данных живых', async () => {
  const tree = await call(cookies.owner, 'GET', '/api/tree');
  assert.equal(tree.persons.length, state.expect.persons);
  assert.equal(tree.families.length, state.expect.families);
  assert.equal(tree.children.length, state.expect.children);
  assert.equal(tree.settings.title, state.expect.title);
  const dad = tree.persons.find((p) => p.id === ids.dad);
  assert.equal(dad.birth_place, 'деревня Горки, Старицкий район');
  assert.equal(dad.occupation, 'тракторист', 'отменённая правка Елены не вернулась');
  assert.equal(dad.photo_id, photos.dadNew);
  assert.ok(tree.persons.some((p) => p.id === ids.uncle), 'возвращённый после удаления на месте');
  assert.ok(!tree.persons.some((p) => p.id === ids.wrong || p.id === ids.lonely));
  assert.ok(tree.children.some((c) => c.child_id === ids.cousin));

  const guest = await call(cookies.guest, 'GET', '/api/tree');
  const mom = guest.persons.find((p) => p.id === ids.mom);
  assert.equal(mom.birth_date, '');
  assert.equal(mom.notes, '');
  assert.equal(guest.persons.find((p) => p.id === ids.gf).death_place, 'Тверь');
});

test('фото в альбомах: заменённое — в альбоме, убранное — удалённым, и его можно вернуть', async () => {
  const album = async (id, cookie = cookies.owner) => (await call(cookie, 'GET', `/api/persons/${id}/media`)).map((m) => m.id);
  assert.deepEqual((await album(ids.dad)).sort(), [photos.dadOld, photos.dadNew].sort());
  assert.deepEqual(await album(ids.mom), []);
  assert.deepEqual(await album(ids.sister), [photos.sisterSecond]);
  assert.deepEqual(await album(ids.gf), [photos.gf]);
  // Гость видит фото ушедшего, но не живого.
  assert.deepEqual(await album(ids.gf, cookies.guest), [photos.gf]);
  assert.deepEqual(await album(ids.dad, cookies.guest), []);
  const file = await raw(cookies.owner, 'GET', `/api/media/${photos.gf}`);
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'image/jpeg');
  assert.equal((await raw(cookies.guest, 'GET', `/api/media/${photos.dadNew}`)).statusCode, 404);

  // Убранное фото — удаление в журнале от имени того, кто убрал; «Вернуть» кладёт его в альбом.
  const [del] = await q("select id, user_id from changes where entity = 'media' and action = 'delete' and entity_id = $1", [photos.momRemoved]);
  assert.ok(del);
  await call(cookies.owner, 'POST', `/api/changes/${del.id}/revert`);
  assert.deepEqual(await album(ids.mom), [photos.momRemoved]);
});

test('история правок читается и откатывается, в том числе записи первой версии', async () => {
  const ops = await call(cookies.owner, 'GET', '/api/changes');
  assert.ok(ops.length > 20);
  for (const op of ops) assert.ok(op.op && op.entries.length && op.user_name, JSON.stringify(op));
  // Добавление отца одним действием: человек, семья, связь.
  const addDad = ops.find((o) => o.entries.some((e) => e.entity === 'person' && e.action === 'create' && e.entity_id === ids.dad));
  assert.ok(addDad.entries.length >= 3, 'записи одного действия первой версии собраны вместе');
  assert.ok((await call(cookies.owner, 'GET', `/api/persons/${ids.dad}/history`)).length >= 4);

  // Вернуть удалённого насовсем в первой версии; его семья тогда разобралась — человек возвращается без неё.
  const [wrongDel] = await q("select id from changes where entity = 'person' and action = 'delete' and entity_id = $1", [ids.wrong]);
  await call(cookies.owner, 'POST', `/api/changes/${wrongDel.id}/revert`);
  await call(cookies.editor, 'POST', `/api/changes/${state.delLonely}/revert`);
  let tree = await call(cookies.owner, 'GET', '/api/tree');
  assert.ok(tree.persons.some((p) => p.id === ids.wrong));
  assert.ok(tree.persons.some((p) => p.id === ids.lonely));
  // Старую правку можно отменить, отмену — вернуть.
  const upd = ops.find((o) => o.entries.some((e) => e.entity === 'person' && e.action === 'update' && e.after?.birth_place === 'деревня Горки, Старицкий район'));
  await call(cookies.owner, 'POST', `/api/changes/${upd.id}/revert`);
  tree = await call(cookies.owner, 'GET', '/api/tree');
  assert.equal(tree.persons.find((p) => p.id === ids.dad).birth_place, 'деревня Горки');
  const again = (await call(cookies.owner, 'GET', '/api/changes'))[0];
  await call(cookies.owner, 'POST', `/api/changes/${again.id}/revert`);
  tree = await call(cookies.owner, 'GET', '/api/tree');
  assert.equal(tree.persons.find((p) => p.id === ids.dad).birth_place, 'деревня Горки, Старицкий район');
  // Отменить добавление человека первой версии целиком.
  const addPavel = ops.find((o) => o.entries.some((e) => e.entity === 'person' && e.action === 'create' && e.after.given === 'Павел'));
  await call(cookies.owner, 'POST', `/api/changes/${addPavel.id}/revert`);
  assert.ok(!(await call(cookies.owner, 'GET', '/api/tree')).persons.some((p) => p.id === addPavel.entries[0].entity_id));
  // Семью дяди первая версия при его удалении стёрла без записи в журнал: такое добавление не отменить, но ответ понятный.
  const addCousin = ops.find((o) => o.entries.some((e) => e.entity === 'person' && e.action === 'create' && e.entity_id === ids.cousin));
  const r = await raw(cookies.owner, 'POST', `/api/changes/${addCousin.id}/revert`);
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error, 'Этой семьи уже нет в дереве');
});

test('неиспользованные приглашения работают, использованное — нет', async () => {
  const redeem = (token, name) => app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token, name } });
  const tanya = await redeem(invites.unusedEditor, 'Татьяна');
  assert.equal(tanya.statusCode, 200, tanya.body);
  const c = tanya.cookies.map((x) => `${x.name}=${x.value}`).join('; ');
  assert.equal((await call(c, 'GET', '/api/me')).user.role, 'editor');
  assert.equal((await redeem(invites.unusedViewer, 'Соседка')).statusCode, 200);
  assert.equal((await redeem(invites.usedTwice)).statusCode, 400);
  // Ссылка для входа Елены с нового телефона — в её же учётную запись; пароль она уже придумала — спросят его.
  const r = await redeem(invites.relink);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().password, true);
  const elena = r.cookies.map((x) => `${x.name}=${x.value}`).join('; ');
  assert.equal((await call(elena, 'GET', '/api/me')).pending.name, 'Елена');
  await call(elena, 'POST', '/api/login/password', { password: 'пароль-елены' });
  assert.equal((await call(elena, 'GET', '/api/me')).user.id, ids.elena);
});
