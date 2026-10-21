// Обновления у всех сразу: поток /api/events на настоящем сервере и настоящей PostgreSQL.
import http from 'node:http';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { createInvite } from '../src/auth.js';

let app;
let base;
const H = { 'x-drevo': '1' };

async function login(role) {
  const { token } = await createInvite({ role, label: role });
  const r = await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token } });
  assert.equal(r.statusCode, 200, r.body);
  return r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function call(cookie, method, url, payload) {
  const r = await app.inject({ method, url, payload, headers: { ...H, cookie } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}

// Открыть поток настоящим HTTP-запросом и копить события; got(kind) — что пришло, wait(kind) — дождаться.
async function stream(cookie) {
  const res = await new Promise((ok, fail) => http.get(`${base}/api/events`, { headers: { cookie }, agent: false }, ok).on('error', fail));
  const events = [];
  let buf = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const kind = block.match(/^event: (.+)$/m)?.[1];
      if (kind) events.push({ kind, data: JSON.parse(block.match(/^data: (.*)$/m)[1]) });
    }
  });
  let ended = false;
  res.on('end', () => { ended = true; });
  const count = (kind) => events.filter((e) => e.kind === kind).length;
  return {
    status: res.statusCode,
    type: res.headers['content-type'],
    events,
    got: (kind) => events.filter((e) => e.kind === kind),
    async wait(kind, n = 1, ms = 2500) {
      for (let t = 0; t < ms / 50 && count(kind) < n; t++) await sleep(50);
      assert.ok(count(kind) >= n, `нет события ${kind}`);
    },
    // Сервер сам закрыл поток.
    async closed(ms = 2500) {
      for (let t = 0; t < ms / 50 && !ended; t++) await sleep(50);
      return ended;
    },
    close: () => res.destroy(),
  };
}

const listeners = async () => Number((await q("select count(*) from pg_stat_activity where query = 'listen drevo'"))[0].count);

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, eventsPing: 200, push: { timer: false } });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app.close(); await pool.end(); });

test('без входа поток закрыт', async () => {
  assert.equal((await app.inject({ url: '/api/events' })).statusCode, 401);
});

test('правка дерева и комментарий приходят всем; гостю — без обсуждений живых', async () => {
  const owner = await login('owner');
  const guest = await login('viewer');
  const so = await stream(owner);
  const sg = await stream(guest);
  assert.equal(so.status, 200);
  assert.match(so.type, /text\/event-stream/);
  assert.equal(await listeners(), 1, 'одно подключение LISTEN на всех');

  // Человек со связью — несколько записей журнала, но одно событие.
  const gone = await call(owner, 'POST', '/api/persons', { person: { given: 'Прадед', sex: 'M', living: false, birth_date: '1900', death_date: '1970' } });
  const living = await call(owner, 'POST', '/api/persons', { person: { given: 'Внучка', sex: 'F', birth_date: '2000' }, relation: { to: gone.id, type: 'child' } });
  await so.wait('tree');
  await sg.wait('tree');
  await sleep(500);
  assert.ok(so.got('tree').length <= 2, 'события одного действия склеены');
  assert.deepEqual(so.got('tree')[0].data, {});

  // Правка карточки и откат — тоже события дерева.
  const before = so.got('tree').length;
  const v = (await call(owner, 'GET', '/api/tree')).persons.find((p) => p.id === gone.id).version;
  await call(owner, 'PATCH', `/api/persons/${gone.id}`, { birth_place: 'Тверь', version: v });
  await so.wait('tree', before + 1);
  const [op] = await call(owner, 'GET', '/api/changes');
  await call(owner, 'POST', `/api/changes/${op.id}/revert`);
  await so.wait('tree', before + 2);

  // Комментарий у ушедшего видят все, у живого — только участники.
  await call(owner, 'POST', `/api/persons/${living.id}/comments`, { body: 'Её телефон 8-900' });
  await call(owner, 'POST', `/api/persons/${gone.id}/comments`, { body: 'Помню его пасеку' });
  await so.wait('comments', 2);
  await sg.wait('comments');
  await sleep(500);
  assert.deepEqual(so.got('comments').map((e) => e.data.person_id).sort(), [gone.id, living.id].sort());
  assert.deepEqual(sg.got('comments').map((e) => e.data.person_id), [gone.id]);
  assert.ok(!JSON.stringify(sg.events).includes(living.id), 'гость не узнаёт о живом');

  // Закрыли все потоки — подключение к базе отпущено.
  so.close();
  sg.close();
  for (let t = 0; t < 40 && await listeners(); t++) await sleep(50);
  assert.equal(await listeners(), 0);
});

test('запись мимо API тоже доходит', async () => {
  const owner = await login('owner');
  const s = await stream(owner);
  await q("insert into settings (key, value) values ('title', '\"Наше древо\"') on conflict (key) do update set value = excluded.value");
  await s.wait('tree');
  s.close();
});

test('обрыв LISTEN: переподключение и общее «перечитайте всё»', async () => {
  const owner = await login('owner');
  const s = await stream(owner);
  await q("select pg_terminate_backend(pid) from pg_stat_activity where query = 'listen drevo'");
  await s.wait('tree', 1, 6000);
  await s.wait('comments');
  assert.equal(await listeners(), 1);
  const n = s.got('tree').length;
  await call(owner, 'POST', '/api/persons', { person: { given: 'После обрыва' } });
  await s.wait('tree', n + 1);
  s.close();
});

test('вход перепроверяется: после выхода или отключения поток закрывается, новая роль учитывается', async () => {
  const owner = await login('owner');
  const leaver = await login('editor');
  const banned = await login('editor');
  const demoted = await login('editor');
  const [sl, sb, sd] = [await stream(leaver), await stream(banned), await stream(demoted)];
  await call(leaver, 'POST', '/api/logout');
  const [{ id: bannedId }] = await q('select user_id as id from sessions order by created_at desc limit 1 offset 1');
  const [{ id: demotedId }] = await q('select user_id as id from sessions order by created_at desc limit 1');
  await call(owner, 'PATCH', `/api/users/${bannedId}`, { disabled: true });
  await call(owner, 'PATCH', `/api/users/${demotedId}`, { role: 'viewer' });
  assert.ok(await sl.closed(), 'вышел — поток закрыт');
  assert.ok(await sb.closed(), 'отключён — поток закрыт');
  await sleep(400);
  assert.ok(!(await sd.closed(100)), 'роль сменилась — поток жив');
  const living = await call(owner, 'POST', '/api/persons', { person: { given: 'Живая', birth_date: '2001' } });
  await call(owner, 'POST', `/api/persons/${living.id}/comments`, { body: 'Адрес' });
  await sd.wait('tree');
  await sleep(500);
  assert.deepEqual(sd.got('comments'), [], 'теперь гость — обсуждения живых не видит');
  sd.close();
});
