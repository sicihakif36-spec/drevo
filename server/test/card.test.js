// Карточка человека в PDF и бумажный бланк анкеты: печатает тот, кто видит карточку; гость видит то же, что в карточке
// (живой — только имя, и у родных в «Семье» тоже); удалённое не попадает; галочки включают и выключают разделы;
// длинные истории, много фото и WebP без миниатюры не ломают печать. Бланк — все шаги и поля анкеты, ничего из дерева.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { buildApp } from '../src/app.js';
import { signIn } from './helpers.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { cardData, renderCard, parseCardOptions, MAX_PHOTOS } from '../src/card.js';
import { renderBlank, paperFields, placesFor } from '../src/blank.js';
import { STEPS, ROLES } from '../../shared/survey.js';

let app;
const H = { 'x-drevo': '1' };
let owner;
let guest;
let editor;

async function login(role) {
  return signIn(app, role, { label: role });
}
const call = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });
const json = async (...args) => {
  const r = await call(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const add = (person, relation) => json(owner, 'POST', '/api/persons', { person, relation });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

async function upload(personId, { kind = 'photo', caption = '', type = 'image/png', data = PNG, name = 'p.png' } = {}) {
  const b = 'drevo-card';
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n`),
    Buffer.from(caption ? `--${b}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` : ''),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), data,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  const r = await app.inject({ method: 'POST', url: `/api/persons/${personId}/media`, payload,
    headers: { ...H, cookie: owner, 'content-type': `multipart/form-data; boundary=${b}` } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}

// Карточка как её печатает сервер: весь текст на листах и число страниц.
async function card(role, id, qs = {}) {
  const data = await cardData({ role }, id);
  const out = new PassThrough();
  const chunks = [];
  out.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => out.on('end', r));
  const doc = renderCard(out, data, parseCardOptions(qs));
  await done;
  const pdf = Buffer.concat(chunks);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  return { data, text: doc.printed.join('\n'), pages: doc.pageCount };
}

async function blank(name) {
  const out = new PassThrough();
  out.resume();
  const done = new Promise((r) => out.on('end', r));
  const doc = renderBlank(out, { name });
  await done;
  return { printed: doc.printed, pages: doc.pageCount };
}

let petr; let klava; let olga; let gone; let photo; let groupPhoto; let doc;

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await login('owner');
  guest = await login('viewer');
  editor = await login('editor');

  petr = await add({ sex: 'M', surname: 'Смирнов', given: 'Пётр', patronymic: 'Иванович', living: false, birth_date: '1912', birth_place: 'д. Горки',
    death_date: '1985', burial_place: 'Горкинское кладбище', occupation: 'мастер цеха', notes: 'Любил рыбалку' });
  klava = await add({ sex: 'F', surname: 'Смирнова', birth_surname: 'Белова', given: 'Клавдия', living: false, birth_date: '1918', death_date: '2001' },
    { to: petr.id, type: 'spouse' });
  const fam = (await q('select id from families where partner1 = $1 or partner2 = $1', [petr.id]))[0];
  await json(owner, 'PATCH', `/api/families/${fam.id}`, { start_date: '1945', place: 'с. Горки' });
  // Живая дочь: гостю — только имя, и в карточке отца тоже.
  olga = await add({ sex: 'F', surname: 'Козлова', given: 'Ольга', patronymic: 'Петровна', living: true, birth_date: '12.05.1980',
    birth_place: 'г. Тверь', notes: 'Секретная заметка' }, { to: petr.id, type: 'child', familyId: fam.id });
  gone = await add({ sex: 'M', surname: 'Удалённов', given: 'Сын' }, { to: petr.id, type: 'child', familyId: fam.id });
  await json(owner, 'DELETE', `/api/persons/${gone.id}`);

  photo = await upload(petr.id, { caption: 'Свадьба 1945' });
  groupPhoto = await upload(petr.id, { caption: 'С дочкой Ольгой' });
  await json(owner, 'PUT', `/api/media/${groupPhoto.id}/persons/${olga.id}`);
  const dropped = await upload(petr.id, { caption: 'Удалённое фото' });
  await json(owner, 'DELETE', `/api/media/${dropped.id}`);
  doc = await upload(petr.id, { kind: 'doc', caption: 'Метрика Петра', type: 'application/pdf', data: PDF, name: 'm.pdf' });
  await upload(olga.id, { caption: 'Ольга на выпускном' });

  await json(owner, 'POST', `/api/persons/${petr.id}/life-events`, { kind: 'war', date: '1941–1945', title: 'Калининский фронт', rank: 'сержант' });
  await json(owner, 'POST', `/api/persons/${petr.id}/life-events`, { kind: 'move', date: '1952', place: 'г. Калинин', persons: [olga.id] });
  await json(owner, 'POST', `/api/persons/${petr.id}/life-events`, { kind: 'study', date: '1926', title: 'Школа в Горках' });
  const story = await json(owner, 'POST', `/api/persons/${petr.id}/stories`, { title: 'Как уходил на фронт', body: 'Провожали всей деревней.' });
  await json(owner, 'POST', `/api/persons/${petr.id}/stories`, { title: 'Про Ольгу', body: 'Ольга родилась в Твери.' }).then((s) =>
    json(owner, 'PUT', `/api/stories/${s.id}/persons/${olga.id}`));
  const old = await json(owner, 'POST', `/api/persons/${petr.id}/stories`, { title: 'Удалённая история', body: 'нет' });
  await json(owner, 'DELETE', `/api/stories/${old.id}`);
  // Запись голоса у истории.
  const audio = (await q("insert into media (kind, mime, bytes, name) values ('audio', 'audio/mpeg', 1, 'a.mp3') returning id"))[0];
  await q('update stories set audio_id = $1 where id = $2', [audio.id, story.id]);
  await json(owner, 'POST', '/api/sources', { kind: 'metric', title: 'Метрическая книга Троицкой церкви', archive: 'ГАТО', fond: '160',
    cite: { subject: 'person', subject_id: petr.id, fact: 'birth_date', page: 'запись № 57' } });
  await json(owner, 'POST', '/api/sources', { kind: 'zags', title: 'Свидетельство о рождении Ольги',
    cite: { subject: 'person', subject_id: olga.id, fact: 'birth_date' } });
});
after(async () => { await app.close(); await pool.end(); });

test('карточка у владельца: шапка, факты, жизнь по порядку, семья с годами, истории, фото, документы, источники', async () => {
  const r = await call(owner, 'GET', `/api/persons/${petr.id}/card.pdf`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.headers['content-type'], 'application/pdf');
  assert.match(r.headers['content-disposition'], /^inline; filename="drevo.pdf"; filename\*=UTF-8''/);
  assert.match(decodeURIComponent(r.headers['content-disposition'].split("''")[1]), /Смирнов Пётр Иванович\.pdf/);
  assert.equal((await call(owner, 'GET', `/api/persons/${petr.id}/card.pdf?download=1`)).headers['content-disposition'].split(';')[0], 'attachment');

  const { text, data } = await card('owner', petr.id);
  for (const s of ['Смирнов Пётр Иванович', '1912 – 1985', '1912, д. Горки', 'Горкинское кладбище', 'мастер цеха', 'Любил рыбалку',
    'Калининский фронт', 'Смирнова Клавдия (1918 – 2001) — брак 1945, с. Горки', 'Козлова Ольга Петровна (р. 1980), дочь',
    'Как уходил на фронт', 'Провожали всей деревней.', 'Есть запись голоса', 'Свадьба 1945', 'С дочкой Ольгой', 'Метрика Петра',
    'По документу: Метрическая книга Троицкой церкви', 'ГАТО, ф. 160', 'запись № 57', 'Наше семейное древо', 'напечатано']) {
    assert.ok(text.includes(s), `нет «${s}»`);
  }
  // События ленты — по годам, а не по порядку добавления.
  assert.ok(text.indexOf('Школа в Горках') < text.indexOf('Калининский фронт') && text.indexOf('Калининский фронт') < text.indexOf('г. Калинин'));
  assert.ok(data.photo, 'главное фото на месте');
  for (const s of ['Удалённов', 'Удалённое фото', 'Удалённая история', 'Ольга на выпускном', 'Свидетельство о рождении Ольги']) {
    assert.ok(!text.includes(s), `лишнее «${s}»`);
  }
});

test('галочки: истории, фото, документы и источники выключаются по отдельности', async () => {
  const off = (await card('owner', petr.id, { stories: '0', photos: '0', docs: '0', sources: '0', theme: 'bw' })).text;
  for (const s of ['Как уходил на фронт', 'Свадьба 1945', 'Метрика Петра', 'Метрическая книга']) assert.ok(!off.includes(s), `лишнее «${s}»`);
  assert.ok(off.includes('Калининский фронт') && off.includes('Смирнова Клавдия'));
  const onlyDocs = (await card('owner', petr.id, { stories: '0', photos: '0', sources: '0' })).text;
  assert.ok(onlyDocs.includes('Метрика Петра') && !onlyDocs.includes('Свадьба 1945'));
  assert.deepEqual(parseCardOptions({ theme: 'x' }), { theme: 'classic', stories: true, photos: true, docs: true, sources: true });
});

test('гость: у живого — только имя и родные без дат; в карточке ушедшего живая дочь — без дат, групповое фото и общее — скрыты', async () => {
  const r = await call(guest, 'GET', `/api/persons/${olga.id}/card.pdf`);
  assert.equal(r.statusCode, 200, r.body);
  const live = await card('viewer', olga.id);
  assert.ok(live.text.includes('Козлова Ольга Петровна'));
  assert.ok(live.text.includes('Смирнов Пётр Иванович (1912 – 1985)'), 'ушедший отец — с годами');
  for (const s of ['1980', 'Тверь', 'Секретная заметка', 'Ольга на выпускном', 'Свидетельство', 'Про Ольгу', 'Калинин']) {
    assert.ok(!live.text.includes(s), `гостю видно «${s}»`);
  }
  assert.equal(live.data.photo, null);
  assert.deepEqual([live.data.stories, live.data.photos, live.data.events, live.data.sources], [[], [], [], []]);

  const { text } = await card('viewer', petr.id);
  assert.ok(text.includes('Козлова Ольга Петровна, дочь'), 'дочь без годов');
  for (const s of ['1980', 'С дочкой Ольгой', 'Про Ольгу', 'Ольга родилась', 'г. Калинин', 'Свидетельство о рождении Ольги', 'Удалённ']) {
    assert.ok(!text.includes(s), `гостю видно «${s}»`);
  }
  for (const s of ['Как уходил на фронт', 'Свадьба 1945', 'Метрика Петра', 'Метрическая книга', 'Калининский фронт']) assert.ok(text.includes(s), `нет «${s}»`);
  // Владелец видит всё это.
  const all = (await card('owner', petr.id)).text;
  for (const s of ['Ольга Петровна (р. 1980)', 'Про Ольгу', 'г. Калинин']) assert.ok(all.includes(s));
});

test('права: без входа — нет, удалённый человек — 404, бланк — только тем, кто создаёт анкеты', async () => {
  assert.equal((await app.inject({ method: 'GET', url: `/api/persons/${petr.id}/card.pdf`, headers: H })).statusCode, 401);
  const r = await call(guest, 'GET', `/api/persons/${gone.id}/card.pdf`);
  assert.equal(r.statusCode, 404);
  assert.equal(r.json().error, 'Человек не найден');
  assert.equal((await call(guest, 'GET', '/api/survey-blank.pdf')).statusCode, 403);
  const b = await call(editor, 'GET', '/api/survey-blank.pdf?name=Бабушка%20Клава&download=1');
  assert.equal(b.statusCode, 200);
  assert.equal(b.headers['content-type'], 'application/pdf');
  assert.match(decodeURIComponent(b.headers['content-disposition']), /^attachment; .*Анкета — Бабушка Клава\.pdf$/);
});

test('длинные истории, много фото и WebP без миниатюры: печать не падает, лишние фото — строкой «и ещё»', async () => {
  const big = await add({ sex: 'F', given: 'Анна', surname: 'Длинная', living: false, death_date: '1990' });
  const webp = await upload(big.id, { type: 'image/webp', data: Buffer.from('RIFF0000WEBPVP8 '), name: 'a.webp', caption: 'Вебп' });
  assert.equal((await q('select photo_id from persons where id = $1', [big.id]))[0].photo_id, webp.id);
  for (let i = 1; i <= 20; i++) await upload(big.id, { caption: `Фото номер ${i} ${'с длинной подписью '.repeat(i % 3 ? 1 : 12)}` });
  const words = Array.from({ length: 1500 }, (_, i) => `слово${i}`).join(' ');
  await json(owner, 'POST', `/api/persons/${big.id}/stories`, { title: 'Очень длинная', body: `${words}\n\n${'Абзац. '.repeat(500)}` });
  await json(owner, 'POST', `/api/persons/${big.id}/stories`, { title: 'Без пробелов', body: 'ж'.repeat(5000) });
  const { text, pages, data } = await card('owner', big.id);
  assert.equal(data.photo, null, 'WebP без миниатюры — без главного фото');
  assert.ok(pages >= 5, `страниц: ${pages}`);
  assert.ok(text.includes('слово1499'), 'история напечатана до конца');
  assert.ok(text.includes(`Фото номер ${MAX_PHOTOS - 1} `) && !text.includes(`Фото номер ${MAX_PHOTOS + 1} `));
  assert.ok(text.includes(`И ещё ${21 - MAX_PHOTOS} фото`));
  assert.ok(text.includes(`стр. ${pages} из ${pages}`));
});

test('бланк анкеты: все шаги и поля, у «много» — нужное число мест, имя в шапке, ничего из дерева', async () => {
  const { printed, pages } = await blank('Бабушка Клава');
  const text = printed.join('\n');
  assert.ok(pages >= 5);
  assert.ok(printed.includes('Бабушка Клава'));
  for (const s of ['Кого опрашиваем:', 'Кто записал, когда:', 'Как перенести ответы в дерево', 'Загрузить в дерево']) assert.ok(text.includes(s), `нет «${s}»`);
  STEPS.forEach((s, i) => assert.ok(printed.some((t) => t.endsWith(`. ${s.title}`)), `нет шага «${s.title}» (${i})`));
  // Каждая роль — столько раз, сколько мест; у каждого человека — все его поля.
  const count = (s) => printed.filter((t) => t === s).length;
  let blocks = 0;
  for (const [role, r] of Object.entries(ROLES)) {
    const n = placesFor(role);
    blocks += n;
    if (r.many) for (let k = 1; k <= n; k++) assert.equal(count(`${r.label} — ${k}`), 1, `${r.label} — ${k}`);
    else assert.equal(count(r.paperLabel || r.label), 1, r.label);
    assert.ok(paperFields(role).length >= 8);
  }
  assert.equal(placesFor('child'), ROLES.child.paper);
  assert.equal(count('Имя'), blocks);
  const total = Object.keys(ROLES).reduce((a, role) => a + placesFor(role) * paperFields(role).length, 0);
  const labels = new Set(Object.keys(ROLES).flatMap((role) => paperFields(role).map((f) => f.label)));
  assert.equal(printed.filter((t) => labels.has(t)).length, total);
  assert.equal(count('Пол'), Object.entries(ROLES).filter(([, r]) => !r.sex).reduce((a, [role]) => a + placesFor(role), 0));
  assert.equal(count('Жив или умер'), blocks - 1, 'у самого опрашиваемого не спрашиваем');
  // Ничего из дерева: ни людей, ни названия.
  for (const s of ['Смирнов', 'Пётр', 'Ольга', 'Наше семейное древо']) assert.ok(!text.includes(s), `на бланке «${s}»`);
  const empty = await blank('');
  assert.ok(!empty.printed.includes('Бабушка Клава'));
});
