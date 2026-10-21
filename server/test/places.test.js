// Справочник мест: добавление с заменой текста в карточках, новое название у людей, удаление — и откат каждого действия;
// подсказка, карточка места (у гостя — без живых), лента, сводка, GEDCOM.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { createInvite } from '../src/auth.js';
import { digestText } from '../src/push.js';

let app;
const H = { 'x-drevo': '1' };
let owner;
let editor;
let relative;
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
const add = async (person) => json(owner, 'POST', '/api/persons', { person });
const person = async (id, cookie = owner) => (await json(cookie, 'GET', '/api/tree')).persons.find((p) => p.id === id);
const lastOp = async () => (await json(owner, 'GET', '/api/changes'))[0];
const revert = async (op) => {
  const r = await call(owner, 'POST', `/api/changes/${op.id}/revert`);
  assert.equal(r.statusCode, 200, r.body);
};
const card = (cookie, q) => json(cookie, 'GET', `/api/places/card?${new URLSearchParams(q)}`);
const entries = (ops) => ops.flatMap((o) => o.entries.map((e) => ({ ...e, op: o.op })));

const GORKI = { kind: 'village', name: 'Горки', volost: 'Ивановская', uezd: 'Старицкий', gubernia: 'Тверская', now: 'Старицкий район, Тверская область' };
const TITLE = 'деревня Горки, Ивановская волость, Старицкий уезд, Тверская губерния';

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await login('owner');
  editor = await login('editor');
  relative = await login('relative');
  guest = await login('viewer');
});
after(async () => { await app.close(); await pool.end(); });

test('место в справочник: текст в карточках заменяется полным названием, откат возвращает всё разом', async () => {
  const ivan = await add({ given: 'Иван', surname: 'Смирнов', sex: 'M', living: false, birth_date: '12.03.1890 ст. ст.', birth_place: 'д. Горки', burial_place: 'Д.  горки' });
  const anna = await add({ given: 'Анна', surname: 'Смирнова', sex: 'F', living: false, birth_place: 'Старица' });
  await json(owner, 'POST', '/api/relations', { personId: anna.id, to: ivan.id, type: 'spouse' });
  const fam = (await json(owner, 'GET', '/api/tree')).families[0];
  await json(owner, 'PATCH', `/api/families/${fam.id}`, { start_date: '1912', place: 'д. горки' });
  const ev = await json(editor, 'POST', `/api/persons/${ivan.id}/life-events`, { kind: 'work', date: '1910', place: 'д. Горки', title: 'кузница' });

  // Права и проверки.
  for (const c of [relative, guest]) assert.equal((await call(c, 'POST', '/api/places', GORKI)).statusCode, 403);
  assert.equal((await call(editor, 'POST', '/api/places', { ...GORKI, name: ' ' })).statusCode, 400);
  assert.equal((await call(editor, 'POST', '/api/places', { ...GORKI, kind: 'zamok' })).statusCode, 400);

  const place = await json(editor, 'POST', '/api/places', { ...GORKI, from: 'д. Горки' });
  assert.equal(place.title, TITLE);
  assert.equal((await call(editor, 'POST', '/api/places', { ...GORKI, name: 'горки' })).statusCode, 409);
  let p = await person(ivan.id);
  assert.equal(p.birth_place, TITLE);
  assert.equal(p.burial_place, TITLE);
  assert.equal((await person(anna.id)).birth_place, 'Старица');
  assert.equal((await json(owner, 'GET', '/api/tree')).families[0].place, TITLE);
  assert.equal((await json(owner, 'GET', `/api/life-events/${ev.id}`)).place, TITLE);
  // Справочник приходит с деревом всем, и гостю: данных людей в нём нет.
  assert.deepEqual((await json(guest, 'GET', '/api/tree')).places.map((x) => x.title), [TITLE]);

  // Одно действие: место и замены в карточках.
  let op = await lastOp();
  assert.deepEqual(op.entries.map((e) => [e.entity, e.action]).sort(), [['event', 'update'], ['family', 'update'], ['person', 'update'], ['place', 'add']]);
  assert.deepEqual(op.entries.find((e) => e.entity === 'person').before, { birth_place: 'д. Горки', burial_place: 'Д.  горки' });
  await revert(op);
  p = await person(ivan.id);
  assert.deepEqual([p.birth_place, p.burial_place], ['д. Горки', 'Д.  горки']);
  assert.equal((await json(owner, 'GET', '/api/tree')).families[0].place, 'д. горки');
  assert.equal((await json(owner, 'GET', `/api/life-events/${ev.id}`)).place, 'д. Горки');
  assert.deepEqual((await json(owner, 'GET', '/api/places')), []);
  // Отменённое возвращается.
  await revert(await lastOp());
  assert.equal((await person(ivan.id)).birth_place, TITLE);
  assert.equal((await json(owner, 'GET', '/api/places')).length, 1);

  // Новое название меняет текст у людей — одно действие, откат целиком.
  await json(editor, 'PATCH', `/api/places/${place.id}`, { volost: 'Берновская' });
  const renamed = 'деревня Горки, Берновская волость, Старицкий уезд, Тверская губерния';
  assert.equal((await person(ivan.id)).birth_place, renamed);
  assert.equal((await json(owner, 'GET', '/api/tree')).families[0].place, renamed);
  assert.equal((await json(owner, 'GET', `/api/life-events/${ev.id}`)).place, renamed);
  op = await lastOp();
  const pe = op.entries.find((e) => e.entity === 'place');
  assert.deepEqual([pe.before, pe.after], [{ volost: 'Ивановская', title: TITLE }, { volost: 'Берновская', title: renamed }]);
  assert.equal(op.entries.length, 4);
  // «Как сейчас» — без замен в карточках.
  await json(editor, 'PATCH', `/api/places/${place.id}`, { now: 'Старицкий муниципальный округ' });
  assert.deepEqual((await lastOp()).entries.map((e) => e.entity), ['place']);
  await revert(await lastOp());
  await revert(op);
  assert.equal((await person(ivan.id)).birth_place, TITLE);
  assert.equal((await json(owner, 'GET', `/api/life-events/${ev.id}`)).place, TITLE);
  assert.equal((await json(owner, 'GET', '/api/places'))[0].title, TITLE);

  // Удаление: место остаётся у людей текстом; откат возвращает его в справочник.
  await json(editor, 'DELETE', `/api/places/${place.id}`);
  assert.deepEqual(await json(owner, 'GET', '/api/places'), []);
  assert.equal((await person(ivan.id)).birth_place, TITLE);
  await revert(await lastOp());
  assert.equal((await json(owner, 'GET', '/api/places')).length, 1);

  // Подсказка: места из дерева — только тем, кто правит.
  const used = await json(editor, 'GET', '/api/places/used');
  assert.deepEqual(used.sort(), [TITLE, 'Старица'].sort());
  for (const c of [relative, guest]) assert.equal((await call(c, 'GET', '/api/places/used')).statusCode, 403);

  // Текст, записанный по-другому, — к месту справочника.
  const olga = await add({ given: 'Ольга', surname: 'Смирнова', sex: 'F', living: false, death_place: 'Горки, Старицкий у.' });
  assert.equal((await call(relative, 'POST', `/api/places/${place.id}/adopt`, { text: 'Горки, Старицкий у.' })).statusCode, 403);
  assert.equal((await json(editor, 'POST', `/api/places/${place.id}/adopt`, { text: 'горки,  старицкий у.' })).changed, 1);
  assert.equal((await person(olga.id)).death_place, TITLE);
  await revert(await lastOp());
  assert.equal((await person(olga.id)).death_place, 'Горки, Старицкий у.');

  // Журнал и сводка.
  const ops = await json(owner, 'GET', '/api/changes');
  const addOp = ops.find((o) => o.entries.some((e) => e.entity === 'place' && e.action === 'add'));
  assert.equal(digestText('Елена', 'F', entries([addOp]), [addOp.op]), 'Елена добавила 1 место');
  const upd = ops.find((o) => o.entries.some((e) => e.entity === 'place' && e.action === 'update'));
  assert.equal(digestText('Елена', 'F', entries([upd]), [upd.op]), 'Елена изменила 1 место');
});

test('карточка места: кто родился, вступил в брак, жил, умер, похоронен; гостю — без живых', async () => {
  const place = (await json(owner, 'GET', '/api/places')).find((x) => x.title === TITLE);
  const petr = await add({ given: 'Пётр', surname: 'Смирнов', sex: 'M', living: true, birth_date: '1960', birth_place: TITLE });
  const masha = await add({ given: 'Мария', surname: 'Смирнова', sex: 'F', living: true, birth_date: '1962' });
  await json(owner, 'POST', '/api/relations', { personId: masha.id, to: petr.id, type: 'spouse' });
  const fam = (await json(owner, 'GET', '/api/tree')).families.find((f) => [f.partner1, f.partner2].includes(petr.id));
  await json(owner, 'PATCH', `/api/families/${fam.id}`, { start_date: '1985', place: TITLE });
  const job = await json(editor, 'POST', `/api/persons/${petr.id}/life-events`, { kind: 'work', date: '1980', place: TITLE });

  const full = await card(relative, { id: place.id });
  assert.equal(full.place.now, GORKI.now);
  assert.equal(full.text, TITLE);
  const ivan = (await json(owner, 'GET', '/api/tree')).persons.find((p) => p.given === 'Иван');
  assert.deepEqual(full.born.map((x) => x.id).sort(), [ivan.id, petr.id].sort());
  assert.deepEqual(full.born.find((x) => x.id === ivan.id).date, '12.03.1890 ст. ст.');
  assert.deepEqual(full.buried.map((x) => x.id), [ivan.id]);
  assert.equal(full.married.length, 2);
  assert.equal(full.events.length, 2);
  // По тексту, как записано в карточке, — то же место.
  assert.deepEqual((await card(owner, { text: TITLE.toUpperCase() })).place.id, place.id);

  const g = await card(guest, { text: TITLE });
  assert.deepEqual(g.born.map((x) => x.id), [ivan.id]);
  assert.equal(g.married.length, 1);
  assert.equal(g.events.some((e) => e.id === job.id), false);
  assert.equal(g.events.length, 1);

  // Места нет в справочнике — карточка по тексту.
  const other = await card(guest, { text: 'Старица' });
  assert.equal(other.place, null);
  assert.equal(other.born.length, 1);
  assert.equal((await call(guest, 'GET', '/api/places/card')).statusCode, 400);

  // Лента гостя: место справочника — с названием, правки карточек — без значений.
  await json(editor, 'POST', '/api/places', { kind: 'town', name: 'Старица', uezd: 'Старицкий', gubernia: 'Тверская', from: 'Старица' });
  const feed = await json(guest, 'GET', '/api/feed');
  const op = feed.items.find((i) => i.entries?.some((x) => x.entity === 'place'));
  assert.deepEqual(op.entries.find((x) => x.entity === 'place').after, { kind: 'town', title: 'город Старица, Старицкий уезд, Тверская губерния' });
  assert.deepEqual(op.entries.find((x) => x.entity === 'person').after, { birth_place: null });

  // GEDCOM: место с тем, как это сейчас, дата по старому стилю — с календарём.
  const ged = (await call(guest, 'GET', '/api/export.ged')).body;
  assert.match(ged, new RegExp(`1 BIRT\\n2 DATE @#DJULIAN@ 12 MAR 1890\\n2 PLAC ${TITLE}\\n3 NOTE сейчас: ${GORKI.now}`));
});
