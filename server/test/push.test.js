// Уведомления: кому что уходит, сводка правок, даты в 9:00 по Москве. Отправитель и часы подменены.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { createInvite } from '../src/auth.js';
import { digestText } from '../src/push.js';

const H = { 'x-drevo': '1' };
const MIN = 60000;
let app;
let now = null; // null — настоящее время
let sent = []; // { to, msg }
const gone = new Set(); // телефоны, которых больше нет: сервис отвечает 410

async function send(sub, payload, options) {
  assert.ok(options.vapidDetails.privateKey && sub.keys.p256dh && sub.keys.auth);
  if (gone.has(sub.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
  sent.push({ to: sub.endpoint.split('/').at(-1), msg: JSON.parse(payload) });
}
const push = { send, clock: () => now || new Date(), timer: false };

async function login(appX, role, name) {
  const { token } = await createInvite({ role });
  const r = await appX.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token, name } });
  assert.equal(r.statusCode, 200, r.body);
  return r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
const raw = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });
async function call(cookie, method, url, payload) {
  const r = await raw(cookie, method, url, payload);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const endpoint = (name) => `https://fcm.googleapis.com/fcm/send/${name}`;
const subscribe = (cookie, name) => call(cookie, 'PUT', '/api/push/subscription', { endpoint: endpoint(name), keys: { p256dh: 'BKey', auth: 'auth' } });
const to = (name) => sent.filter((s) => s.to === name).map((s) => s.msg);
async function settle() {
  await app.push.settled();
  await app.push.settled();
}
const reset = () => { sent = []; };

let owner;
let elena;
let guest;

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push });
  owner = await login(app, 'owner', 'Анна');
  elena = await login(app, 'editor', 'Елена');
  guest = await login(app, 'viewer', 'Гость');
  for (const [c, n] of [[owner, 'owner'], [elena, 'elena'], [guest, 'guest']]) await subscribe(c, n);
});
after(async () => { await app.close(); await pool.end(); });

test('ключ, подписка и настройки', async () => {
  const { key } = await call(guest, 'GET', '/api/push/key');
  assert.match(key, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal((await call(owner, 'GET', '/api/push/key')).key, key, 'ключ один и тот же');
  // Закрытый ключ не уходит вместе с настройками дерева.
  const [{ private_key: secret }] = await q('select private_key from push_keys');
  assert.ok(!(await raw(owner, 'GET', '/api/tree')).body.includes(secret));
  assert.ok(!(await raw(owner, 'GET', '/api/push/key')).body.includes(secret));

  assert.equal((await app.inject({ url: '/api/push/key' })).statusCode, 401);
  for (const bad of [{ endpoint: 'http://fcm.googleapis.com/x', keys: { p256dh: 'k', auth: 'a' } },
    { endpoint: 'https://127.0.0.1/x', keys: { p256dh: 'k', auth: 'a' } },
    { endpoint: 'https://evil.example/googleapis.com', keys: { p256dh: 'k', auth: 'a' } },
    { endpoint: endpoint('x'), keys: {} }, { endpoint: 42 }]) {
    assert.equal((await raw(owner, 'PUT', '/api/push/subscription', bad)).statusCode, 400, JSON.stringify(bad));
  }

  assert.deepEqual(await call(guest, 'GET', '/api/push/settings'), { comments: true, edits: true, dates: true });
  assert.deepEqual(await call(guest, 'PATCH', '/api/push/settings', { dates: false, edits: 'да' }), { comments: true, edits: true, dates: false });
  await call(guest, 'PATCH', '/api/push/settings', { dates: true });

  // Проверочное — только на этот телефон.
  const g2 = await login(app, 'viewer', 'Гость 2');
  assert.equal((await raw(g2, 'POST', '/api/push/test', {})).statusCode, 400);
  await subscribe(g2, 'g2');
  await subscribe(g2, 'g2b');
  reset();
  assert.deepEqual(await call(g2, 'POST', '/api/push/test', { endpoint: endpoint('g2') }), { sent: 1 });
  assert.deepEqual(sent.map((s) => s.to), ['g2']);
  assert.equal(sent[0].msg.url, '/#/notify');
  // Чужую подписку удалить нельзя, свою — можно.
  await call(owner, 'DELETE', '/api/push/subscription', { endpoint: endpoint('g2b') });
  assert.equal((await q('select count(*) from push_subs where user_id = (select user_id from push_subs where endpoint = $1)', [endpoint('g2')]))[0].count, '2');
  await call(g2, 'DELETE', '/api/push/subscription', { endpoint: endpoint('g2b') });
  // Выход с телефона убирает его подписку.
  await call(g2, 'POST', '/api/logout');
  assert.equal((await q('select count(*) from push_subs where endpoint like $1', ['%/g2%']))[0].count, '0');
});

let dead;
let living;

test('комментарий: всем, кроме автора; гостю — не у живых; переключатель и отключённые', async () => {
  dead = await call(owner, 'POST', '/api/persons', { person: { surname: 'Смирнов', given: 'Иван', patronymic: 'Фёдорович', sex: 'M', living: false, birth_date: '1880', death_date: '1942' } });
  living = await call(owner, 'POST', '/api/persons', { person: { surname: 'Смирнова', given: 'Вера', sex: 'F', birth_date: '1990' } });
  const petr = await login(app, 'editor', 'Пётр');
  await subscribe(petr, 'petr');
  reset();

  await call(elena, 'POST', `/api/persons/${dead.id}/comments`, { body: 'Помню, как дед Иван держал пасеку у самой реки, и мёд у него был лучший в округе, а по праздникам он всех угощал. '.repeat(3) });
  await settle();
  assert.deepEqual(sent.map((s) => s.to).sort(), ['guest', 'owner', 'petr']);
  const [m] = to('owner');
  assert.equal(m.title, 'Елена — в обсуждении: Смирнов Иван Фёдорович');
  assert.ok(m.body.startsWith('Помню, как дед Иван') && m.body.length <= 140 && m.body.endsWith('…'));
  assert.equal(m.url, `/#/person/${dead.id}?talk=1`);

  reset();
  await call(elena, 'POST', `/api/persons/${living.id}/comments`, { body: 'Её новый телефон 8-900' });
  await settle();
  assert.deepEqual(sent.map((s) => s.to).sort(), ['owner', 'petr'], 'гость не узнаёт об обсуждении живых');

  // Переключатель выключен — не приходит; отключённый человек — не приходит, подписки убраны.
  await call(owner, 'PATCH', '/api/push/settings', { comments: false });
  const [{ id: petrId }] = await q("select id from users where name = 'Пётр'");
  await call(owner, 'PATCH', `/api/users/${petrId}`, { disabled: true });
  assert.equal((await q('select count(*) from push_subs where user_id = $1', [petrId]))[0].count, '0');
  reset();
  await call(elena, 'POST', `/api/persons/${dead.id}/comments`, { body: 'Ещё вспомнила' });
  await settle();
  assert.deepEqual(sent.map((s) => s.to), ['guest']);
  await call(owner, 'PATCH', '/api/push/settings', { comments: true });

  // Проход расписания не повторяет уже разосланное.
  reset();
  await app.push.tick();
  assert.deepEqual(sent, []);
});

test('комментарий, о котором не успели сообщить, уходит при следующем проходе один раз', async () => {
  await q("insert into comments (person_id, user_id, body) select $1, id, 'Мимо сервера' from users where name = 'Елена'", [dead.id]);
  reset();
  await app.push.tick();
  await app.push.tick();
  assert.deepEqual(sent.map((s) => s.to).sort(), ['guest', 'owner']);
});

test('сервис ответил 410 — подписка удалена', async () => {
  const k = await login(app, 'viewer', 'Старый телефон');
  await subscribe(k, 'old');
  gone.add(endpoint('old'));
  await call(elena, 'POST', `/api/persons/${dead.id}/comments`, { body: 'Проверка' });
  await settle();
  assert.equal((await q('select count(*) from push_subs where endpoint = $1', [endpoint('old')]))[0].count, '0');
});

test('правки: одна сводка по автору после 10 минут тишины, без отменённого, без своего', async () => {
  // Правки Анны из прошлых проверок — уже разосланы.
  now = new Date(Date.now() + 11 * MIN);
  await app.push.tick();
  now = null;
  const a = await call(elena, 'POST', '/api/persons', { person: { given: 'Пётр', sex: 'M' }, relation: { to: living.id, type: 'father' } });
  await call(elena, 'POST', '/api/persons', { person: { given: 'Мария', sex: 'F' }, relation: { to: living.id, type: 'mother' } });
  await call(elena, 'POST', '/api/persons', { person: { given: 'Сын', sex: 'M' }, relation: { to: living.id, type: 'child' } });
  await call(elena, 'PATCH', `/api/persons/${a.id}`, { birth_place: 'Тверь', version: a.version });
  // Добавила и сама же отменила — не новость.
  await call(elena, 'POST', '/api/persons', { person: { given: 'Лишний' } });
  const [op] = await call(elena, 'GET', '/api/changes');
  await call(elena, 'POST', `/api/changes/${op.id}/revert`);
  reset();

  await app.push.tick();
  now = new Date(Date.now() + 5 * MIN);
  await app.push.tick();
  assert.deepEqual(sent, [], 'пока правки идут — ждём');

  now = new Date(Date.now() + 11 * MIN);
  await app.push.tick();
  await app.push.tick();
  assert.deepEqual(sent.map((s) => s.to).sort(), ['guest', 'owner'], 'одна сводка каждому, автору — нет');
  const [m] = to('guest');
  assert.equal(m.body, 'Елена добавил(а) 3 человек, изменил(а) 1 карточку');
  assert.equal(m.url, '/#/feed');
  assert.ok(!JSON.stringify(m).includes('Тверь') && !JSON.stringify(m).includes('Пётр'));

  // Новая правка — новая сводка, только о ней. Автор привязан к карточке — глагол по полу.
  const me = await call(elena, 'POST', '/api/persons', { person: { given: 'Елена', sex: 'F' } });
  await call(elena, 'PATCH', '/api/me', { person_id: me.id });
  await call(elena, 'PATCH', `/api/persons/${dead.id}`, { occupation: 'пасечник', version: (await call(owner, 'GET', '/api/tree')).persons.find((p) => p.id === dead.id).version });
  reset();
  now = null;
  await app.push.tick();
  assert.deepEqual(sent, []);
  now = new Date(Date.now() + 11 * MIN);
  await app.push.tick();
  assert.equal(to('owner')[0].body, 'Елена добавила 1 человека, изменила 1 карточку');
  now = null;
});

test('подписи сводки', () => {
  const e = (op, entity, action, extra = {}) => ({ op, entity, action, entity_id: extra.id || op, before: extra.before || null, after: extra.after || null });
  assert.equal(digestText('Елена', 'F', [e(1, 'person', 'create'), e(1, 'family', 'add_child'), e(2, 'person', 'create'),
    e(3, 'media', 'add', { after: { kind: 'photo' } }), e(3, 'person', 'photo', { after: { photo_id: 'x' } }), e(3, 'media', 'add', { after: { kind: 'doc' } }),
    e(4, 'media', 'add', { after: { kind: 'photo' } })], [1, 2, 3, 4]),
  'Елена добавила 2 человек, 2 фото и 1 документ');
  assert.equal(digestText('Елена', 'F', [e(1, 'person', 'photo', { after: { photo_id: 'x' } }), e(2, 'media', 'tag', { id: 'm' }),
    e(3, 'media', 'delete', { before: { kind: 'doc' } }), e(3, 'person', 'photo', { after: { photo_id: null } })], [1, 2, 3]),
  'Елена изменила 1 карточку и 1 фото, удалила 1 документ');
  assert.equal(digestText('Олег', 'M', [e(1, 'family', 'set_partner'), e(2, 'person', 'delete')], [1, 2]), 'Олег изменил 1 связь, удалил 1 человека');
  assert.equal(digestText('Ира', 'U', [e(1, 'family', 'update'), e(2, 'family', 'update')], [1, 2]), 'Ира изменил(а) 2 связи');
});

test('даты: в 9:00 по Москве, один раз в день, гостю — без живых; при запуске после 9:00', async () => {
  // 15 марта 2026: Вере 36 лет (живая), деду Ивану 146 лет со дня рождения.
  await call(owner, 'PATCH', `/api/persons/${living.id}`, { birth_date: '15.03.1990', version: (await call(owner, 'GET', '/api/tree')).persons.find((p) => p.id === living.id).version });
  const v = (await call(owner, 'GET', '/api/tree')).persons.find((p) => p.id === dead.id).version;
  await call(owner, 'PATCH', `/api/persons/${dead.id}`, { birth_date: '15.03.1880', version: v });
  await call(guest, 'PATCH', '/api/push/settings', { dates: true });
  await call(elena, 'PATCH', '/api/push/settings', { dates: false });
  reset();

  now = new Date('2026-03-15T05:59:00Z'); // 8:59 по Москве
  await app.push.tick();
  assert.deepEqual(sent.filter((s) => s.msg.tag?.startsWith('dates')), []);

  now = new Date('2026-03-15T06:00:00Z');
  await app.push.tick();
  await app.push.tick();
  const dates = sent.filter((s) => s.msg.tag === 'dates-2026-03-15');
  assert.deepEqual(dates.map((s) => s.to).sort(), ['guest', 'owner'], 'по одному, Елена выключила');
  assert.deepEqual(to('owner').at(-1), {
    title: 'Памятные даты сегодня',
    body: 'Сегодня 146 лет со дня рождения: Иван Смирнов\nСегодня день рождения: Вера Смирнова, 36 лет',
    url: '/#/feed',
    tag: 'dates-2026-03-15',
  });
  assert.deepEqual(to('guest').at(-1), { title: 'Сегодня 146 лет со дня рождения: Иван Смирнов', body: '', url: `/#/person/${dead.id}`, tag: 'dates-2026-03-15' });

  // Перезапуск сервера в тот же день — второй раз не уходит.
  reset();
  const again = await buildApp({ logger: false, push: { ...push, timer: true } });
  await again.ready();
  await again.push.tick();
  await again.close();
  assert.deepEqual(sent, []);

  // Сервер был выключен в 9:00 — при запуске в тот же день.
  now = new Date('2026-03-16T10:30:00Z');
  await call(owner, 'PATCH', `/api/persons/${dead.id}`, { birth_date: '16.03.1880', version: v + 1 });
  reset();
  const later = await buildApp({ logger: false, push: { ...push, timer: true } });
  await later.ready();
  await later.push.tick();
  await later.close();
  assert.deepEqual(sent.map((s) => s.to).sort(), ['guest', 'owner']);
  assert.equal(to('owner')[0].title, 'Сегодня 146 лет со дня рождения: Иван Смирнов');
  now = null;
});
