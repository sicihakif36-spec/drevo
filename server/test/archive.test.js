// Полный архив «Скачать всё»: только владельцу; дерево.ged, index.html, прочтите.txt и файлы по папкам;
// GEDCOM ссылается ровно на файлы архива; безопасные и неповторяющиеся имена; удалённого нет;
// журнал поиска по людям без удалённого; большое дерево идёт потоком без роста памяти, а прерванное скачивание не ломает сервер.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import yauzl from 'yauzl';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { createInvite } from '../src/auth.js';
import { mediaPath } from '../src/routes/media.js';
import { safeName, Names } from '../src/archive.js';

let app;
const H = { 'x-drevo': '1' };
let owner;

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
const add = (person) => json(owner, 'POST', '/api/persons', { person });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

async function upload(personId, { kind = 'photo', caption = '', type = 'image/png', data = PNG, name = 'p.png' } = {}) {
  const b = 'drevo-archive';
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

// Все файлы архива с содержимым; yauzl заодно сверяет контрольные суммы.
function unzip(buf) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(err);
      const out = new Map();
      zip.on('entry', (e) => zip.openReadStream(e, (e2, s) => {
        if (e2) return reject(e2);
        const parts = [];
        s.on('data', (c) => parts.push(c)).on('end', () => { out.set(e.fileName, Buffer.concat(parts)); zip.readEntry(); }).on('error', reject);
      }));
      zip.on('end', () => resolve(out)).on('error', reject);
      zip.readEntry();
    });
  });
}

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await login('owner');
});
after(async () => { await app.close(); await pool.end(); });

test('безопасные имена: без запрещённых знаков, точек по краям и имён устройств Windows; повторы различаются', () => {
  assert.equal(safeName('Пётр: "Петя" <младший>/..\\ * ? |'), 'Пётр Петя младший');
  assert.equal(safeName('..'), 'без названия');
  assert.equal(safeName('  .скрытый. '), 'скрытый');
  assert.equal(safeName('CON'), '_CON');
  assert.equal(safeName('nul.txt'), '_nul.txt');
  assert.equal(safeName('строка\nвторая\tтретья'), 'строка вторая третья');
  assert.equal([...safeName('я'.repeat(300))].length, 60);
  const n = new Names();
  assert.equal(n.take('Фото/Иван', 'фото', 'jpg'), 'Фото/Иван/фото.jpg');
  assert.equal(n.take('Фото/Иван', 'Фото', 'jpg'), 'Фото/Иван/Фото (2).jpg', 'регистр не различается: на Windows это один файл');
  assert.equal(n.take('Фото/Иван', 'фото', 'png'), 'Фото/Иван/фото.png');
});

test('архив — только владельцу', async () => {
  for (const role of ['editor', 'relative', 'viewer']) {
    const cookie = await login(role);
    for (const url of ['/api/archive', '/api/archive.zip']) assert.equal((await call(cookie, 'GET', url)).statusCode, 403, `${role} ${url}`);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/archive.zip' })).statusCode, 401);
});

test('в архиве: дерево.ged с файлами, index.html, прочтите.txt, фото, документы, записи и истории; удалённого нет', async () => {
  const ivan = await add({ given: 'Иван', surname: 'Смирнов', patronymic: 'Фёдорович', sex: 'M', living: false, birth_date: '1880', death_date: '1942' });
  const maria = await add({ given: 'Мария', surname: 'Смирнова', sex: 'F', living: false, birth_date: 'около 1885' });
  const odd = await add({ given: 'Пётр: "Петя"', surname: 'CON', sex: 'M', living: false });
  const twin1 = await add({ given: 'Анна', surname: 'Козлова', sex: 'F', living: false });
  const twin2 = await add({ given: 'Анна', surname: 'Козлова', sex: 'F', living: false });
  const gone = await add({ given: 'Удалённый', surname: 'Человек', sex: 'M', living: false });
  await json(owner, 'POST', '/api/relations', { personId: maria.id, to: ivan.id, type: 'spouse' });

  const portrait = await upload(ivan.id, { caption: 'Портрет' });
  await upload(ivan.id, { caption: 'Портрет' }); // то же название — второй файл рядом, а не вместо
  // Групповое фото: загружено Марии, отмечен и Иван.
  const group = await upload(maria.id, { caption: 'Вся семья' });
  await json(owner, 'PUT', `/api/media/${group.id}/persons/${ivan.id}`);
  const doc = await upload(ivan.id, { kind: 'doc', type: 'application/pdf', data: PDF, name: 'Метрика.pdf' });
  await upload(odd.id, { caption: 'a/b\\c:d*e?f"g<h>i|j' });
  await upload(odd.id, { caption: 'NUL' });
  await upload(twin1.id, { caption: 'фото' });
  await upload(twin2.id, { caption: 'фото' });
  // Удалённый файл и файлы удалённого человека в архив не попадают.
  const removed = await upload(ivan.id, { caption: 'Удалённое фото' });
  await json(owner, 'DELETE', `/api/media/${removed.id}`);
  await upload(gone.id, { caption: 'Фото удалённого' });
  await json(owner, 'DELETE', `/api/persons/${gone.id}`);
  // Файла нет на диске — его нет и в архиве, но об этом сказано.
  const lost = await upload(maria.id, { caption: 'Потерянное' });
  fs.rmSync(mediaPath(lost.id));

  // История с записью голоса — прямо в базе: перевод в MP3 проверяется в stories.test.js.
  const voice = (await q("insert into media (kind, mime, bytes, name) values ('audio', 'audio/mpeg', 4, 'golos.mp3') returning id"))[0];
  fs.writeFileSync(mediaPath(voice.id), 'ID3!');
  const story = (await q("insert into stories (title, date, body, audio_id) values ('Как дед уходил на фронт', 'лето 1941', 'Рассказывала бабушка.', $1) returning id", [voice.id]))[0];
  await q('insert into story_persons (story_id, person_id) values ($1, $2), ($1, $3)', [story.id, ivan.id, maria.id]);
  const deletedStory = (await q("insert into stories (title, deleted_at) values ('Удалённая история', now()) returning id"))[0];
  await q('insert into story_persons (story_id, person_id) values ($1, $2)', [deletedStory.id, ivan.id]);

  const info = await json(owner, 'GET', '/api/archive');
  assert.deepEqual([info.persons, info.photos, info.docs, info.audio, info.stories, info.missing, info.files], [5, 7, 1, 1, 1, 1, 9]);

  const r = await call(owner, 'GET', '/api/archive.zip');
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['content-type'], 'application/zip');
  assert.equal(r.headers['x-accel-buffering'], 'no');
  assert.equal(Number(r.headers['content-length']), r.rawPayload.length, 'размер известен заранее');
  assert.ok(Math.abs(info.bytes - r.rawPayload.length) < r.rawPayload.length * 0.05 + 2000, 'примерный вес близок к настоящему');
  const files = await unzip(r.rawPayload);
  const paths = [...files.keys()];
  for (const p of ['дерево.ged', 'index.html', 'прочтите.txt']) assert.ok(files.has(p), p);

  // Имена безопасны и не повторяются даже без учёта регистра.
  for (const p of paths) {
    for (const part of p.split('/')) {
      assert.ok(part && part !== '.' && part !== '..', p);
      assert.doesNotMatch(part, /[<>:"\\|?*\u0000-\u001f]|^[\s.]|[\s.]$/, p);
      assert.doesNotMatch(part, /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i, p);
    }
  }
  assert.equal(new Set(paths.map((p) => p.toLowerCase())).size, paths.length);

  const ivanDir = 'Смирнов Иван Фёдорович (1880–1942)';
  const mariaDir = 'Смирнова Мария (~1885–…)';
  assert.ok(files.has(`Фото/${ivanDir}/Портрет.png`));
  assert.ok(files.has(`Фото/${ivanDir}/Портрет (2).png`));
  assert.deepEqual(files.get(`Фото/${ivanDir}/Портрет.png`), PNG, 'оригинал, а не миниатюра');
  assert.ok(files.has(`Фото/${mariaDir}/Вся семья.png`), 'групповое фото — у первого отмеченного');
  assert.equal(paths.filter((p) => p.includes('Вся семья')).length, 1, 'групповое фото — один раз');
  assert.ok(files.has(`Документы/${ivanDir}/Метрика.pdf`));
  assert.ok(files.has('Фото/Козлова Анна/фото.png') && files.has('Фото/Козлова Анна (2)/фото.png'), 'тёзки — в разных папках');
  assert.ok(files.has('Фото/CON Пётр Петя/a b c d e f g h i j.png'), paths.join('\n'));
  assert.ok(files.has('Фото/CON Пётр Петя/_NUL.png'));
  assert.ok(files.has(`Записи голоса/${ivanDir}/Как дед уходил на фронт.mp3`));
  const tale = files.get(`Истории/${ivanDir}/Как дед уходил на фронт.txt`).toString();
  assert.match(tale, /^\ufeffКак дед уходил на фронт\r\nКогда: лето 1941\r\nО ком: Смирнов Иван Фёдорович, Смирнова Мария\r\n/);
  assert.match(tale, /Запись голоса: Записи голоса\/.+\.mp3/);
  assert.match(tale, /Рассказывала бабушка\./);
  assert.ok(!paths.some((p) => /Удалённ|Потерянное/.test(p)), paths.join('\n'));
  assert.ok(!paths.some((p) => p.includes('Человек')));

  // GEDCOM ссылается ровно на файлы, которые лежат в архиве.
  const ged = files.get('дерево.ged').toString();
  const refs = [...ged.matchAll(/^1 FILE (.+)$/gm)].map((m) => m[1]);
  const media = paths.filter((p) => /^(Фото|Документы|Записи голоса)\//.test(p));
  assert.deepEqual([...refs].sort(), [...media].sort());
  assert.ok(!/Удалённый/.test(ged));
  // Групповое фото — у обоих, главное фото Ивана — с пометкой _PRIM; история — заметкой у обоих.
  const obj = (file) => ged.match(new RegExp(`^0 (@O\\d+@) OBJE\\n1 FILE ${file.replace(/[()]/g, '\\$&')}$`, 'm'))[1];
  const indi = (name) => ged.split(/^0 /m).find((r) => r.includes(`1 NAME ${name}`));
  const groupId = obj(`Фото/${mariaDir}/Вся семья.png`);
  assert.ok(indi('Иван Фёдорович /Смирнов/').includes(`1 OBJE ${groupId}`));
  assert.ok(indi('Мария /Смирнова/').includes(`1 OBJE ${groupId}`));
  assert.match(indi('Иван Фёдорович /Смирнов/'), new RegExp(`1 OBJE ${obj(`Фото/${ivanDir}/Портрет.png`)}\\n2 _PRIM Y`));
  assert.match(ged, /^2 FORM pdf\n3 TYPE manuscript$/m);
  const note = ged.match(/^0 (@N\d+@) NOTE Как дед уходил на фронт, лето 1941\n1 CONT Рассказывала бабушка\.$/m)[1];
  assert.ok(indi('Мария /Смирнова/').includes(`1 NOTE ${note}`));
  assert.equal(portrait.kind, 'photo');
  assert.equal(doc.kind, 'doc');

  // Страница открывается без интернета: всё рядом, ссылки — на файлы архива.
  const html = files.get('index.html').toString();
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//);
  const links = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].map((m) => decodeURIComponent(m[1]));
  assert.ok(links.length > 5);
  for (const l of links) assert.ok(files.has(l), l);
  assert.ok(html.includes('Смирнов Иван Фёдорович') && html.includes('Супруги'));

  const readme = files.get('прочтите.txt').toString();
  assert.match(readme, /5 человек, 7 фото, 1 документ, 1 запись голоса, 1 история/);
  assert.match(readme, /1 файл не нашёлся/);
  assert.match(readme, /index\.html/);
});

test('журнал поиска в архиве: вопросы и записи по людям, кто и когда, ссылки и шифры; удалённого нет', async () => {
  const editor = await login('editor');
  const as = (cookie, method, url, payload) => json(cookie, method, url, payload);
  const ahmet = await add({ given: 'Ахмет', surname: 'Галиев', sex: 'M', living: false, birth_date: '1901' });
  const quiet = await add({ given: 'Тихон', surname: 'Безвопросов', sex: 'M', living: false });
  const gone = await add({ given: 'Ушедший', surname: 'Изархива', sex: 'M', living: false });

  const x = await as(editor, 'POST', `/api/persons/${ahmet.id}/research`, { title: 'Где погиб в 1943' });
  await as(editor, 'POST', `/api/research/${x.id}/notes`, { result: 'notfound', place: 'Память народа', url: 'https://pamyat-naroda.ru/', body: 'По фамилии не нашли.\nПопробовать Галеев.' });
  await as(owner, 'POST', `/api/research/${x.id}/notes`, { result: 'found', place: 'ЦАМО', ref: 'ф. 58, оп. 18001, д. 1', body: 'Донесение о потерях.' });
  const wrong = await as(owner, 'POST', `/api/research/${x.id}/notes`, { body: 'Ошибочная запись' });
  await as(owner, 'DELETE', `/api/research/notes/${wrong.id}`);
  await as(owner, 'PATCH', `/api/research/${x.id}`, { status: 'found' });
  await as(owner, 'POST', `/api/persons/${ahmet.id}/research`, { title: 'Родители Ахмета' });
  const removed = await as(owner, 'POST', `/api/persons/${ahmet.id}/research`, { title: 'Удалённый вопрос' });
  await as(owner, 'POST', `/api/research/${removed.id}/notes`, { body: 'Запись удалённого вопроса' });
  await as(owner, 'DELETE', `/api/research/${removed.id}`);
  await as(owner, 'POST', `/api/persons/${gone.id}/research`, { title: 'Вопрос об удалённом человеке' });
  await as(owner, 'DELETE', `/api/persons/${gone.id}`);

  const info = await json(owner, 'GET', '/api/archive');
  assert.equal(info.research, 2);
  assert.match(info.summary, /2 вопроса поиска/);
  const files = await unzip((await call(owner, 'GET', '/api/archive.zip')).rawPayload);
  const paths = [...files.keys()];
  const log = paths.filter((p) => p.startsWith('Журнал поиска/'));
  assert.deepEqual(log, ['Журнал поиска/Галиев Ахмет (1901–…).txt'], 'файл только у человека с вопросами');
  const t = files.get(log[0]).toString();
  assert.match(t, /^\ufeffЖурнал поиска: Галиев Ахмет \(1901–…\)\r\n/);
  assert.match(t, /Вопрос: Где погиб в 1943\r\nСостояние: Нашли\r\nЗаписал\(а\): editor, \d\d\.\d\d\.\d{4}/);
  assert.match(t, /editor — Не нашли\r\n  Где искали: Память народа\r\n  Ссылка: https:\/\/pamyat-naroda\.ru\/\r\n  По фамилии не нашли\.\r\n  Попробовать Галеев\./);
  assert.match(t, /owner — Нашли\r\n  Где искали: ЦАМО\r\n  Шифр: ф\. 58, оп\. 18001, д\. 1\r\n  Донесение о потерях\./);
  assert.match(t, /Вопрос: Родители Ахмета\r\nСостояние: Ищем[^]*Записей пока нет\./);
  assert.ok(t.indexOf('Где погиб') < t.indexOf('Родители'), 'по порядку');
  for (const no of ['Ошибочная', 'Удалённый вопрос', 'Запись удалённого', 'удалённом человеке']) assert.ok(!t.includes(no), no);

  const html = files.get('index.html').toString();
  const card = (name) => html.split('<section').find((c) => c.includes(`<h2>${name}</h2>`));
  const a = card('Галиев Ахмет');
  assert.match(a, /<h3>Журнал поиска<\/h3>/);
  assert.ok(a.includes('Где погиб в 1943') && a.includes('ф. 58, оп. 18001, д. 1') && a.includes('Донесение о потерях.'));
  assert.ok(a.includes(`href="${encodeURIComponent('Журнал поиска')}/`));
  assert.ok(!a.includes('Ошибочная') && !a.includes('Удалённый вопрос'));
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//, 'ссылки поиска — текстом, страница без интернета');
  assert.doesNotMatch(card('Безвопросов Тихон'), /Журнал поиска/);
  assert.ok(!html.includes('удалённом человеке'));
  assert.match(files.get('прочтите.txt').toString(), /2 вопроса поиска[^]*Журнал поиска {3}— /);
});

// Тысячи файлов по 128 КБ — жёсткие ссылки на один файл, чтобы не занимать диск. Архив — около 380 МБ;
// память растёт от длины списка файлов (на 1000 файлов — около 50 МБ, на 6000 — около 75), а не от их веса.
test('большое дерево собирается потоком: память не растёт вместе с архивом; прерванное скачивание не ломает сервер', async () => {
  const N = 3000;
  const seed = mediaPath('seed-archive-test');
  fs.writeFileSync(seed, Buffer.alloc(128 * 1024, 7));
  const persons = await q(`insert into persons (given, surname, sex, living)
    select 'Человек ' || i, 'Большой', 'M', false from generate_series(1, 300) i returning id`);
  const media = await q(`insert into media (kind, mime, bytes, name, caption)
    select 'photo', 'image/jpeg', ${128 * 1024}, 'p.jpg', 'Снимок ' || i from generate_series(1, ${N}) i returning id`);
  await q(`insert into media_persons (media_id, person_id) select m, p from unnest($1::uuid[]) with ordinality a(m, i)
    join unnest($2::uuid[]) with ordinality b(p, j) on j = (i % 300) + 1`, [media.map((m) => m.id), persons.map((p) => p.id)]);
  for (const m of media) fs.linkSync(seed, mediaPath(m.id));
  try {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address();
    const get = (onChunk) => new Promise((resolve, reject) => {
      const req = http.get({ port, path: '/api/archive.zip', headers: { cookie: owner } }, (res) => {
        let n = 0;
        res.on('data', (c) => { n += c.length; onChunk?.(n, req); });
        res.on('end', () => resolve({ n, length: Number(res.headers['content-length']) }));
        res.on('error', (err) => (req.destroyed ? resolve({ aborted: true }) : reject(err)));
      });
      req.on('error', (err) => (err.message === 'прервано' ? resolve({ aborted: true }) : reject(err)));
    });

    global.gc?.();
    const base = process.memoryUsage().rss;
    let peak = base;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
    const { n, length } = await get();
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage().rss);
    assert.equal(n, length);
    assert.ok(n > N * 128 * 1024, `архив ${n} байт`);
    const grew = (peak - base) / 1024 / 1024;
    console.log(`архив ${(n / 1024 / 1024).toFixed(0)} МБ, ${N} файлов; память выросла на ${grew.toFixed(0)} МБ`);
    assert.ok(grew < 120, `память выросла на ${grew.toFixed(0)} МБ при архиве ${(n / 1024 / 1024).toFixed(0)} МБ`);

    // Ушли на середине: сервер бросает чтение и дальше работает.
    const cut = await get((got, req) => { if (got > 20 * 1024 * 1024) req.destroy(new Error('прервано')); });
    assert.ok(cut.aborted);
    const info = await json(owner, 'GET', '/api/archive');
    assert.equal(info.photos, 7 + N);
  } finally {
    for (const m of media) fs.rmSync(mediaPath(m.id), { force: true });
    fs.rmSync(seed, { force: true });
  }
});
