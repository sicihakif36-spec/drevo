// Роль «Родственник»: видит всё, как участник (даты и места живых, ленту, историю правок), но дерево не правит —
// ни один маршрут записи его не пускает; обсуждать может. Приглашение и смена роли.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { createInvite } from '../src/auth.js';

let app;
const H = { 'x-drevo': '1' };
let owner;
let relative;
let guest;
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

async function login(role) {
  const { token } = await createInvite({ role, label: role });
  const r = await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token } });
  assert.equal(r.statusCode, 200, r.body);
  return r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
const call = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });
const json = async (...args) => {
  const r = await call(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

// Все маршруты записи сервера — прямо из исходников, чтобы новый маршрут не остался без проверки.
// -> [{ method, url, role }]: role — кого пускает need(…), null — без проверки входа (вход по приглашению, выход).
function writeRoutes() {
  const files = [...fs.readdirSync(path.join(src, 'routes')).map((f) => path.join(src, 'routes', f)), path.join(src, 'push.js'), path.join(src, 'events.js')];
  const out = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/app\.(post|put|patch|delete)\('([^']+)'(?:, \{ preHandler: need\('(\w+)'\)[^}]*\})?/g)) {
      out.push({ method: m[1].toUpperCase(), url: m[2], role: m[3] || null });
    }
  }
  return out;
}

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await login('owner');
  relative = await login('relative');
  guest = await login('viewer');
});
after(async () => { await app.close(); await pool.end(); });

test('родственник видит данные живых, ленту и историю правок', async () => {
  const anna = await json(owner, 'POST', '/api/persons', { person: { given: 'Анна', sex: 'F', living: true, birth_date: '12.05.1990', birth_place: 'г. Тверь', notes: 'телефон' } });
  await json(owner, 'PATCH', `/api/persons/${anna.id}`, { occupation: 'врач' });

  const mine = (await json(relative, 'GET', '/api/tree')).persons.find((p) => p.id === anna.id);
  assert.deepEqual([mine.birth_date, mine.birth_place, mine.notes, mine.hidden], ['12.05.1990', 'г. Тверь', 'телефон', undefined]);
  assert.equal((await json(guest, 'GET', '/api/tree')).persons.find((p) => p.id === anna.id).hidden, true);
  assert.equal((await json(relative, 'GET', '/api/tree')).me.role, 'relative');

  // История правок — со старыми значениями, как у участника.
  const hist = await json(relative, 'GET', `/api/persons/${anna.id}/history`);
  assert.deepEqual(hist[0].entries[0].after, { occupation: 'врач' });
  assert.ok((await json(relative, 'GET', '/api/changes')).length >= 2);
  for (const url of ['/api/changes', `/api/persons/${anna.id}/history`]) assert.equal((await call(guest, 'GET', url)).statusCode, 403);

  // Лента и карточка места — полные.
  const feed = await json(relative, 'GET', '/api/feed');
  const e = feed.items.flatMap((i) => i.entries || []).find((x) => x.action === 'update');
  assert.deepEqual(e.after, { occupation: 'врач' });
  assert.equal((await json(relative, 'GET', '/api/places/card?text=г.%20Тверь')).born.length, 1);
  assert.equal((await json(guest, 'GET', '/api/places/card?text=г.%20Тверь')).born.length, 0);
  // GEDCOM — с датами живых.
  assert.match((await call(relative, 'GET', '/api/export.ged')).body, /2 DATE 12 MAY 1990/);
});

test('родственник ничего не правит: каждый маршрут записи — 403, кроме обсуждения и своих настроек', async () => {
  const id = (await json(owner, 'GET', '/api/tree')).persons[0].id;
  const routes = writeRoutes();
  assert.ok(routes.length > 40, `маршрутов записи: ${routes.length}`);
  const closed = routes.filter((r) => ['editor', 'owner'].includes(r.role));
  assert.ok(closed.some((r) => r.url === '/api/places') && closed.some((r) => r.url === '/api/changes/:id/revert'));
  for (const r of closed) {
    const url = r.url.replace(/:\w+/g, id);
    for (const [who, c] of [['родственник', relative], ['гость', guest]]) {
      const res = await call(c, r.method, url, {});
      assert.equal(res.statusCode, 403, `${who}: ${r.method} ${r.url} — ${res.statusCode} ${res.body}`);
    }
  }
  // Открытые родственнику маршруты записи — только эти. Публичные маршруты анкеты пускают без входа, только по её токену
  // (test/surveys.test.js), — и ничего не меняют в дереве.
  const open = routes.filter((r) => !['editor', 'owner'].includes(r.role)).map((r) => `${r.method} ${r.url}`).sort();
  const survey = ['DELETE /api/survey/photos/:id', 'PATCH /api/survey/photos/:id', 'POST /api/survey/photos', 'POST /api/survey/submit', 'PUT /api/survey'];
  assert.deepEqual(open, [
    'DELETE /api/comments/:id', 'DELETE /api/push/subscription', 'PATCH /api/comments/:id', 'PATCH /api/me', 'PATCH /api/push/settings',
    'POST /api/feed/seen', 'POST /api/invites/redeem', 'POST /api/logout', 'POST /api/persons/:id/comments', 'POST /api/push/test',
    'PUT /api/push/subscription', ...survey,
  ].sort());
  // Без токена анкеты они ничего не делают.
  for (const r of routes.filter((x) => survey.includes(`${x.method} ${x.url}`))) {
    const res = await call(relative, r.method, r.url.replace(/:\w+/g, id), {});
    assert.equal(res.statusCode, 404, `${r.method} ${r.url} — ${res.statusCode} ${res.body}`);
  }
  // Ничего не изменилось: в журнале только правки владельца.
  const ops = await json(owner, 'GET', '/api/changes');
  assert.ok(ops.every((o) => o.user_name === 'owner'));
});

test('родственник обсуждает: пишет, правит и удаляет своё, чужое — нет', async () => {
  const id = (await json(owner, 'GET', '/api/tree')).persons[0].id;
  const c = await json(relative, 'POST', `/api/persons/${id}/comments`, { body: 'Помню, как Анна пекла пироги' });
  assert.equal(c.user_name, 'relative');
  assert.equal((await json(relative, 'PATCH', `/api/comments/${c.id}`, { body: 'Помню её пироги' })).body, 'Помню её пироги');
  const theirs = await json(owner, 'POST', `/api/persons/${id}/comments`, { body: 'Да' });
  assert.equal((await call(relative, 'PATCH', `/api/comments/${theirs.id}`, { body: 'Нет' })).statusCode, 403);
  assert.equal((await call(relative, 'DELETE', `/api/comments/${theirs.id}`)).statusCode, 403);
  await json(relative, 'DELETE', `/api/comments/${c.id}`);
  assert.deepEqual((await json(owner, 'GET', `/api/persons/${id}/comments`)).map((x) => x.body), ['Да']);
  // Гость по-прежнему не пишет.
  assert.equal((await call(guest, 'POST', `/api/persons/${id}/comments`, { body: 'Привет' })).statusCode, 403);
});

test('приглашение с ролью «Родственник» и смена роли', async () => {
  const inv = await json(owner, 'POST', '/api/invites', { role: 'relative', label: 'Бабушка Валя' });
  assert.equal((await json(owner, 'GET', '/api/invites')).find((i) => i.label === 'Бабушка Валя').role, 'relative');
  const r = await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token: inv.url.split('/').pop() } });
  assert.equal(r.statusCode, 200, r.body);
  const valya = (await json(owner, 'GET', '/api/users')).find((u) => u.name === 'Бабушка Валя');
  assert.equal(valya.role, 'relative');

  await json(owner, 'PATCH', `/api/users/${valya.id}`, { role: 'editor' });
  await json(owner, 'PATCH', `/api/users/${valya.id}`, { role: 'relative' });
  assert.equal((await json(owner, 'GET', '/api/users')).find((u) => u.id === valya.id).role, 'relative');
  assert.equal((await call(owner, 'PATCH', `/api/users/${valya.id}`, { role: 'rodnya' })).statusCode, 400);
  assert.equal((await call(owner, 'POST', '/api/invites', { role: 'rodnya' })).statusCode, 400);
  assert.equal((await call(relative, 'POST', '/api/invites', { role: 'relative' })).statusCode, 403);
});
