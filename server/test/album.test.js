// Фото и документы: загрузка нескольких файлов одним действием, подписи, отметки людей, главное фото,
// мягкое удаление, откат каждого действия, приватность гостей, лента и сводка, перенос старых фото.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { createInvite } from '../src/auth.js';
import { mediaPath } from '../src/routes/media.js';
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
const call = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });
const json = async (...args) => {
  const r = await call(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64');
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

// Один файл: поля, сам файл и, по желанию, миниатюра.
async function upload(cookie, personId, { kind = 'photo', batch, caption, date, type = 'image/png', data = PNG, name = 'p.png', thumb = true } = {}) {
  const b = 'drevo-album';
  const field = (k, v) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  const file = (k, fname, t, d) => [Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"; filename="${fname}"\r\nContent-Type: ${t}\r\n\r\n`), d, Buffer.from('\r\n')];
  const payload = Buffer.concat([
    Buffer.from(field('kind', kind) + (batch ? field('batch', batch) : '') + (caption ? field('caption', caption) : '') + (date ? field('date', date) : '')),
    ...file('file', name, type, data),
    ...(thumb && type.startsWith('image/') ? file('thumb', 'thumb.jpg', 'image/jpeg', JPEG) : []),
    Buffer.from(`--${b}--\r\n`),
  ]);
  return app.inject({
    method: 'POST', url: `/api/persons/${personId}/media`, payload,
    headers: { ...H, cookie, 'content-type': `multipart/form-data; boundary=${b}` },
  });
}
async function add(person) {
  return json(owner, 'POST', '/api/persons', { person });
}
const album = (cookie, id) => json(cookie, 'GET', `/api/persons/${id}/media`);
const person = async (id, cookie = owner) => (await json(cookie, 'GET', '/api/tree')).persons.find((p) => p.id === id);
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

test('несколько файлов — одно действие: первое фото главное, откат убирает все, возврат возвращает', async () => {
  const ivan = await add({ given: 'Иван', surname: 'Смирнов', patronymic: 'Фёдорович', sex: 'M', living: false });
  const a = (await upload(owner, ivan.id, { caption: 'У дома', date: 'около 1950' })).json();
  assert.equal(a.kind, 'photo');
  const b = (await upload(owner, ivan.id, { batch: a.batch, type: 'image/jpeg', data: JPEG })).json();
  const c = await upload(owner, ivan.id, { batch: a.batch, kind: 'doc', type: 'application/pdf', data: PDF, name: 'Метрика.pdf' });
  assert.equal(c.statusCode, 200, c.body);
  assert.equal(b.batch, a.batch);

  const list = await album(owner, ivan.id);
  assert.deepEqual(list.map((m) => m.kind), ['photo', 'photo', 'doc']);
  assert.equal(list[0].caption, 'У дома');
  assert.equal(list[0].date, 'около 1950');
  assert.equal(list[0].thumb, true);
  assert.equal(list[2].name, 'Метрика.pdf');
  assert.equal(list[2].thumb, false);
  assert.deepEqual(list[0].persons, [ivan.id]);
  assert.equal((await person(ivan.id)).photo_id, a.id, 'первое фото стало главным');

  const thumb = await call(owner, 'GET', `/api/media/${a.id}/thumb`);
  assert.equal(thumb.headers['content-type'], 'image/jpeg');
  assert.deepEqual(thumb.rawPayload, JPEG);
  assert.equal((await call(owner, 'GET', `/api/media/${c.json().id}`)).headers['content-type'], 'application/pdf');
  assert.equal((await call(owner, 'GET', `/api/media/${c.json().id}/thumb`)).statusCode, 404, 'у PDF миниатюры нет — на телефоне значок');

  const op = await lastOp();
  assert.equal(op.entries.filter((e) => e.entity === 'media' && e.action === 'add').length, 3);
  await revert(op);
  assert.deepEqual(await album(owner, ivan.id), []);
  assert.equal((await person(ivan.id)).photo_id, null);
  assert.ok(fs.existsSync(mediaPath(a.id)), 'файл остаётся на диске');

  // Отменённое действие не продолжается: следующий файл — новое действие.
  const d = (await upload(owner, ivan.id, { batch: a.batch })).json();
  assert.notEqual(d.batch, a.batch);
  await revert(await lastOp());

  const undo = (await json(owner, 'GET', '/api/changes')).find((o) => o.entries.some((e) => e.entity_id === a.id && e.action === 'delete'));
  await revert(undo);
  assert.equal((await album(owner, ivan.id)).length, 3);
  assert.equal((await person(ivan.id)).photo_id, a.id);
});

test('чужое действие продолжить нельзя; неподходящий файл не принимается', async () => {
  const p = await add({ given: 'Пётр', sex: 'M' });
  const a = (await upload(owner, p.id)).json();
  const b = (await upload(editor, p.id, { batch: a.batch })).json();
  assert.notEqual(b.batch, a.batch);
  const bad = await upload(owner, p.id, { type: 'application/pdf', data: PDF, name: 'x.pdf' });
  assert.equal(bad.statusCode, 400, 'PDF — только как документ');
  assert.match(bad.json().error, /фотография/);
  assert.equal((await upload(owner, p.id, { kind: 'doc', type: 'text/plain', data: Buffer.from('x') })).statusCode, 400);
  const big = await upload(owner, p.id, { kind: 'doc', type: 'application/pdf', data: Buffer.alloc(21 * 1024 * 1024), name: 'big.pdf' });
  assert.equal(big.statusCode, 413);
  assert.match(big.json().error, /не больше 20 МБ/);
  assert.equal((await album(owner, p.id)).length, 2);
  assert.equal((await upload(guest, p.id)).statusCode, 403);
  assert.equal((await upload(owner, '00000000-0000-0000-0000-000000000000')).statusCode, 404);
});

test('подпись, дата, отметки людей, главное фото и их откат', async () => {
  const dad = await add({ given: 'Отец', sex: 'M', living: false });
  const son = await add({ given: 'Сын', sex: 'M', living: false });
  const son2 = await add({ given: 'Сын2', sex: 'M', living: false });
  await upload(owner, son.id);
  const m = (await upload(owner, dad.id)).json();

  const upd = await json(owner, 'PATCH', `/api/media/${m.id}`, { caption: 'Свадьба', date: '1945' });
  assert.equal(upd.caption, 'Свадьба');
  await json(owner, 'PATCH', `/api/media/${m.id}`, { caption: 'Свадьба в Горках' });
  await revert(await lastOp());
  assert.equal((await album(owner, dad.id))[0].caption, 'Свадьба');
  assert.equal((await album(owner, dad.id))[0].date, '1945');

  // Групповое фото видно в карточке каждого отмеченного.
  await json(owner, 'PUT', `/api/media/${m.id}/persons/${son.id}`);
  await json(owner, 'PUT', `/api/media/${m.id}/persons/${son.id}`);
  await json(owner, 'PUT', `/api/media/${m.id}/persons/${son2.id}`);
  assert.deepEqual((await album(owner, son.id)).map((x) => x.id).at(-1), m.id);
  assert.deepEqual((await album(owner, dad.id))[0].persons, [dad.id, son.id, son2.id].sort());
  assert.ok((await json(owner, 'GET', `/api/persons/${son2.id}/history`)).length, 'отметка — в истории отмеченного');
  await revert(await lastOp());
  assert.deepEqual((await album(owner, son2.id)), []);

  // Главное фото — из альбома.
  const before = (await person(son.id)).photo_id;
  await json(owner, 'PUT', `/api/persons/${son.id}/photo`, { media_id: m.id });
  const mainOp = await lastOp();
  assert.equal((await person(son.id)).photo_id, m.id);
  // Сняли отметку — фото перестаёт быть главным; откат возвращает и то и другое.
  await json(owner, 'DELETE', `/api/media/${m.id}/persons/${son.id}`);
  assert.equal((await person(son.id)).photo_id, null);
  assert.deepEqual((await album(owner, son.id)).map((x) => x.id).includes(m.id), false);
  await revert(await lastOp());
  assert.equal((await person(son.id)).photo_id, m.id);
  await revert(mainOp);
  assert.equal((await person(son.id)).photo_id, before);

  assert.equal((await call(owner, 'PUT', `/api/persons/${son2.id}/photo`, { media_id: m.id })).statusCode, 400, 'не в альбоме');
  const doc = (await upload(owner, son2.id, { kind: 'doc', type: 'application/pdf', data: PDF })).json();
  assert.equal((await call(owner, 'PUT', `/api/persons/${son2.id}/photo`, { media_id: doc.id })).statusCode, 400, 'PDF главным не бывает');
  const last = await call(owner, 'DELETE', `/api/media/${doc.id}/persons/${son2.id}`);
  assert.equal(last.statusCode, 409, 'последнего человека с файла не снять');
  assert.equal((await call(guest, 'PATCH', `/api/media/${m.id}`, { caption: 'x' })).statusCode, 403);
});

test('мягкое удаление: файл на диске, главное фото снимается, отмена возвращает всё', async () => {
  const p = await add({ given: 'Удаляемый', sex: 'F', living: false });
  const m = (await upload(owner, p.id)).json();
  const r = await json(owner, 'DELETE', `/api/media/${m.id}`);
  assert.ok(r.changeId);
  assert.deepEqual(await album(owner, p.id), []);
  assert.equal((await person(p.id)).photo_id, null);
  assert.ok(fs.existsSync(mediaPath(m.id)));
  assert.equal((await call(owner, 'DELETE', `/api/media/${m.id}`)).statusCode, 404);
  assert.equal((await call(owner, 'PATCH', `/api/media/${m.id}`, { caption: 'x' })).statusCode, 404);
  await revert({ id: r.changeId });
  assert.equal((await album(owner, p.id)).length, 1);
  assert.equal((await person(p.id)).photo_id, m.id);

  // Сменили главное, прежнее удалили: откат смены не вернёт удалённое фото главным.
  const m2 = (await upload(owner, p.id)).json();
  await json(owner, 'PUT', `/api/persons/${p.id}/photo`, { media_id: m2.id });
  const swap = await lastOp();
  await json(owner, 'DELETE', `/api/media/${m.id}`);
  const back = await call(owner, 'POST', `/api/changes/${swap.id}/revert`);
  assert.equal(back.statusCode, 409);
  assert.match(back.json().error, /удалено/);
});

test('гость не видит файлов с живыми — ни в альбоме, ни по ссылке, ни главным фото; фото ушедших видит', async () => {
  const grand = await add({ given: 'Дед', sex: 'M', living: false, birth_date: '1920', death_date: '1990' });
  const grandma = await add({ given: 'Бабушка', sex: 'F', living: false });
  const kid = await add({ given: 'Внук', sex: 'M', birth_date: '1990' });
  const group = (await upload(owner, grand.id, { caption: 'Все вместе у Тверской' })).json();
  await json(owner, 'PUT', `/api/media/${group.id}/persons/${kid.id}`);
  const old = (await upload(owner, grand.id, { caption: 'Дед с бабушкой' })).json();
  await json(owner, 'PUT', `/api/media/${old.id}/persons/${grandma.id}`);
  const scan = (await upload(owner, grand.id, { kind: 'doc', type: 'application/pdf', data: PDF, caption: 'Похоронка' })).json();
  await json(owner, 'PUT', `/api/media/${scan.id}/persons/${kid.id}`);
  assert.equal((await person(grand.id)).photo_id, group.id);

  const g = await album(guest, grand.id);
  assert.deepEqual(g.map((m) => m.id), [old.id]);
  assert.ok(!JSON.stringify(g).includes('Тверской'));
  assert.deepEqual(await album(guest, kid.id), []);
  for (const url of [`/api/media/${group.id}`, `/api/media/${group.id}/thumb`, `/api/media/${scan.id}`]) {
    assert.equal((await call(guest, 'GET', url)).statusCode, 404, url);
  }
  assert.equal((await call(guest, 'GET', `/api/media/${old.id}`)).statusCode, 200);
  assert.equal((await call(guest, 'GET', `/api/media/${old.id}/thumb`)).statusCode, 200);
  assert.equal((await call(owner, 'GET', `/api/media/${group.id}`)).statusCode, 200);
  assert.equal((await album(owner, grand.id)).length, 3);
  assert.equal((await person(grand.id, guest)).photo_id, null, 'главное фото ушедшего с живым на нём гостю не отдаётся');
  assert.equal((await call(guest, 'GET', `/api/print.pdf?root=${grand.id}`)).statusCode, 200);

  // Сняли отметку живого — фото ушедших стало видно гостю.
  await json(owner, 'DELETE', `/api/media/${group.id}/persons/${kid.id}`);
  assert.equal((await person(grand.id, guest)).photo_id, group.id);
  assert.equal((await call(guest, 'GET', `/api/media/${group.id}`)).statusCode, 200);
  // Удалённое гостю не отдаётся.
  await json(owner, 'DELETE', `/api/media/${old.id}`);
  assert.equal((await call(guest, 'GET', `/api/media/${old.id}`)).statusCode, 404);
});

test('лента и сводка: «добавил 3 фото», гостю — без подписей и id файлов', async () => {
  const p = await add({ given: 'Лента', sex: 'M', living: false });
  const a = (await upload(editor, p.id, { caption: 'секретная подпись', date: '1961' })).json();
  await upload(editor, p.id, { batch: a.batch });
  await upload(editor, p.id, { batch: a.batch, kind: 'doc', type: 'application/pdf', data: PDF, name: 'письмо.pdf' });

  const feed = await json(owner, 'GET', '/api/feed');
  const op = feed.items.find((i) => i.kind === 'op' && i.entries.some((e) => e.entity_id === a.id));
  assert.equal(op.entries.filter((e) => e.entity === 'media').length, 3);
  assert.equal(op.entries[0].after.caption, 'секретная подпись');

  const g = (await json(guest, 'GET', '/api/feed')).items.find((i) => i.op === op.op);
  const text = JSON.stringify(g);
  for (const s of ['секретная', '1961', 'письмо.pdf', a.id]) assert.ok(!text.includes(s), s);
  assert.deepEqual(g.entries.filter((e) => e.entity === 'media').map((e) => e.after), [{ kind: 'photo' }, { kind: 'photo' }, { kind: 'doc' }]);
  assert.ok(g.entries.every((e) => e.entity !== 'media' || e.entity_id === null));

  const entries = op.entries.map((e) => ({ ...e, op: op.op }));
  assert.equal(digestText('Елена', 'F', entries, [op.op]), 'Елена добавила 2 фото и 1 документ');
});

test('миграция: фото, загруженные до альбома, переходят в альбом', async () => {
  // База как до 007_album.sql: старая таблица media с person_id.
  await app.close();
  await pool.query('drop schema public cascade; create schema public;');
  await pool.query('create table schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  await pool.query("insert into schema_migrations (name) values ('007_album.sql')");
  await migrate(() => {});
  const [p] = (await pool.query("insert into persons (given, living) values ('Старый', false) returning id")).rows;
  const ins = async () => (await pool.query("insert into media (person_id, mime, bytes) values ($1, 'image/jpeg', 100) returning id", [p.id])).rows[0].id;
  const main = await ins();
  const replaced = await ins();
  const undone = await ins();
  await pool.query('update persons set photo_id = $1 where id = $2', [main, p.id]);
  await pool.query(`insert into changes (op, entity, entity_id, action, before, after, reverted_by)
    values (gen_random_uuid(), 'person', $1, 'photo', '{"photo_id": null}', $2, 1)`, [p.id, JSON.stringify({ photo_id: undone })]);

  await pool.query("delete from schema_migrations where name = '007_album.sql'");
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await login('owner');
  const list = await album(owner, p.id);
  assert.deepEqual(list.map((m) => m.id).sort(), [main, replaced].sort());
  assert.ok(list.every((m) => m.kind === 'photo' && m.caption === '' && !m.thumb));
  assert.equal((await person(p.id)).photo_id, main);
});
