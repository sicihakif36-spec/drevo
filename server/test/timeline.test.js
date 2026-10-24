// Лента жизни: свои события человека с участниками — создание, правка, участники, удаление, возврат и откат каждого действия;
// источники и достоверность у события; приватность гостей, GEDCOM, лента и сводка.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { signIn } from './helpers.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { digestText } from '../src/push.js';

let app;
const H = { 'x-drevo': '1' };
let owner;
let editor;
let guest;

async function login(role) {
  return signIn(app, role, { label: role });
}
const call = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });
const json = async (...args) => {
  const r = await call(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const add = async (person) => json(owner, 'POST', '/api/persons', { person });
const life = (cookie, id) => json(cookie, 'GET', `/api/persons/${id}/life-events`);
const lastOp = async () => (await json(owner, 'GET', '/api/changes'))[0];
const revert = async (op) => {
  const r = await call(owner, 'POST', `/api/changes/${op.id}/revert`);
  assert.equal(r.statusCode, 200, r.body);
};
const entries = (ops) => ops.flatMap((o) => o.entries.map((e) => ({ ...e, op: o.op })));

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await login('owner');
  editor = await login('editor');
  guest = await login('viewer');
});
after(async () => { await app.close(); await pool.end(); });

test('событие: создание с участниками, правка, участники, удаление — всё отменяется и возвращается', async () => {
  const petr = await add({ given: 'Пётр', surname: 'Смирнов', sex: 'M', living: false, birth_date: '1912' });
  const klav = await add({ given: 'Клавдия', surname: 'Смирнова', sex: 'F', living: false, birth_date: '1918' });
  const yuri = await add({ given: 'Юрий', surname: 'Смирнов', sex: 'M', living: false, birth_date: '1946' });

  // Без вида или с непонятным видом — понятная ошибка.
  assert.equal((await call(editor, 'POST', `/api/persons/${petr.id}/life-events`, { date: '1950' })).statusCode, 400);
  assert.equal((await call(editor, 'POST', `/api/persons/${petr.id}/life-events`, { kind: 'polet' })).statusCode, 400);

  // Переезд всей семьи — виден у каждого участника.
  const ev = await json(editor, 'POST', `/api/persons/${petr.id}/life-events`, {
    kind: 'move', date: 'с 1952 по 1953', place: 'г. Калинин', title: 'из д. Горки', body: 'Дали комнату в бараке', persons: [klav.id],
  });
  assert.equal(ev.kind, 'move');
  assert.deepEqual(ev.persons, [petr.id, klav.id].sort());
  for (const p of [petr, klav]) assert.deepEqual((await life(owner, p.id)).map((e) => e.id), [ev.id]);
  assert.deepEqual(await life(owner, yuri.id), []);
  let op = await lastOp();
  assert.deepEqual(op.entries.map((e) => [e.entity, e.action]), [['event', 'add']]);
  assert.deepEqual(op.entries[0].after, { kind: 'move', title: 'из д. Горки', date: 'с 1952 по 1953' });
  assert.deepEqual(op.entries[0].persons.sort(), [petr.id, klav.id].sort());

  // Правка: в журнале — было и стало.
  await json(editor, 'PATCH', `/api/life-events/${ev.id}`, { date: '1952', place: 'г. Калинин' });
  op = await lastOp();
  assert.deepEqual(op.entries[0].before, { date: 'с 1952 по 1953' });
  assert.equal((await json(owner, 'GET', `/api/life-events/${ev.id}`)).date, '1952');
  await revert(op);
  assert.equal((await json(owner, 'GET', `/api/life-events/${ev.id}`)).date, 'с 1952 по 1953');
  assert.equal((await call(editor, 'PATCH', `/api/life-events/${ev.id}`, { kind: 'polet' })).statusCode, 400);

  // Участники: добавить, убрать; последнего убрать нельзя.
  assert.deepEqual((await json(editor, 'PUT', `/api/life-events/${ev.id}/persons/${yuri.id}`)).persons, [petr.id, klav.id, yuri.id].sort());
  assert.deepEqual((await life(owner, yuri.id)).map((e) => e.id), [ev.id]);
  await revert(await lastOp());
  assert.deepEqual(await life(owner, yuri.id), []);
  await json(editor, 'DELETE', `/api/life-events/${ev.id}/persons/${klav.id}`);
  assert.deepEqual(await life(owner, klav.id), []);
  assert.equal((await call(editor, 'DELETE', `/api/life-events/${ev.id}/persons/${petr.id}`)).statusCode, 409);
  await revert(await lastOp());
  assert.deepEqual((await life(owner, klav.id)).map((e) => e.id), [ev.id]);

  // Удаление мягкое; откат возвращает, откат отката снова удаляет.
  await json(editor, 'DELETE', `/api/life-events/${ev.id}`);
  assert.deepEqual(await life(owner, petr.id), []);
  assert.equal((await call(owner, 'GET', `/api/life-events/${ev.id}`)).statusCode, 404);
  assert.equal((await call(editor, 'PATCH', `/api/life-events/${ev.id}`, { date: '1960' })).statusCode, 404);
  await revert(await lastOp());
  assert.deepEqual((await life(owner, petr.id)).map((e) => e.id), [ev.id]);
  await revert(await lastOp());
  assert.deepEqual(await life(owner, petr.id), []);
  await revert(await lastOp());

  // Откат создания убирает событие у всех участников.
  const study = await json(editor, 'POST', `/api/persons/${yuri.id}/life-events`, { kind: 'study', date: '1963–1968' });
  await revert(await lastOp());
  assert.deepEqual(await life(owner, yuri.id), []);
  assert.equal((await call(owner, 'GET', `/api/life-events/${study.id}`)).statusCode, 404);

  // Удалённый участник в событии не показывается, событие остаётся у остальных.
  await json(owner, 'DELETE', `/api/persons/${klav.id}`);
  assert.deepEqual((await json(owner, 'GET', `/api/life-events/${ev.id}`)).persons, [petr.id]);
  await revert(await lastOp());
});

test('источники и достоверность у события; удаление события прячет их, возврат возвращает', async () => {
  const p = await add({ given: 'Василий', surname: 'Смирнов', sex: 'M', living: false, birth_date: '1915', death_date: '1943' });
  const war = await json(owner, 'POST', `/api/persons/${p.id}/life-events`, { kind: 'war', date: '1942–1943', unit: '1-я ударная армия', rank: 'рядовой' });
  const at = { subject: 'event', subject_id: war.id, fact: 'event' };
  const s = await json(editor, 'POST', '/api/sources', { kind: 'pamyat', title: 'Донесение о потерях', archive: 'ЦАМО', cite: { ...at, page: 'стр. 12' } });
  await json(editor, 'PUT', '/api/quality', { ...at, quality: 'document' });
  let card = await json(owner, 'GET', `/api/persons/${p.id}/sources`);
  assert.deepEqual(card.citations.map((c) => [c.subject, c.subject_id, c.page]), [['event', war.id, 'стр. 12']]);
  assert.deepEqual(card.citations[0].persons, [p.id]);
  assert.deepEqual(card.quality, [{ ...at, quality: 'document' }]);
  assert.deepEqual(card.sources.map((x) => x.persons), [[p.id]]);
  const src = await json(owner, 'GET', `/api/sources/${s.id}`);
  assert.equal(src.citations[0].event_kind, 'war');

  // Сведение «событие» — только у события; у несуществующего — 404.
  assert.equal((await call(editor, 'PUT', '/api/quality', { ...at, fact: 'birth_date', quality: 'oral' })).statusCode, 400);
  assert.equal((await call(editor, 'PUT', '/api/quality', { ...at, subject_id: s.id, quality: 'oral' })).statusCode, 404);

  // Удалили событие — его источник ни к чему не привязан; отметку у удалённого не вернуть, пока не вернёшь событие.
  await json(editor, 'PUT', '/api/quality', { ...at, quality: 'oral' });
  const marked = await lastOp();
  await json(editor, 'DELETE', `/api/life-events/${war.id}`);
  card = await json(owner, 'GET', `/api/persons/${p.id}/sources`);
  assert.deepEqual([card.citations, card.sources], [[], []]);
  assert.deepEqual((await json(owner, 'GET', `/api/sources/${s.id}`)).persons, []);
  const r = await call(owner, 'POST', `/api/changes/${marked.id}/revert`);
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /событие удалено/);
  await revert(await lastOp());
  card = await json(owner, 'GET', `/api/persons/${p.id}/sources`);
  assert.equal(card.citations.length, 1);
  await revert(marked);
  assert.equal((await json(owner, 'GET', `/api/persons/${p.id}/sources`)).quality[0].quality, 'document');

  // Источник у события снимается и возвращается.
  await json(editor, 'DELETE', `/api/citations/${card.citations[0].id}`);
  assert.equal((await json(owner, 'GET', `/api/persons/${p.id}/sources`)).citations.length, 0);
  await revert(await lastOp());
  assert.equal((await json(owner, 'GET', `/api/persons/${p.id}/sources`)).citations.length, 1);
});

test('гость: событие с живым скрыто везде, события ушедших видны; гость не пишет', async () => {
  const dead = await add({ given: 'Пётр', surname: 'Орлов', sex: 'M', living: false, birth_date: '1912', death_date: '1985' });
  const kid = await add({ given: 'Людмила', surname: 'Орлова', sex: 'F', birth_date: '1950' });
  const award = await json(owner, 'POST', `/api/persons/${dead.id}/life-events`, {
    kind: 'award', date: '1943', title: 'Медаль «За отвагу»', place: 'Калининский фронт', body: 'За бой у деревни Б.',
  });
  const move = await json(owner, 'POST', `/api/persons/${dead.id}/life-events`, {
    kind: 'move', date: '1955', place: 'Тайный город', body: 'Секретный переезд', persons: [kid.id],
  });
  const s = await json(owner, 'POST', '/api/sources', { kind: 'zags', title: 'Прописка', cite: { subject: 'event', subject_id: move.id, fact: 'event' } });
  await json(owner, 'PUT', '/api/quality', { subject: 'event', subject_id: move.id, fact: 'event', quality: 'oral' });

  assert.deepEqual((await life(guest, dead.id)).map((e) => e.id), [award.id]);
  assert.deepEqual(await life(guest, kid.id), []);
  assert.equal((await call(guest, 'GET', `/api/life-events/${move.id}`)).statusCode, 404);
  assert.equal((await call(guest, 'GET', `/api/life-events/${award.id}`)).statusCode, 200);
  assert.deepEqual((await life(owner, dead.id)).map((e) => e.id), [award.id, move.id], 'участник видит всё');
  const card = await json(guest, 'GET', `/api/persons/${dead.id}/sources`);
  assert.deepEqual([card.citations, card.quality, card.sources], [[], [], []]);
  assert.equal((await call(guest, 'GET', `/api/sources/${s.id}`)).statusCode, 404);

  // Лента: без описаний, мест, дат и названий; у события с живым — и без вида.
  const feed = (await json(guest, 'GET', '/api/feed')).items;
  const text = JSON.stringify(feed);
  for (const id of [award.id, move.id]) assert.ok(!text.includes(id), id);
  // Без номеров записей: случайный uuid может содержать «1943» или «1955».
  const values = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '');
  for (const t of ['Медаль', 'Калининский', 'За бой', '1943', 'Тайный', 'Секретный', '1955']) assert.ok(!values.includes(t), t);
  const added = (ids) => feed.find((i) => i.kind === 'op' && i.entries[0].entity === 'event' && i.entries[0].action === 'add'
    && i.entries[0].persons.sort().join() === ids.sort().join()).entries[0];
  assert.deepEqual(added([dead.id, kid.id]).after, {});
  assert.deepEqual(added([dead.id]).after, { kind: 'award' });
  assert.ok(JSON.stringify((await json(owner, 'GET', '/api/feed')).items).includes('Медаль'));

  // GEDCOM гостя — без события с живым.
  const ged = (await call(guest, 'GET', '/api/export.ged')).body;
  assert.ok(ged.includes('Медаль «За отвагу»'));
  assert.ok(!ged.includes('Тайный город'));
  assert.ok(!ged.includes('Прописка'));

  // Гость не пишет.
  for (const [method, url, body] of [
    ['POST', `/api/persons/${dead.id}/life-events`, { kind: 'other' }], ['PATCH', `/api/life-events/${award.id}`, { date: '1944' }],
    ['DELETE', `/api/life-events/${award.id}`], ['PUT', `/api/life-events/${award.id}/persons/${kid.id}`],
    ['DELETE', `/api/life-events/${award.id}/persons/${dead.id}`],
    ['PUT', '/api/quality', { subject: 'event', subject_id: award.id, fact: 'event', quality: 'guess' }],
  ]) assert.equal((await call(guest, method, url, body)).statusCode, 403, `${method} ${url}`);
});

test('GEDCOM: события стандартными тегами, период FROM … TO …, цитаты и QUAY', async () => {
  const p = await add({ given: 'Николай', surname: 'Белов', sex: 'M', living: false, birth_date: '1900', death_date: '1970' });
  const war = await json(owner, 'POST', `/api/persons/${p.id}/life-events`, {
    kind: 'war', date: '1941–1945', place: 'Ленинградский фронт', title: 'Великая Отечественная', unit: '45-я гв. сд', rank: 'сержант',
    body: 'Дошёл до Риги',
  });
  await json(owner, 'POST', `/api/persons/${p.id}/life-events`, { kind: 'study', date: 'с 1915 по 1918', title: 'Тверская гимназия' });
  await json(owner, 'POST', `/api/persons/${p.id}/life-events`, { kind: 'move', date: 'около 1925', place: 'г. Тверь', title: 'из с. Белое' });
  await json(owner, 'POST', `/api/persons/${p.id}/life-events`, { kind: 'award', date: '1944', title: 'Орден Красной Звезды' });
  await json(owner, 'POST', `/api/persons/${p.id}/life-events`, { kind: 'work', date: 'с 1946', title: 'завод «Пролетарка», мастер' });
  const s = await json(owner, 'POST', '/api/sources', { kind: 'military', title: 'Наградной лист',
    cite: { subject: 'event', subject_id: war.id, fact: 'event', page: 'л. 3' } });
  await json(owner, 'PUT', '/api/quality', { subject: 'event', subject_id: war.id, fact: 'event', quality: 'document' });
  const ged = (await call(owner, 'GET', '/api/export.ged')).body;
  const indi = ged.slice(ged.indexOf('1 NAME Николай /Белов/'));
  const ref = /0 (@S\d+@) SOUR\n1 TITL Наградной лист/.exec(ged)?.[1];
  assert.ok(ref && s.id);
  assert.match(indi, new RegExp(`1 _MILT Великая Отечественная\\n2 TYPE Война\\n2 DATE FROM 1941 TO 1945\\n2 PLAC Ленинградский фронт\\n`
    + `2 NOTE Часть: 45-я гв\\. сд\\n3 CONT Звание: сержант\\n3 CONT Дошёл до Риги\\n2 SOUR ${ref}\\n3 PAGE л\\. 3\\n3 QUAY 3`));
  assert.match(indi, /1 EDUC Тверская гимназия\n2 DATE FROM 1915 TO 1918\n/);
  assert.match(indi, /1 RESI\n2 DATE ABT 1925\n2 PLAC г\. Тверь\n2 NOTE Откуда: из с\. Белое\n/);
  assert.match(indi, /1 EVEN Орден Красной Звезды\n2 TYPE Награда\n2 DATE 1944\n/);
  assert.match(indi, /1 OCCU завод «Пролетарка», мастер\n2 DATE FROM 1946\n/);
});

test('лента и сводка: «добавила 2 события», правка, удаление', async () => {
  const p = await add({ given: 'Тамара', surname: 'Орлова', sex: 'F', living: false, birth_date: '1922' });
  const a = await json(editor, 'POST', `/api/persons/${p.id}/life-events`, { kind: 'study', date: '1940' });
  await json(editor, 'POST', `/api/persons/${p.id}/life-events`, { kind: 'work', date: '1945' });
  let ops = (await json(owner, 'GET', '/api/changes')).slice(0, 2);
  assert.equal(digestText('Елена', 'F', entries(ops), ops.map((o) => o.op)), 'Елена добавила 2 события');
  await json(editor, 'PATCH', `/api/life-events/${a.id}`, { place: 'Калинин' });
  await json(editor, 'DELETE', `/api/life-events/${a.id}`);
  ops = (await json(owner, 'GET', '/api/changes')).slice(0, 2);
  assert.equal(digestText('Иван', 'M', entries(ops), ops.map((o) => o.op)), 'Иван изменил 1 событие, удалил 1 событие');
  const feed = (await json(owner, 'GET', '/api/feed')).items;
  assert.ok(feed.some((i) => i.kind === 'op' && i.entries[0].entity === 'event' && i.entries[0].action === 'delete'));
});

test('брак: вид связи, дата, место, развод — в журнале только изменённое, откат; гостю у живых без дат и места; GEDCOM', async () => {
  const a = await add({ given: 'Иван', surname: 'Белов', sex: 'M', living: false, birth_date: '1900' });
  const b = await json(owner, 'POST', '/api/persons', { person: { given: 'Мария', surname: 'Белова', sex: 'F', living: false, birth_date: '1905' },
    relation: { to: a.id, type: 'spouse' } });
  const fam = (await json(owner, 'GET', '/api/tree')).families.find((f) => [f.partner1, f.partner2].includes(b.id));
  const patch = (body) => json(editor, 'PATCH', `/api/families/${fam.id}`, body);

  await patch({ kind: 'marriage', start_date: '1925', place: 'Троицкая церковь с. Белое', ended: '', end_date: '' });
  let op = await lastOp();
  assert.deepEqual(op.entries[0].before, { start_date: '', place: '' }, 'не изменившееся в журнал не пишется');
  await patch({ ended: 'divorce', end_date: '1940' });
  const f = (await json(owner, 'GET', '/api/tree')).families.find((x) => x.id === fam.id);
  assert.deepEqual([f.place, f.ended, f.end_date], ['Троицкая церковь с. Белое', 'divorce', '1940']);
  const ged = (await call(owner, 'GET', '/api/export.ged')).body;
  assert.match(ged, /1 MARR\n2 DATE 1925\n2 PLAC Троицкая церковь с\. Белое\n/);
  assert.match(ged, /1 DIV\n2 DATE 1940\n/);
  await revert(await lastOp());
  op = await lastOp();
  assert.equal((await json(owner, 'GET', '/api/tree')).families.find((x) => x.id === fam.id).ended, '');
  assert.deepEqual(op.entries[0].after, { ended: '', end_date: '' });

  // Брак живого: гость не видит ни даты, ни места.
  const kid = await add({ given: 'Олег', surname: 'Белов', sex: 'M', birth_date: '1990' });
  const wife = await json(owner, 'POST', '/api/persons', { person: { given: 'Ольга', sex: 'F', birth_date: '1992' }, relation: { to: kid.id, type: 'spouse' } });
  const fam2 = (await json(owner, 'GET', '/api/tree')).families.find((x) => [x.partner1, x.partner2].includes(wife.id));
  await json(owner, 'PATCH', `/api/families/${fam2.id}`, { start_date: '2015', place: 'ЗАГС Тайного района' });
  const g = (await json(guest, 'GET', '/api/tree')).families.find((x) => x.id === fam2.id);
  assert.deepEqual([g.start_date, g.place], ['', '']);
  assert.ok(!(await call(guest, 'GET', '/api/export.ged')).body.includes('Тайного'));
  assert.equal((await call(guest, 'PATCH', `/api/families/${fam.id}`, { place: 'x' })).statusCode, 403);
});
