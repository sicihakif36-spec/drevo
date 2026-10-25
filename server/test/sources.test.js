// Источники и достоверность: источник по шаблону и строка ссылки, привязки к сведениям с уточнением, достоверность без источника,
// один источник у нескольких людей, правка, удаление, возврат и откат каждого действия; приватность гостей, GEDCOM, лента и сводка.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { signIn } from './helpers.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { digestText } from '../src/push.js';
import { citeText } from '../../shared/sources.js';

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
const card = (cookie, id) => json(cookie, 'GET', `/api/persons/${id}/sources`);
const lastOp = async () => (await json(owner, 'GET', '/api/changes'))[0];
const revert = async (op) => {
  const r = await call(owner, 'POST', `/api/changes/${op.id}/revert`);
  assert.equal(r.statusCode, 200, r.body);
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function scan(personId) {
  const b = 'drevo-scan';
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="kind"\r\n\r\ndoc\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="metrika.png"\r\nContent-Type: image/png\r\n\r\n`),
    PNG,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  const r = await app.inject({ method: 'POST', url: `/api/persons/${personId}/media`, payload,
    headers: { ...H, cookie: owner, 'content-type': `multipart/form-data; boundary=${b}` } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await login('owner');
  editor = await login('editor');
  guest = await login('viewer');
});
after(async () => { await app.close(); await pool.end(); });

test('строка ссылки на дело по шаблону', () => {
  assert.equal(citeText({ archive: 'ГАТО', fond: '160', opis: '1', delo: '12', sheet: '34', verso: true }), 'ГАТО, ф. 160, оп. 1, д. 12, л. 34 об.');
  assert.equal(citeText({ archive: 'ЦАМО', fond: '58', delo: '9' }), 'ЦАМО, ф. 58, д. 9');
  assert.equal(citeText({ title: 'Со слов бабушки' }), '');
});

test('источник по шаблону: создание с привязкой, один источник у нескольких людей, правка, удаление — всё отменяется', async () => {
  const petr = await add({ given: 'Пётр', surname: 'Смирнов', sex: 'M', living: false, birth_date: '12.06.1912', birth_place: 'д. Горки' });
  const vas = await add({ given: 'Василий', surname: 'Смирнов', sex: 'M', living: false, birth_date: '1915' });
  const doc = await scan(petr.id);

  // Метрическая книга со сканом — сразу у даты рождения Петра, с уточнением.
  const s = await json(editor, 'POST', '/api/sources', {
    kind: 'metric', title: 'Метрическая книга Троицкой церкви с. Горки, 1912', archive: 'ГАТО', fond: '160', opis: '1', delo: '12',
    sheet: '34', verso: true, media_id: doc.id, url: 'pamyat-naroda.ru/x',
    cite: { subject: 'person', subject_id: petr.id, fact: 'birth_date', page: 'запись № 57' },
  });
  assert.equal(s.kind, 'metric');
  assert.equal(citeText(s), 'ГАТО, ф. 160, оп. 1, д. 12, л. 34 об.');
  assert.equal(s.media_id, doc.id);
  assert.equal(s.url, 'https://pamyat-naroda.ru/x', 'ссылка без https — дописывается');
  assert.equal(s.user_name, 'editor');
  assert.deepEqual(s.persons, [petr.id]);
  const created = await lastOp();
  assert.deepEqual(created.entries.map((e) => `${e.entity}:${e.action}`), ['source:add', 'citation:add'], 'создание с привязкой — одно действие');

  let c = await card(owner, petr.id);
  assert.deepEqual(c.sources.map((x) => x.id), [s.id]);
  assert.equal(c.citations.length, 1);
  assert.equal(c.citations[0].fact, 'birth_date');
  assert.equal(c.citations[0].page, 'запись № 57');

  // Тот же источник — и у места рождения Петра, и у Василия: один источник, несколько людей.
  await json(owner, 'POST', '/api/citations', { source_id: s.id, subject: 'person', subject_id: petr.id, fact: 'birth_place' });
  const cv = await json(owner, 'POST', '/api/citations', { source_id: s.id, subject: 'person', subject_id: vas.id, fact: 'birth_date', page: '№ 12' });
  assert.equal((await call(owner, 'POST', '/api/citations', { source_id: s.id, subject: 'person', subject_id: vas.id, fact: 'birth_date' })).statusCode, 409);
  assert.equal((await call(owner, 'POST', '/api/citations', { source_id: s.id, subject: 'person', subject_id: vas.id, fact: 'shoe_size' })).statusCode, 400);
  const full = await json(owner, 'GET', `/api/sources/${s.id}`);
  assert.deepEqual(full.persons, [petr.id, vas.id].sort());
  assert.equal(full.citations.length, 3);
  assert.equal((await card(owner, vas.id)).sources[0].id, s.id);
  assert.ok((await json(owner, 'GET', `/api/persons/${vas.id}/history`)).some((o) => o.entries.some((e) => e.entity === 'citation')),
    'привязка — в истории правок Василия');

  // Уточнение: правка и откат.
  await json(owner, 'PATCH', `/api/citations/${cv.id}`, { page: '№ 13' });
  assert.equal((await card(owner, vas.id)).citations[0].page, '№ 13');
  await revert(await lastOp());
  assert.equal((await card(owner, vas.id)).citations[0].page, '№ 12');

  // Убрать источник у сведения; откат возвращает привязку с тем же номером.
  await json(owner, 'DELETE', `/api/citations/${cv.id}`);
  assert.deepEqual((await card(owner, vas.id)).sources, []);
  assert.equal((await call(owner, 'DELETE', `/api/citations/${cv.id}`)).statusCode, 404);
  await revert(await lastOp());
  assert.equal((await card(owner, vas.id)).citations[0].id, cv.id);

  // Правка источника и откат.
  await json(owner, 'PATCH', `/api/sources/${s.id}`, { delo: '13', verso: false, note: 'Запись неразборчива' });
  let cur = await json(owner, 'GET', `/api/sources/${s.id}`);
  assert.equal(citeText(cur), 'ГАТО, ф. 160, оп. 1, д. 13, л. 34');
  const upd = await lastOp();
  assert.equal(upd.entries[0].after.title, s.title, 'название — для подписи');
  assert.deepEqual(upd.entries[0].persons, [petr.id, vas.id].sort());
  await revert(upd);
  cur = await json(owner, 'GET', `/api/sources/${s.id}`);
  assert.equal(citeText(cur), 'ГАТО, ф. 160, оп. 1, д. 12, л. 34 об.');
  assert.equal(cur.note, '');
  assert.equal((await call(owner, 'PATCH', `/api/sources/${s.id}`, { kind: 'diary' })).statusCode, 400);
  assert.equal((await call(owner, 'PATCH', `/api/sources/${s.id}`, { media_id: vas.id })).statusCode, 400, 'скан — только из альбома');

  // Удаление мягкое: источник пропадает из карточек обоих; удалённый не правят; откат возвращает его с привязками.
  const del = await json(owner, 'DELETE', `/api/sources/${s.id}`);
  assert.deepEqual((await card(owner, petr.id)).sources, []);
  assert.deepEqual((await card(owner, vas.id)).citations, []);
  assert.equal((await call(owner, 'GET', `/api/sources/${s.id}`)).statusCode, 404);
  assert.equal((await call(owner, 'PATCH', `/api/sources/${s.id}`, { note: 'x' })).statusCode, 404);
  assert.equal((await call(owner, 'POST', '/api/citations', { source_id: s.id, subject: 'person', subject_id: vas.id, fact: 'death_date' })).statusCode, 404);
  await revert({ id: del.changeId });
  assert.equal((await card(owner, petr.id)).citations.length, 2);
  assert.equal((await card(owner, vas.id)).citations.length, 1);

  // Скан удалили из альбома — у источника его больше не видно.
  await json(owner, 'DELETE', `/api/media/${doc.id}`);
  assert.equal((await json(owner, 'GET', `/api/sources/${s.id}`)).media_id, null);
  await revert(await lastOp());

  // Отмена создания убирает источник вместе с первой привязкой, отмена отмены — возвращает.
  await revert(created);
  assert.equal((await call(owner, 'GET', `/api/sources/${s.id}`)).statusCode, 404);
  assert.deepEqual((await card(owner, petr.id)).sources, []);
  await revert(await lastOp());
  assert.equal((await card(owner, petr.id)).citations.length, 2);
  assert.ok((await json(owner, 'GET', '/api/sources')).some((x) => x.id === s.id), 'в общем списке для выбора');
});

test('достоверность: без источника, у брака; смена и снятие отменяются', async () => {
  const a = await add({ given: 'Иван', surname: 'Смирнов', sex: 'M', living: false, birth_date: 'около 1880' });
  const b = await json(owner, 'POST', '/api/persons', { person: { given: 'Аграфена', sex: 'F', living: false }, relation: { to: a.id, type: 'spouse' } });
  const fam = (await json(owner, 'GET', '/api/tree')).families.find((f) => [f.partner1, f.partner2].includes(b.id));

  // «Со слов» без всякого источника.
  await json(editor, 'PUT', '/api/quality', { subject: 'person', subject_id: a.id, fact: 'birth_date', quality: 'oral' });
  assert.deepEqual((await card(owner, a.id)).quality, [{ subject: 'person', subject_id: a.id, fact: 'birth_date', quality: 'oral' }]);
  await json(editor, 'PUT', '/api/quality', { subject: 'person', subject_id: a.id, fact: 'birth_date', quality: 'document' });
  const change = await lastOp();
  assert.deepEqual([change.entries[0].before.quality, change.entries[0].after.quality], ['oral', 'document']);
  await revert(change);
  assert.equal((await card(owner, a.id)).quality[0].quality, 'oral');
  // Снять отметку и вернуть.
  await json(editor, 'PUT', '/api/quality', { subject: 'person', subject_id: a.id, fact: 'birth_date', quality: '' });
  assert.deepEqual((await card(owner, a.id)).quality, []);
  await revert(await lastOp());
  assert.equal((await card(owner, a.id)).quality[0].quality, 'oral');
  // Позже отметку поменяли — старую правку не отменить.
  await json(editor, 'PUT', '/api/quality', { subject: 'person', subject_id: a.id, fact: 'birth_date', quality: 'guess' });
  const older = (await json(owner, 'GET', '/api/changes'))[1];
  assert.equal((await call(owner, 'POST', `/api/changes/${older.id}/revert`)).statusCode, 409);
  assert.equal((await call(owner, 'PUT', '/api/quality', { subject: 'person', subject_id: a.id, fact: 'birth_date', quality: 'maybe' })).statusCode, 400);

  // Брак: достоверность и источник у семьи — видны в карточках обоих супругов.
  await json(owner, 'PUT', '/api/quality', { subject: 'family', subject_id: fam.id, fact: 'marriage', quality: 'document' });
  const s = await json(owner, 'POST', '/api/sources', { kind: 'zags', title: 'Свидетельство о браке', cite: { subject: 'family', subject_id: fam.id, fact: 'marriage' } });
  for (const id of [a.id, b.id]) {
    const c = await card(owner, id);
    assert.ok(c.quality.some((x) => x.subject === 'family' && x.fact === 'marriage'));
    assert.deepEqual(c.sources.map((x) => x.id), [s.id]);
  }
  assert.deepEqual((await json(owner, 'GET', `/api/sources/${s.id}`)).persons, [a.id, b.id].sort());
  assert.equal((await call(owner, 'PUT', '/api/quality', { subject: 'family', subject_id: fam.id, fact: 'birth_date', quality: 'oral' })).statusCode, 400);

  // Человек удалён — его сведения не правят.
  await json(owner, 'DELETE', `/api/persons/${a.id}`);
  assert.equal((await call(owner, 'PUT', '/api/quality', { subject: 'person', subject_id: a.id, fact: 'death_date', quality: 'oral' })).statusCode, 404);
  await revert(await lastOp());
});

test('гость: источник с живым скрыт везде, об ушедших — виден; гость не пишет', async () => {
  const dead = await add({ given: 'Прадед', surname: 'Орлов', sex: 'M', living: false, birth_date: '1890' });
  const kid = await add({ given: 'Внучка', surname: 'Орлова', sex: 'F', birth_date: '1990' });
  const doc = await scan(dead.id);
  const open = await json(owner, 'POST', '/api/sources', { kind: 'pamyat', title: 'Донесение о потерях', archive: 'ЦАМО', fond: '58',
    media_id: doc.id, cite: { subject: 'person', subject_id: dead.id, fact: 'death_date' } });
  const secret = await json(owner, 'POST', '/api/sources', { kind: 'metric', title: 'Тайная книга', archive: 'ГАСО', delo: 'секр-12',
    cite: { subject: 'person', subject_id: dead.id, fact: 'birth_date' } });
  await json(owner, 'POST', '/api/citations', { source_id: secret.id, subject: 'person', subject_id: kid.id, fact: 'birth_date' });
  await json(owner, 'PUT', '/api/quality', { subject: 'person', subject_id: kid.id, fact: 'birth_date', quality: 'oral' });
  await json(owner, 'PUT', '/api/quality', { subject: 'person', subject_id: dead.id, fact: 'death_date', quality: 'document' });

  const c = await card(guest, dead.id);
  assert.deepEqual(c.sources.map((s) => s.id), [open.id]);
  assert.deepEqual(c.citations.map((x) => x.source_id), [open.id]);
  assert.equal(c.sources[0].media_id, doc.id, 'скан об ушедшем гостю виден');
  assert.equal(c.quality[0].quality, 'document');
  assert.deepEqual(await card(guest, kid.id), { quality: [], citations: [], sources: [] });
  assert.equal((await call(guest, 'GET', `/api/sources/${secret.id}`)).statusCode, 404);
  assert.equal((await call(guest, 'GET', `/api/sources/${open.id}`)).statusCode, 200);
  assert.deepEqual((await json(guest, 'GET', '/api/sources')).map((s) => s.id).filter((id) => [open.id, secret.id].includes(id)), [open.id]);
  assert.equal((await card(owner, kid.id)).sources[0].id, secret.id, 'участник видит всё');

  // Скан, на котором отмечен живой, гостю не показывается и у источника.
  await json(owner, 'PUT', `/api/media/${doc.id}/persons/${kid.id}`);
  assert.equal((await card(guest, dead.id)).sources[0].media_id, null);

  // В ленте гость не видит названий и шифров дел.
  const feed = JSON.stringify((await json(guest, 'GET', '/api/feed')).items);
  for (const t of ['Тайная', 'Донесение', 'ГАСО', 'ЦАМО', 'секр-12', secret.id, open.id]) assert.ok(!feed.includes(t), t);
  assert.ok((await json(owner, 'GET', '/api/feed')).items.some((i) => JSON.stringify(i).includes('Тайная')));

  // GEDCOM гостя — без источника с живым и без достоверности сведений живых.
  const ged = (await call(guest, 'GET', '/api/export.ged')).body;
  assert.ok(ged.includes('Донесение о потерях'));
  assert.ok(!ged.includes('Тайная'));

  // Гость не пишет.
  for (const [method, url, body] of [
    ['POST', '/api/sources', { kind: 'legend' }], ['PATCH', `/api/sources/${open.id}`, { title: 'x' }], ['DELETE', `/api/sources/${open.id}`],
    ['POST', '/api/citations', { source_id: open.id, subject: 'person', subject_id: dead.id, fact: 'name' }],
    ['PUT', '/api/quality', { subject: 'person', subject_id: dead.id, fact: 'name', quality: 'guess' }],
  ]) assert.equal((await call(guest, method, url, body)).statusCode, 403, `${method} ${url}`);
});

test('GEDCOM: источники SOUR, цитаты с PAGE и QUAY', async () => {
  const p = await add({ given: 'Николай', surname: 'Белов', sex: 'M', living: false, birth_date: '1890', death_date: '1944', occupation: 'кузнец' });
  const s = await json(owner, 'POST', '/api/sources', { kind: 'metric', title: 'Метрическая книга с. Белое', archive: 'ГАТО', fond: '160',
    opis: '1', delo: '12', sheet: '34', verso: true, url: 'https://example.ru/1', note: 'Восприемники — Беловы',
    cite: { subject: 'person', subject_id: p.id, fact: 'birth_date', page: 'запись № 5' } });
  await json(owner, 'PUT', '/api/quality', { subject: 'person', subject_id: p.id, fact: 'birth_date', quality: 'document' });
  await json(owner, 'PUT', '/api/quality', { subject: 'person', subject_id: p.id, fact: 'death_date', quality: 'oral' });
  await json(owner, 'PUT', '/api/quality', { subject: 'person', subject_id: p.id, fact: 'occupation', quality: 'guess' });
  await json(owner, 'POST', '/api/citations', { source_id: s.id, subject: 'person', subject_id: p.id, fact: 'occupation' });
  const ged = (await call(owner, 'GET', '/api/export.ged')).body;
  const indi = ged.slice(ged.indexOf('1 NAME Николай /Белов/'));
  const ref = /0 (@S\d+@) SOUR\n1 TITL Метрическая книга с\. Белое/.exec(ged)?.[1];
  assert.ok(ref, 'запись SOUR');
  assert.match(ged, new RegExp(`0 ${ref} SOUR\\n1 TITL Метрическая книга с\\. Белое\\n1 ABBR ГАТО, ф\\. 160, оп\\. 1, д\\. 12, л\\. 34 об\\.\\n1 _TYPE Метрическая книга\\n1 NOTE https://example\\.ru/1\\n2 CONT Восприемники — Беловы`));
  assert.match(indi, new RegExp(`1 BIRT\\n2 DATE 1890\\n2 SOUR ${ref}\\n3 PAGE запись № 5\\n3 QUAY 3`));
  assert.match(indi, /1 DEAT\n2 DATE 1944\n2 SOUR со слов\n3 QUAY 1/, 'достоверность без источника');
  assert.match(indi, new RegExp(`1 OCCU кузнец\\n2 SOUR ${ref}\\n3 QUAY 0`));
});

test('лента и сводка: «добавила 1 источник», «указала», «отметила достоверность»', async () => {
  const p = await add({ given: 'Тамара', surname: 'Орлова', sex: 'F', living: false, birth_date: '1922' });
  const s = await json(editor, 'POST', '/api/sources', { kind: 'legend', title: 'Рассказ тёти Тамары', cite: { subject: 'person', subject_id: p.id, fact: 'birth_date' } });
  const feed = await json(owner, 'GET', '/api/feed');
  const op = feed.items.find((i) => i.kind === 'op' && i.entries.some((e) => e.entity === 'source'));
  assert.deepEqual(op.entries.map((e) => e.entity), ['source', 'citation']);
  assert.equal(op.entries[1].after.title, 'Рассказ тёти Тамары');
  const g = (await json(guest, 'GET', '/api/feed')).items.find((i) => i.op === op.op);
  assert.deepEqual(g.entries[0].after, { kind: 'legend' });
  assert.deepEqual(g.entries[1].after, { kind: 'legend', subject: 'person', fact: 'birth_date' });
  assert.equal(g.entries[1].entity_id, null);

  const entries = (ops) => ops.flatMap((o) => o.entries.map((e) => ({ ...e, op: o.op })));
  assert.equal(digestText('Елена', 'F', entries([op]), [op.op]), 'Елена добавила 1 источник');
  await json(editor, 'POST', '/api/sources', { kind: 'other', title: 'Ещё один' });
  await json(editor, 'POST', '/api/citations', { source_id: s.id, subject: 'person', subject_id: p.id, fact: 'name' });
  await json(editor, 'PUT', '/api/quality', { subject: 'person', subject_id: p.id, fact: 'birth_date', quality: 'oral' });
  await json(editor, 'PUT', '/api/quality', { subject: 'person', subject_id: p.id, fact: 'name', quality: 'document' });
  await json(editor, 'DELETE', `/api/sources/${s.id}`);
  const marked = (await json(guest, 'GET', '/api/feed')).items.find((i) => i.entries?.[0]?.entity === 'quality');
  assert.deepEqual(marked.entries[0].after, { subject: 'person', fact: 'name', marked: true }, 'гостю — без самой отметки');
  const ops = (await json(owner, 'GET', '/api/changes')).slice(0, 5);
  assert.equal(digestText('Иван', 'M', entries(ops), ops.map((o) => o.op)),
    'Иван добавил 1 источник, указал 1 источник, отметил достоверность 2 сведений, удалил 1 источник');
});
