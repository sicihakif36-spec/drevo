// Интеграционные проверки API на настоящей PostgreSQL (DATABASE_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { createInvite } from '../src/auth.js';

let app;
const H = { 'x-drevo': '1' };
let ownerCookie;

async function login(role) {
  const { token } = await createInvite({ role, label: role });
  const r = await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token } });
  assert.equal(r.statusCode, 200, r.body);
  return r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
const call = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false });
  ownerCookie = await login('owner');
});
after(async () => { await app.close(); await pool.end(); });

test('без входа дерево закрыто, без заголовка изменения отклоняются', async () => {
  assert.equal((await app.inject({ url: '/api/tree' })).statusCode, 401);
  const r = await app.inject({ method: 'POST', url: '/api/persons', payload: {}, headers: { cookie: ownerCookie } });
  assert.equal(r.statusCode, 403);
});

test('ссылка-приглашение срабатывает один раз', async () => {
  const { token } = await createInvite({ role: 'viewer' });
  assert.equal((await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token } })).statusCode, 400);
});

test('семья из родителей, ребёнка и супруга; откат правки; печать и GEDCOM', async () => {
  const me = (await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Анна', surname: 'Смирнова', sex: 'F', birth_date: '1990' } })).json();
  const dad = (await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Пётр', surname: 'Смирнов', sex: 'M', birth_date: 'около 1960' }, relation: { to: me.id, type: 'father' } })).json();
  await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Мария', surname: 'Смирнова', sex: 'F' }, relation: { to: me.id, type: 'mother' } });
  const third = await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Лишний', sex: 'M' }, relation: { to: me.id, type: 'father' } });
  assert.equal(third.statusCode, 409);
  await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Иван', sex: 'M' }, relation: { to: me.id, type: 'sibling' } });
  await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Олег', surname: 'Иванов', sex: 'M' }, relation: { to: me.id, type: 'spouse' } });
  await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Вера', sex: 'F' }, relation: { to: me.id, type: 'child' } });
  await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Пётр-старший', sex: 'M' }, relation: { to: dad.id, type: 'father' } });

  const tree = (await call(ownerCookie, 'GET', '/api/tree')).json();
  assert.equal(tree.persons.length, 7);
  const parentsFam = tree.families.find((f) => tree.children.some((c) => c.family_id === f.id && c.child_id === me.id));
  assert.ok(parentsFam.partner1 && parentsFam.partner2);
  assert.equal(tree.children.filter((c) => c.family_id === parentsFam.id).length, 2);

  const upd = await call(ownerCookie, 'PATCH', `/api/persons/${dad.id}`, { birth_place: 'Тверь', version: dad.version });
  assert.equal(upd.statusCode, 200);
  const stale = await call(ownerCookie, 'PATCH', `/api/persons/${dad.id}`, { birth_place: 'Москва', version: dad.version });
  assert.equal(stale.statusCode, 409);
  const hist = (await call(ownerCookie, 'GET', `/api/persons/${dad.id}/history`)).json();
  const change = hist.find((op) => op.entries.some((e) => e.action === 'update'));
  assert.equal((await call(ownerCookie, 'POST', `/api/changes/${change.id}/revert`)).statusCode, 200);
  const t2 = (await call(ownerCookie, 'GET', '/api/tree')).json();
  assert.equal(t2.persons.find((p) => p.id === dad.id).birth_place, '');

  const del = (await call(ownerCookie, 'DELETE', `/api/persons/${dad.id}`)).json();
  assert.equal((await call(ownerCookie, 'GET', '/api/tree')).json().persons.length, 6);
  assert.equal((await call(ownerCookie, 'POST', `/api/changes/${del.changeId}/revert`)).statusCode, 200);
  const t3 = (await call(ownerCookie, 'GET', '/api/tree')).json();
  assert.equal(t3.persons.length, 7);
  assert.ok(t3.families.some((f) => f.partner1 === dad.id || f.partner2 === dad.id));

  for (const qs of ['', '?mode=ancestors&paper=A3', `?fit=tiles&scale=150&root=${me.id}`]) {
    const pdf = await call(ownerCookie, 'GET', `/api/print.pdf${qs}`);
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  }
  const ged = await call(ownerCookie, 'GET', '/api/export.ged');
  assert.match(ged.body, /1 NAME Пётр \/Смирнов\//);
  assert.match(ged.body, /2 DATE ABT 1960/);
});

test('гость не может править', async () => {
  const guest = await login('viewer');
  assert.equal((await call(guest, 'GET', '/api/tree')).statusCode, 200);
  assert.equal((await call(guest, 'POST', '/api/persons', { person: { given: 'X' } })).statusCode, 403);
  assert.equal((await call(guest, 'GET', '/api/users')).statusCode, 403);
});

const tree = async () => (await call(ownerCookie, 'GET', '/api/tree')).json();
async function add(person, relation) {
  const r = await call(ownerCookie, 'POST', '/api/persons', { person, relation });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const lastOp = async () => (await call(ownerCookie, 'GET', '/api/changes')).json()[0];
const revert = (op) => call(ownerCookie, 'POST', `/api/changes/${op.id}/revert`);
function parentsIn(t, id) {
  const fids = t.children.filter((c) => c.child_id === id).map((c) => c.family_id);
  return t.families.filter((f) => fids.includes(f.id)).flatMap((f) => [f.partner1, f.partner2]).filter(Boolean).sort();
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
// Первое фото человека становится главным.
async function upload(personId) {
  const b = 'drevo-test';
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n`),
    PNG, Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  const r = await app.inject({
    method: 'POST', url: `/api/persons/${personId}/media`, payload,
    headers: { ...H, cookie: ownerCookie, 'content-type': `multipart/form-data; boundary=${b}` },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().id;
}

test('откат связей: отец, супруг, брат, разрыв связи, удаление; отменённое можно вернуть', async () => {
  const son = await add({ given: 'Сын', sex: 'M' });
  const dad = await add({ given: 'Отец', sex: 'M' }, { to: son.id, type: 'father' });
  const addDad = await lastOp();
  const sonHist = (await call(ownerCookie, 'GET', `/api/persons/${son.id}/history`)).json();
  assert.ok(sonHist.some((op) => op.op === addDad.op), 'связь видна в истории сына');

  assert.equal((await revert(addDad)).statusCode, 200);
  let t = await tree();
  assert.ok(!t.persons.some((p) => p.id === dad.id));
  assert.ok(!t.children.some((c) => c.child_id === son.id), 'пустая семья не осталась');
  assert.equal((await revert(addDad)).statusCode, 409);
  assert.equal((await revert(await lastOp())).statusCode, 200);
  assert.deepEqual(parentsIn(await tree(), son.id), [dad.id]);

  // Супруг отца становится вторым родителем сына; откат убирает и связь, и человека.
  const wife = await add({ given: 'Жена', sex: 'F' }, { to: dad.id, type: 'spouse' });
  assert.deepEqual(parentsIn(await tree(), son.id), [dad.id, wife.id].sort());
  assert.equal((await revert(await lastOp())).statusCode, 200);
  t = await tree();
  assert.deepEqual(parentsIn(t, son.id), [dad.id]);
  assert.ok(!t.persons.some((p) => p.id === wife.id));

  const families = (await tree()).families.length;
  const a = await add({ given: 'Брат', sex: 'M' });
  await add({ given: 'Сестра', sex: 'F' }, { to: a.id, type: 'sibling' });
  assert.equal((await tree()).families.length, families + 1);
  assert.equal((await revert(await lastOp())).statusCode, 200);
  assert.equal((await tree()).families.length, families);

  const fam = (await tree()).families.find((f) => f.partner1 === dad.id || f.partner2 === dad.id);
  assert.equal((await call(ownerCookie, 'DELETE', `/api/families/${fam.id}/members/${son.id}`)).statusCode, 200);
  assert.deepEqual(parentsIn(await tree(), son.id), []);
  assert.equal((await revert(await lastOp())).statusCode, 200);
  assert.deepEqual(parentsIn(await tree(), son.id), [dad.id]);

  // Единственный родитель: после удаления и возврата связь с сыном на месте.
  const del = (await call(ownerCookie, 'DELETE', `/api/persons/${dad.id}`)).json();
  assert.deepEqual(parentsIn(await tree(), son.id), []);
  assert.equal((await call(ownerCookie, 'POST', `/api/changes/${del.changeId}/revert`)).statusCode, 200);
  assert.deepEqual(parentsIn(await tree(), son.id), [dad.id]);
});

test('откат не ломает более поздние правки', async () => {
  const kid = await add({ given: 'Дочь', sex: 'F' });
  const dad = await add({ given: 'Папа', sex: 'M' }, { to: kid.id, type: 'father' });
  const opFather = await lastOp();
  const mom = await add({ given: 'Мама', sex: 'F' }, { to: kid.id, type: 'mother' });
  const opMother = await lastOp();
  const r = await revert(opFather);
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /Сначала отмените/);
  assert.deepEqual(parentsIn(await tree(), kid.id), [dad.id, mom.id].sort());
  assert.equal((await revert(opMother)).statusCode, 200);
  assert.equal((await revert(opFather)).statusCode, 200);
  assert.deepEqual(parentsIn(await tree(), kid.id), []);

  const photo = await upload(kid.id);
  assert.equal((await tree()).persons.find((p) => p.id === kid.id).photo_id, photo);
  assert.equal((await revert(await lastOp())).statusCode, 200);
  assert.equal((await tree()).persons.find((p) => p.id === kid.id).photo_id, null);
});

test('гость не видит дат, мест, заметок и фото живых', async () => {
  const living = await add({ given: 'Живой', sex: 'M', birth_date: '12.03.2001', birth_place: 'Тверь', notes: 'телефон 123' });
  const old = await add({ given: 'Долгожительница', sex: 'F', birth_date: '1890' });
  const gone = await add({ given: 'Ушедший', sex: 'M', living: false, birth_date: '1950', death_date: '2010' });
  const livingPhoto = await upload(living.id);
  const gonePhoto = await upload(gone.id);
  const guest = await login('viewer');

  const t = (await call(guest, 'GET', '/api/tree')).json();
  const g = (id) => t.persons.find((p) => p.id === id);
  assert.equal(g(living.id).given, 'Живой');
  assert.equal(g(living.id).birth_date, '');
  assert.equal(g(living.id).birth_place, '');
  assert.equal(g(living.id).notes, '');
  assert.equal(g(living.id).photo_id, null);
  assert.equal(g(living.id).hidden, true);
  assert.equal(g(old.id).birth_date, '1890');
  assert.equal(g(gone.id).death_date, '2010');
  assert.equal(g(gone.id).photo_id, gonePhoto);
  assert.equal((await tree()).persons.find((p) => p.id === living.id).birth_date, '12.03.2001');

  assert.equal((await call(guest, 'GET', `/api/media/${livingPhoto}`)).statusCode, 404);
  assert.equal((await call(guest, 'GET', `/api/media/${gonePhoto}`)).statusCode, 200);
  assert.equal((await call(ownerCookie, 'GET', `/api/media/${livingPhoto}`)).statusCode, 200);

  assert.equal((await call(guest, 'GET', `/api/persons/${living.id}/history`)).statusCode, 403);
  assert.equal((await call(guest, 'GET', '/api/changes')).statusCode, 403);
  const ged = (await call(guest, 'GET', '/api/export.ged')).body;
  assert.match(ged, /Живой/);
  assert.doesNotMatch(ged, /2001|Тверь|телефон/);
  assert.equal((await call(guest, 'GET', `/api/print.pdf?root=${living.id}`)).statusCode, 200);

  // «Это я» не открывает гостю чужие данные.
  assert.equal((await call(guest, 'PATCH', '/api/me', { person_id: living.id })).statusCode, 200);
  assert.equal((await call(guest, 'GET', '/api/tree')).json().persons.find((p) => p.id === living.id).birth_date, '');
});

test('несуществующий человек: понятная ошибка, а не сбой сервера', async () => {
  const none = '00000000-0000-0000-0000-000000000000';
  assert.equal((await call(ownerCookie, 'PATCH', '/api/me', { person_id: none })).statusCode, 404);
  assert.equal((await call(ownerCookie, 'PUT', `/api/persons/${none}/photo`, { media_id: none })).statusCode, 404);
  assert.equal((await call(ownerCookie, 'GET', '/api/persons/abc/history')).statusCode, 400);
  const someone = await add({ given: 'Кто-то', sex: 'M' });
  assert.equal((await call(ownerCookie, 'POST', '/api/relations', { personId: none, to: someone.id, type: 'father' })).statusCode, 404);
});

test('лента: что нового, без отменённого, гостю — без скрытых данных', async () => {
  const editor = await login('editor');
  const guest = await login('viewer');
  const feed = async (cookie) => (await call(cookie, 'GET', '/api/feed')).json();
  const newCount = async (cookie) => (await call(cookie, 'GET', '/api/tree')).json().feed_new;
  const seen = async (cookie) => call(cookie, 'POST', '/api/feed/seen', { at: (await feed(cookie)).now });
  for (const c of [ownerCookie, editor, guest]) assert.equal((await seen(c)).statusCode, 200);
  assert.equal(await newCount(ownerCookie), 0);

  // Свои действия — не новость, чужие — новость.
  const kid = await add({ given: 'Лентовый', sex: 'M', birth_date: '05.05.2015', birth_place: 'Тверь', notes: 'секрет' });
  assert.equal(await newCount(ownerCookie), 0);
  assert.equal(await newCount(editor), 1);
  const r = await call(editor, 'PATCH', `/api/persons/${kid.id}`, { birth_place: 'Калинин', occupation: 'школьник' });
  assert.equal(r.statusCode, 200);
  const mom = (await call(editor, 'POST', '/api/persons', { person: { given: 'Мама', sex: 'F', birth_date: '1985' }, relation: { to: kid.id, type: 'mother' } })).json();
  await call(ownerCookie, 'PATCH', `/api/families/${(await tree()).families.find((f) => f.partner1 === mom.id || f.partner2 === mom.id).id}`, { start_date: '2010' });
  const photo = await upload(kid.id);
  assert.equal(await newCount(ownerCookie), 2);
  assert.equal(await newCount(guest), 5);

  let f = await feed(ownerCookie);
  assert.equal(f.items.filter((i) => i.fresh).length, 2);
  assert.ok(f.items.every((i) => i.kind === 'op' && i.user_name));
  const upd = f.items.find((i) => i.entries.some((e) => e.entity === 'person' && e.action === 'update'));
  assert.equal(upd.entries[0].after.birth_place, 'Калинин', 'участникам записи отдаются целиком');

  // Гостю: имена, названия полей и связи, без значений.
  const g = await feed(guest);
  assert.equal(g.items.filter((i) => i.fresh).length, 5);
  const text = JSON.stringify(g.items);
  assert.ok(!text.includes(photo), 'фото');
  // Без номеров записей: случайный uuid может содержать «1985» или «2010».
  const values = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '');
  for (const s of ['05.05.2015', 'Тверь', 'Калинин', 'школьник', 'секрет', '1985', '2010']) assert.ok(!values.includes(s), s);
  const entries = g.items.flatMap((i) => i.entries);
  assert.deepEqual(entries.find((e) => e.entity_id === kid.id && e.action === 'create').after, { surname: '', given: 'Лентовый', patronymic: '', sex: 'M' });
  assert.deepEqual(entries.find((e) => e.action === 'update' && e.entity === 'person').after, { birth_place: null, occupation: null });
  assert.deepEqual(entries.find((e) => e.action === 'photo').after, { photo_id: true });
  const link = entries.find((e) => e.action === 'add_child' || e.action === 'set_partner');
  assert.ok(link.after.partners.includes(mom.id));

  // Отменённое действие и сама отмена в ленту не попадают, пара не считается новостью.
  const before = (await feed(guest)).items.length;
  const gone = await add({ given: 'Ошибочный', sex: 'M' });
  assert.equal(await newCount(guest), 6);
  assert.equal((await revert(await lastOp())).statusCode, 200);
  assert.equal(await newCount(guest), 5);
  f = await feed(guest);
  assert.equal(f.items.length, before);
  assert.ok(!f.items.some((i) => i.entries.some((e) => e.entity_id === gone.id)));

  // Просмотрено: новое пропадает; правки после отметки остаются новыми.
  const { now } = await feed(editor);
  await call(ownerCookie, 'PATCH', `/api/persons/${kid.id}`, { occupation: 'ученик' });
  assert.equal((await call(editor, 'POST', '/api/feed/seen', { at: now })).statusCode, 200);
  assert.equal(await newCount(editor), 1);
  assert.equal((await feed(editor)).items.filter((i) => i.fresh).length, 1);
  await seen(editor);
  assert.equal(await newCount(editor), 0);
  assert.equal((await call(editor, 'POST', '/api/feed/seen', { at: 'вчера' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/feed' })).statusCode, 401);
});

test('обсуждение: кто пишет, правит и удаляет; гостю — без живых; в ленте и подсчёте новых', async () => {
  const editor = await login('editor');
  const other = await login('editor');
  const guest = await login('viewer');
  const feed = async (cookie) => (await call(cookie, 'GET', '/api/feed')).json();
  const newCount = async (cookie) => (await call(cookie, 'GET', '/api/tree')).json().feed_new;
  const seen = async (cookie) => call(cookie, 'POST', '/api/feed/seen', { at: (await feed(cookie)).now });
  const list = (cookie, id) => call(cookie, 'GET', `/api/persons/${id}/comments`);
  const write = (cookie, id, body) => call(cookie, 'POST', `/api/persons/${id}/comments`, { body });
  const gone = await add({ given: 'Прадед', sex: 'M', living: false, birth_date: '1900', death_date: '1970' });
  const living = await add({ given: 'Внучка', sex: 'F', birth_date: '2000' });
  for (const c of [ownerCookie, editor, other, guest]) await seen(c);

  // Участник пишет и правит своё; пустое и слишком длинное — отказ.
  let r = await write(editor, gone.id, '  Воевал под Ржевом.\nВернулся в 1945.  ');
  assert.equal(r.statusCode, 200, r.body);
  const c1 = r.json();
  assert.equal(c1.body, 'Воевал под Ржевом.\nВернулся в 1945.');
  assert.equal(c1.updated_at, null);
  assert.equal((await write(editor, gone.id, '   ')).statusCode, 400);
  assert.equal((await write(editor, gone.id, 'а'.repeat(5001))).statusCode, 400);
  r = await call(editor, 'PATCH', `/api/comments/${c1.id}`, { body: 'Воевал под Ржевом, вернулся в 1945.' });
  assert.equal(r.statusCode, 200);
  assert.ok(r.json().updated_at);
  const c2 = (await write(editor, living.id, 'Её телефон 8-900-000-00-00')).json();
  const c3 = (await write(other, gone.id, 'Помню его пасеку.')).json();

  // Гость не пишет; чужое не правится и не удаляется участником; владелец удаляет чужое, но не правит.
  assert.equal((await write(guest, gone.id, 'привет')).statusCode, 403);
  assert.equal((await call(other, 'PATCH', `/api/comments/${c1.id}`, { body: 'чужое' })).statusCode, 403);
  assert.equal((await call(other, 'DELETE', `/api/comments/${c1.id}`)).statusCode, 403);
  assert.equal((await call(ownerCookie, 'PATCH', `/api/comments/${c3.id}`, { body: 'чужое' })).statusCode, 403);
  assert.equal((await call(ownerCookie, 'DELETE', `/api/comments/${c3.id}`)).statusCode, 200);
  assert.equal((await call(other, 'PATCH', `/api/comments/${c3.id}`, { body: 'снова' })).statusCode, 404);
  const own = (await write(other, gone.id, 'Ошибся, удалю.')).json();
  assert.equal((await call(other, 'DELETE', `/api/comments/${own.id}`)).statusCode, 200);

  // Гость читает обсуждение ушедшего, но не живого.
  r = await list(guest, gone.id);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().map((c) => c.id), [c1.id]);
  assert.equal((await list(guest, living.id)).statusCode, 403);
  assert.equal((await list(editor, living.id)).json().length, 1);

  // Лента и подсчёт: чужие комментарии — новые, свои — нет; гостю — без комментариев живых.
  assert.equal(await newCount(editor), 0);
  assert.equal(await newCount(other), 2);
  assert.equal(await newCount(ownerCookie), 2);
  assert.equal(await newCount(guest), 1);
  let f = await feed(ownerCookie);
  const fc = f.items.filter((i) => i.kind === 'comment');
  assert.deepEqual(fc.map((i) => i.id), [c2.id, c1.id]);
  assert.ok(fc.every((i) => i.fresh && i.user_name && i.person_id));
  assert.ok(f.items.slice(1).every((i, n) => i.at <= f.items[n].at), 'по времени, новые сверху');
  const g = await feed(guest);
  assert.deepEqual(g.items.filter((i) => i.kind === 'comment').map((i) => i.id), [c1.id]);
  assert.ok(!JSON.stringify(g.items).includes('8-900'));
  assert.ok((await feed(other)).items.length <= 50);

  // Комментарии удалённого человека не видны нигде, после возврата — снова видны.
  const del = (await call(ownerCookie, 'DELETE', `/api/persons/${gone.id}`)).json();
  assert.equal((await list(ownerCookie, gone.id)).statusCode, 404);
  assert.equal((await call(editor, 'PATCH', `/api/comments/${c1.id}`, { body: 'x' })).statusCode, 404);
  assert.equal((await write(editor, gone.id, 'x')).statusCode, 404);
  f = await feed(ownerCookie);
  assert.ok(!f.items.some((i) => i.id === c1.id));
  await seen(guest);
  assert.equal((await call(ownerCookie, 'POST', `/api/changes/${del.changeId}/revert`)).statusCode, 200);
  assert.equal((await list(ownerCookie, gone.id)).json().length, 1);
  assert.ok((await feed(ownerCookie)).items.some((i) => i.id === c1.id));
});
