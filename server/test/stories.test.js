// Истории и записи голоса: создание с людьми и голосом, правка, связи с людьми, удаление — и откат каждого действия;
// приватность гостей, запросы Range (для Safari на iPhone), лента и сводка уведомлений.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { createInvite } from '../src/auth.js';
import { parseRange } from '../src/routes/media.js';
import { digestText } from '../src/push.js';

let app;
const H = { 'x-drevo': '1' };
let owner;
let editor;
let guest;

async function login(role) {
  const { token } = await createInvite({ role, label: role });
  const r = await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token } });
  assert.equal(r.statusCode, 200, r.body);
  return r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
const call = (cookie, method, url, payload, headers = {}) => app.inject({ method, url, payload, headers: { ...H, cookie, ...headers } });
const json = async (...args) => {
  const r = await call(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

// «Запись голоса»: 4000 байт, у каждого своё значение — так видно, какой кусок пришёл.
const VOICE = Buffer.from(Array.from({ length: 4000 }, (_, i) => i % 251));

async function audio(cookie, { type = 'audio/webm;codecs=opus', name = 'blob', data = VOICE, duration = '42' } = {}) {
  const b = 'drevo-voice';
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="duration"\r\n\r\n${duration}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return app.inject({ method: 'POST', url: '/api/audio', payload, headers: { ...H, cookie, 'content-type': `multipart/form-data; boundary=${b}` } });
}
const add = async (person) => json(owner, 'POST', '/api/persons', { person });
const stories = (cookie, id) => json(cookie, 'GET', `/api/persons/${id}/stories`);
const lastOp = async () => (await json(owner, 'GET', '/api/changes'))[0];
const revert = async (op) => {
  const r = await call(owner, 'POST', `/api/changes/${op.id}/revert`);
  assert.equal(r.statusCode, 200, r.body);
};

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await login('owner');
  editor = await login('editor');
  guest = await login('viewer');
});
after(async () => { await app.close(); await pool.end(); });

test('история с голосом и людьми: создание, правка, связи, удаление — каждое отменяется', async () => {
  const grandma = await add({ given: 'Бабушка', sex: 'F', living: false });
  const grandpa = await add({ given: 'Дедушка', sex: 'M', living: false });
  const a = await audio(editor);
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(a.json().mime, 'audio/webm');
  assert.equal(a.json().duration, 42);

  const s = await json(editor, 'POST', `/api/persons/${grandma.id}/stories`,
    { title: 'Как бабушка встретила войну', date: 'лето 1941', body: 'Рассказывала, как…', audio_id: a.json().id });
  assert.equal(s.audio_id, a.json().id);
  assert.equal(s.audio_mime, 'audio/webm');
  assert.equal(s.audio_duration, 42);
  assert.equal(s.user_name, 'editor');
  assert.deepEqual(s.persons, [grandma.id]);
  assert.equal((await stories(owner, grandma.id))[0].date, 'лето 1941');
  assert.deepEqual(await json(owner, 'GET', '/api/persons/' + grandma.id + '/media'), [], 'запись голоса не в альбоме');

  // Одну запись к двум историям не приложить; без заголовка — нельзя; фото записью голоса не станет.
  assert.equal((await call(owner, 'POST', `/api/persons/${grandpa.id}/stories`, { title: 'x', audio_id: a.json().id })).statusCode, 409);
  assert.equal((await call(owner, 'POST', `/api/persons/${grandpa.id}/stories`, { title: '  ' })).statusCode, 400);
  assert.equal((await call(owner, 'PATCH', `/api/media/${a.json().id}`, { caption: 'x' })).statusCode, 404, 'запись голоса — не файл альбома');

  // Правка: текст и новая запись; откат возвращает прежнюю.
  const b = (await audio(owner, { type: 'audio/mp4', duration: '' })).json();
  assert.equal(b.duration, null);
  await json(owner, 'PATCH', `/api/stories/${s.id}`, { body: 'Новый текст', audio_id: b.id });
  let cur = await json(owner, 'GET', `/api/stories/${s.id}`);
  assert.equal(cur.body, 'Новый текст');
  assert.equal(cur.audio_id, b.id);
  const upd = await lastOp();
  assert.equal(upd.entries[0].after.title, 'Как бабушка встретила войну', 'заголовок — для подписи');
  await revert(upd);
  cur = await json(owner, 'GET', `/api/stories/${s.id}`);
  assert.equal(cur.body, 'Рассказывала, как…');
  assert.equal(cur.audio_id, a.json().id);
  // Убрать запись голоса.
  await json(owner, 'PATCH', `/api/stories/${s.id}`, { audio_id: null });
  assert.equal((await json(owner, 'GET', `/api/stories/${s.id}`)).audio_id, null);
  await revert(await lastOp());
  assert.equal((await json(owner, 'GET', `/api/stories/${s.id}`)).audio_id, a.json().id);
  assert.equal((await call(owner, 'PATCH', `/api/stories/${s.id}`, { title: '' })).statusCode, 400);

  // Связать с дедушкой: история видна в его карточке; откат убирает связь.
  const linked = await json(owner, 'PUT', `/api/stories/${s.id}/persons/${grandpa.id}`);
  assert.deepEqual(linked.persons, [grandma.id, grandpa.id].sort());
  assert.equal((await stories(owner, grandpa.id))[0].id, s.id);
  assert.ok((await json(owner, 'GET', `/api/persons/${grandpa.id}/history`)).length, 'связь — в истории правок дедушки');
  await revert(await lastOp());
  assert.deepEqual(await stories(owner, grandpa.id), []);

  // Отвязать: последнего человека нельзя; откат отвязки возвращает связь.
  await json(owner, 'PUT', `/api/stories/${s.id}/persons/${grandpa.id}`);
  await json(owner, 'DELETE', `/api/stories/${s.id}/persons/${grandma.id}`);
  assert.deepEqual(await stories(owner, grandma.id), []);
  assert.equal((await call(owner, 'DELETE', `/api/stories/${s.id}/persons/${grandpa.id}`)).statusCode, 409);
  await revert(await lastOp());
  assert.equal((await stories(owner, grandma.id)).length, 1);

  // Удаление мягкое, отменяется; удалённую не правят.
  const del = await json(owner, 'DELETE', `/api/stories/${s.id}`);
  assert.deepEqual(await stories(owner, grandma.id), []);
  assert.equal((await call(owner, 'GET', `/api/stories/${s.id}`)).statusCode, 404);
  assert.equal((await call(owner, 'PATCH', `/api/stories/${s.id}`, { body: 'x' })).statusCode, 404);
  await revert({ id: del.changeId });
  assert.equal((await stories(owner, grandma.id)).length, 1);

  // Отмена создания убирает историю, отмена отмены — возвращает.
  const created = (await json(owner, 'GET', '/api/changes')).find((o) => o.entries.some((e) => e.entity === 'story' && e.action === 'add'));
  await revert(created);
  assert.deepEqual(await stories(owner, grandma.id), []);
  await revert(await lastOp());
  assert.equal((await stories(owner, grandma.id)).length, 1);
});

test('гость: история с живым скрыта везде, об ушедших — видна; гость не пишет', async () => {
  const dead = await add({ given: 'Прадед', surname: 'Смирнов', sex: 'M', living: false });
  const kid = await add({ given: 'Внучка', sex: 'F', birth_date: '1990' });
  const va = (await audio(owner)).json();
  const vb = (await audio(owner)).json();
  const secret = await json(owner, 'POST', `/api/persons/${dead.id}/stories`, { title: 'Тайная история с внучкой', audio_id: va.id });
  await json(owner, 'PUT', `/api/stories/${secret.id}/persons/${kid.id}`);
  const open = await json(owner, 'POST', `/api/persons/${dead.id}/stories`, { title: 'Про войну', body: 'Текст', audio_id: vb.id });

  assert.deepEqual((await stories(guest, dead.id)).map((s) => s.id), [open.id]);
  assert.deepEqual(await stories(guest, kid.id), []);
  assert.equal((await call(guest, 'GET', `/api/stories/${secret.id}`)).statusCode, 404);
  assert.equal((await call(guest, 'GET', `/api/media/${va.id}`)).statusCode, 404, 'запись голоса с живым — не по ссылке');
  assert.equal((await call(guest, 'GET', `/api/media/${vb.id}`)).statusCode, 200);
  assert.equal((await call(owner, 'GET', `/api/media/${va.id}`)).statusCode, 200);
  const loose = (await audio(owner)).json();
  assert.equal((await call(guest, 'GET', `/api/media/${loose.id}`)).statusCode, 404, 'неприложенная запись гостю не видна');

  // В ленте гость не видит заголовков и номеров историй.
  const feed = JSON.stringify((await json(guest, 'GET', '/api/feed')).items);
  for (const t of ['Тайная', 'Про войну', secret.id, open.id]) assert.ok(!feed.includes(t), t);
  assert.ok((await json(owner, 'GET', '/api/feed')).items.some((i) => JSON.stringify(i).includes('Тайная')));

  // Гость не пишет.
  assert.equal((await call(guest, 'POST', `/api/persons/${dead.id}/stories`, { title: 'x' })).statusCode, 403);
  assert.equal((await call(guest, 'PATCH', `/api/stories/${open.id}`, { title: 'x' })).statusCode, 403);
  assert.equal((await call(guest, 'DELETE', `/api/stories/${open.id}`)).statusCode, 403);
  assert.equal((await call(guest, 'PUT', `/api/stories/${open.id}/persons/${kid.id}`)).statusCode, 403);
  assert.equal((await audio(guest)).statusCode, 403);

  // Удалённая история и её запись гостю не видны.
  await json(owner, 'DELETE', `/api/stories/${open.id}`);
  assert.equal((await call(guest, 'GET', `/api/media/${vb.id}`)).statusCode, 404);
});

test('запись голоса: какие файлы принимаются', async () => {
  for (const [type, name, mime] of [['audio/x-m4a', 'Диктофон.m4a', 'audio/mp4'], ['audio/mpeg', 'a.mp3', 'audio/mpeg'],
    ['application/octet-stream', 'запись.ogg', 'audio/ogg'], ['audio/wav', 'a.wav', 'audio/wav'], ['', 'b.webm', 'audio/webm']]) {
    const r = await audio(owner, { type: type || 'application/octet-stream', name });
    assert.equal(r.statusCode, 200, `${name}: ${r.body}`);
    assert.equal(r.json().mime, mime, name);
  }
  const bad = await audio(owner, { type: 'image/png', name: 'x.png' });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /запись голоса/i);
  assert.equal((await audio(owner, { data: Buffer.alloc(0) })).statusCode, 400);
  assert.equal((await audio(owner, { data: Buffer.alloc(21 * 1024 * 1024) })).statusCode, 413);
});

test('Range: кусок файла — 206, за концом — 416, без заголовка — весь файл', async () => {
  const v = (await audio(owner)).json();
  const url = `/api/media/${v.id}`;
  const full = await call(owner, 'GET', url);
  assert.equal(full.statusCode, 200);
  assert.equal(full.headers['accept-ranges'], 'bytes');
  assert.equal(Number(full.headers['content-length']), VOICE.length);
  assert.deepEqual(full.rawPayload, VOICE);

  const part = await call(owner, 'GET', url, undefined, { range: 'bytes=100-199' });
  assert.equal(part.statusCode, 206);
  assert.equal(part.headers['content-range'], `bytes 100-199/${VOICE.length}`);
  assert.equal(part.headers['content-type'], 'audio/webm');
  assert.deepEqual(part.rawPayload, VOICE.subarray(100, 200));
  // Safari сначала спрашивает первые два байта.
  assert.deepEqual((await call(owner, 'GET', url, undefined, { range: 'bytes=0-1' })).rawPayload, VOICE.subarray(0, 2));
  const tail = await call(owner, 'GET', url, undefined, { range: 'bytes=3900-' });
  assert.deepEqual(tail.rawPayload, VOICE.subarray(3900));
  const suffix = await call(owner, 'GET', url, undefined, { range: 'bytes=-50' });
  assert.equal(suffix.headers['content-range'], `bytes 3950-3999/${VOICE.length}`);
  const beyond = await call(owner, 'GET', url, undefined, { range: 'bytes=5000-6000' });
  assert.equal(beyond.statusCode, 416);
  assert.equal(beyond.headers['content-range'], `bytes */${VOICE.length}`);
  // Конец за файлом — до конца файла; непонятный заголовок — весь файл.
  assert.equal((await call(owner, 'GET', url, undefined, { range: 'bytes=3990-99999' })).rawPayload.length, 10);
  assert.equal((await call(owner, 'GET', url, undefined, { range: 'items=1-2' })).statusCode, 200);
  assert.equal(parseRange('bytes=0-1,5-6', 100), null, 'несколько кусков — весь файл');
  assert.equal(parseRange('bytes=-0', 100), false);
});

test('лента и сводка: «добавила 1 историю»', async () => {
  const p = await add({ given: 'Пётр', surname: 'Смирнов', patronymic: 'Иванович', sex: 'M', living: false });
  const s = await json(editor, 'POST', `/api/persons/${p.id}/stories`, { title: 'Рыбалка на Волге', date: 'около 1960' });
  const feed = await json(owner, 'GET', '/api/feed');
  const op = feed.items.find((i) => i.kind === 'op' && i.entries.some((e) => e.entity === 'story'));
  assert.deepEqual(op.entries[0].after, { title: 'Рыбалка на Волге', date: 'около 1960', audio: false });
  assert.deepEqual(op.entries[0].persons, [p.id]);
  const g = (await json(guest, 'GET', '/api/feed')).items.find((i) => i.op === op.op);
  assert.deepEqual(g.entries[0].after, { audio: false });
  assert.deepEqual(g.entries[0].persons, [p.id]);

  const entries = (ops) => ops.flatMap((o) => o.entries.map((e) => ({ ...e, op: o.op })));
  assert.equal(digestText('Елена', 'F', entries([op]), [op.op]), 'Елена добавила 1 историю');
  await json(editor, 'PATCH', `/api/stories/${s.id}`, { body: 'Текст' });
  await json(editor, 'DELETE', `/api/stories/${s.id}`);
  const [del, upd] = (await json(owner, 'GET', '/api/changes')).slice(0, 2);
  assert.equal(digestText('Иван', 'M', entries([upd, del]), [upd.op, del.op]), 'Иван изменил 1 историю, удалил 1 историю');
});
