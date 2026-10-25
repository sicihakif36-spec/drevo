// Напоминание о семейном архиве и полнота «Скачать всё»: отметка о скачивании, уведомление владельцам раз в неделю днём,
// «Напомнить позже», переключатель, плашка в ленте; в архиве — вопросы родным и черновики интервью без отозванного,
// удалённого и уже сохранённого. Отправитель уведомлений и часы подменены.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yauzl from 'yauzl';
import { buildApp } from '../src/app.js';
import { signIn, H } from './helpers.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { askPath } from '../src/asks.js';
import { ivPath } from '../src/interviews.js';
import { lastText } from '../../shared/archive.js';

const DAY = 86400000;
let app;
let now = null;
let sent = [];
const push = { send: async (sub, payload) => { sent.push({ to: sub.endpoint.split('/').at(-1), msg: JSON.parse(payload) }); }, clock: () => now || new Date(), timer: false };
const to = (name) => sent.filter((s) => s.to === name).map((s) => s.msg);
const raw = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });
async function call(cookie, method, url, payload) {
  const r = await raw(cookie, method, url, payload);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const subscribe = (cookie, name) => call(cookie, 'PUT', '/api/push/subscription',
  { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: 'BKey', auth: 'auth' } });
// Проход расписания в такой-то момент: «2026-10-24T14:00:00+03:00».
async function tick(at) {
  now = new Date(at);
  sent = [];
  await app.push.tick();
  await app.push.settled();
}

function unzip(buf) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, strictFileNames: true }, (err, zip) => {
      if (err) return reject(err);
      const out = new Map();
      zip.on('entry', (e) => zip.openReadStream(e, (e2, s) => {
        if (e2) return reject(e2);
        const parts = [];
        s.on('data', (c) => parts.push(c)).on('end', () => { out.set(e.fileName, Buffer.concat(parts)); zip.readEntry(); });
      }));
      zip.on('end', () => resolve(out)).on('error', reject);
      zip.readEntry();
    });
  });
}

let owner;
let owner2;
let editor;
let relative;
before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push });
  owner = await signIn(app, 'owner', { name: 'Анна' });
  owner2 = await signIn(app, 'owner', { name: 'Рустем' });
  editor = await signIn(app, 'editor', { name: 'Елена' });
  relative = await signIn(app, 'relative', { name: 'Ольга' });
  for (const [c, n] of [[owner, 'owner'], [owner2, 'owner2'], [editor, 'editor'], [relative, 'relative']]) await subscribe(c, n);
  // Остальные уведомления здесь не нужны.
  await q('update users set notify_comments = false, notify_edits = false, notify_dates = false');
});
after(async () => { await app.close(); await pool.end(); });

test('пустое дерево — не напоминаем; «последний раз» — по-человечески', async () => {
  await tick('2026-10-24T14:00:00+03:00');
  assert.equal(sent.length, 0);
  assert.equal((await call(owner, 'GET', '/api/feed')).archive, null);
  const n = new Date('2026-10-24T14:00:00+03:00');
  assert.equal(lastText('2026-09-24T12:00:00+03:00', n), '24 сентября (30 дней назад)');
  assert.equal(lastText('2026-10-23T23:30:00+03:00', n), 'вчера');
  assert.equal(lastText('2026-10-24T00:10:00+03:00', n), 'сегодня');
  assert.equal(lastText('2025-10-03T12:00:00+03:00', n), '3 октября 2025 (386 дней назад)');
  assert.equal(lastText('2026-10-03T12:00:00+03:00', n), '3 октября (21 день назад)');
});

test('ни разу не скачивали — напоминаем владельцам днём, не чаще раза в неделю; остальным — нет', async () => {
  await call(owner, 'POST', '/api/persons', { person: { given: 'Иван', surname: 'Смирнов', sex: 'M', living: false } });
  await tick('2026-10-24T08:00:00+03:00');
  assert.equal(sent.length, 0, 'утром рано — не напоминаем');
  await tick('2026-10-24T22:00:00+03:00');
  assert.equal(sent.length, 0, 'ночью — тоже');
  await tick('2026-10-24T11:00:00+03:00');
  assert.deepEqual(sent.map((s) => s.to).sort(), ['owner', 'owner2']);
  assert.equal(to('owner')[0].title, 'Пора сохранить семейный архив');
  assert.match(to('owner')[0].body, /ещё не скачивали/);
  assert.equal(to('owner')[0].url, '/#/more?archive=1');
  await tick('2026-10-24T12:00:00+03:00');
  assert.equal(sent.length, 0, 'второй раз в тот же день — нет');
  await tick('2026-10-30T12:00:00+03:00');
  assert.equal(sent.length, 0, 'через шесть дней — нет');
  await tick('2026-10-31T12:00:00+03:00');
  assert.equal(sent.length, 2, 'через неделю — снова');

  // Плашка в ленте — только владельцу.
  assert.deepEqual((await call(owner, 'GET', '/api/feed')).archive, { last: null });
  for (const c of [editor, relative]) assert.equal((await call(c, 'GET', '/api/feed')).archive, null);
});

test('скачали — месяц тишины; через 30 дней — снова, с датой; скачал другой владелец — тоже считается', async () => {
  const r = await raw(owner2, 'GET', '/api/archive.zip');
  assert.equal(r.statusCode, 200);
  // Отметка пишется, когда ответ ушёл целиком, — чуть позже ответа.
  let d;
  for (let i = 0; i < 50 && !d; i++) {
    [d] = await q('select user_id, bytes from archive_downloads');
    if (!d) await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(Number(d.bytes), r.rawPayload.length, 'отмечен вес архива');
  const { last } = await call(owner, 'GET', '/api/archive/last');
  assert.equal(last.name, 'Рустем');
  assert.equal((await call(owner, 'GET', '/api/archive')).last.name, 'Рустем');
  assert.equal((await call(owner, 'GET', '/api/feed')).archive, null, 'плашка пропала');
  for (const c of [editor, relative]) assert.equal((await raw(c, 'GET', '/api/archive/last')).statusCode, 403);

  await q("update archive_downloads set at = '2026-09-24T12:00:00+03:00'");
  await q('update users set archive_reminded_at = null');
  await tick('2026-10-20T14:00:00+03:00');
  assert.equal(sent.length, 0, '26 дней — рано');
  await tick('2026-10-25T14:00:00+03:00');
  assert.equal(sent.length, 2);
  assert.equal(to('owner')[0].body, 'Последний раз — 24 сентября (31 день назад). Откройте «Ещё → Скачать всё».');
});

test('«Напомнить позже» — неделя без плашки и уведомлений; выключатель — только у владельца', async () => {
  await q("update archive_downloads set at = now() - interval '40 days'");
  await q('update users set archive_reminded_at = null');
  assert.ok((await call(owner, 'GET', '/api/feed')).archive);
  await call(owner, 'POST', '/api/archive/later');
  assert.equal((await call(owner, 'GET', '/api/feed')).archive, null);
  assert.ok((await call(owner2, 'GET', '/api/feed')).archive, 'у второго владельца — своё');
  for (const c of [editor, relative]) assert.equal((await raw(c, 'POST', '/api/archive/later')).statusCode, 403);
  const t = Date.now();
  await tick(new Date(t + DAY).toISOString().slice(0, 10) + 'T14:00:00+03:00');
  assert.deepEqual(sent.map((s) => s.to), ['owner2']);
  await q('update users set archive_reminded_at = null');
  await tick(new Date(t + 8 * DAY).toISOString().slice(0, 10) + 'T14:00:00+03:00');
  assert.deepEqual(sent.map((s) => s.to).sort(), ['owner', 'owner2'], 'через неделю напомнили');

  // Переключатель.
  assert.equal((await call(owner, 'GET', '/api/push/settings')).archive, true);
  assert.equal((await call(editor, 'GET', '/api/push/settings')).archive, undefined);
  assert.equal((await call(editor, 'PATCH', '/api/push/settings', { archive: false })).archive, undefined);
  assert.equal((await call(owner, 'PATCH', '/api/push/settings', { archive: false })).archive, false);
  await q('update users set archive_reminded_at = null');
  await tick(new Date(t + 9 * DAY).toISOString().slice(0, 10) + 'T14:00:00+03:00');
  assert.deepEqual(sent.map((s) => s.to), ['owner2']);
  await call(owner, 'PATCH', '/api/push/settings', { archive: true });
});

test('в архиве — вопросы родным и черновики интервью; отозванного, удалённого и сохранённого нет', async () => {
  const add = (person) => call(owner, 'POST', '/api/persons', { person });
  const ded = await add({ given: 'Хасан', surname: 'Галиев', sex: 'M', living: false, birth_date: '1900' });
  const quiet = await add({ given: 'Тихон', surname: 'Безвопросов', sex: 'M', living: false });
  const [u] = await q("select id from users where name = 'Анна'");
  const [o] = await q("select id from users where name = 'Ольга'");
  const ask = async (question, extra = {}) => (await q(
    `insert into asks (person_id, about, question, created_by, to_user, answer, answered_at, revoked_at, deleted_at)
     values ($1, 'о Хасане', $2, $3, $4, $5, $6, $7, $8) returning id`,
    [ded.id, question, u.id, o.id, extra.answer || null, extra.answer ? new Date() : null, extra.revoked || null, extra.deleted || null],
  ))[0].id;
  const a1 = await ask('Где родился дед Хасан?', { answer: 'В Казани, на Сенной.' });
  await ask('Когда умер?');
  await ask('Отозванный вопрос', { revoked: new Date() });
  await ask('Удалённый вопрос', { deleted: new Date() });
  const [voice] = await q("insert into ask_files (ask_id, kind, mime, bytes) values ($1, 'audio', 'audio/mpeg', 4) returning id", [a1]);
  fs.writeFileSync(askPath(voice.id), 'ID3!');

  // Черновик интервью: два ответа, один пропущен; сохранённое интервью и удалённое — не попадают.
  const iv = async (extra = '') => (await q(
    `insert into interviews (person_id, about, questions, created_by${extra ? ', ' + extra : ''})
     values ($1, 'Хасан', $2, $3${extra ? ', ' + (extra === 'deleted_at' ? 'now()' : 'gen_random_uuid()') : ''}) returning id`,
    [ded.id, JSON.stringify([{ key: 'q1', text: 'Какой была ваша мама?' }, { key: 'q2', text: 'Где вы учились?' }, { key: 'q3', text: 'Пропущенный вопрос' }]), u.id],
  ))[0].id;
  const draft = await iv();
  await q("insert into interview_answers (interview_id, qkey, note) values ($1, 'q1', 'Мама пекла чак-чак.'), ($1, 'q3', 'не то')", [draft]);
  await q("update interview_answers set skipped = true where interview_id = $1 and qkey = 'q3'", [draft]);
  const [rec] = await q("insert into interview_files (interview_id, qkey, kind, mime, bytes) values ($1, 'q2', 'audio', 'audio/mpeg', 4) returning id", [draft]);
  fs.writeFileSync(ivPath(rec.id), 'ID3!');
  const saved = await iv('saved_op');
  await q("insert into interview_answers (interview_id, qkey, note) values ($1, 'q1', 'Сохранённый ответ')", [saved]);
  const gone = await iv('deleted_at');
  await q("insert into interview_answers (interview_id, qkey, note) values ($1, 'q1', 'Удалённый ответ')", [gone]);
  await iv(); // пустой черновик — без ответов

  const info = await call(owner, 'GET', '/api/archive');
  assert.equal(info.asks, 2);
  assert.equal(info.drafts, 1);
  assert.match(info.summary, /2 вопроса родным, 1 черновик интервью/);
  assert.equal(info.audio, 0, 'голос ответов — не записи голоса дерева');

  const files = await unzip((await raw(owner, 'GET', '/api/archive.zip')).rawPayload);
  const names = [...files.keys()];
  const askTxt = files.get('Вопросы родным/Галиев Хасан (1900–…).txt')?.toString();
  assert.ok(askTxt, names.join('\n'));
  assert.match(askTxt, /01\. Вопрос: Где родился дед Хасан\?\r\nСпросил\(а\): Анна, [\d.]+\r\nКого: Ольга\r\nСостояние: есть ответ\r\nОтветили: [\d.]+\r\nОтвет:\r\n {2}В Казани, на Сенной\.\r\nЗапись голоса: Вопросы родным\/Галиев Хасан \(1900–…\)\/01 — голос\.mp3/);
  assert.match(askTxt, /02\. Вопрос: Когда умер\?\r\n[^]*Состояние: ждём ответа/);
  assert.doesNotMatch(askTxt, /Отозванный|Удалённый/);
  assert.equal(files.get('Вопросы родным/Галиев Хасан (1900–…)/01 — голос.mp3').toString(), 'ID3!');

  const ivDir = names.filter((n) => n.startsWith('Интервью (черновики)/'));
  assert.equal(ivDir.length, 3, ivDir.join('\n'));
  assert.ok(ivDir.every((n) => n.startsWith('Интервью (черновики)/Галиев Хасан (1900–…) — ')));
  const t1 = files.get(ivDir.find((n) => n.endsWith('/01 — Какой была ваша мама.txt'))).toString();
  assert.match(t1, /черновик[^]*Вопрос 1: Какой была ваша мама\?\r\n\r\nМама пекла чак-чак\./);
  assert.ok(ivDir.some((n) => n.endsWith('/02 — Где вы учились.mp3')));
  assert.ok(ivDir.some((n) => n.endsWith('/02 — Где вы учились.txt')));
  assert.ok(!names.some((n) => /Пропущенный|Сохранённый|Удалённый/.test(n)));
  assert.ok(![...files.values()].some((b) => /Сохранённый ответ|Удалённый ответ/.test(b.toString())));

  const html = files.get('index.html').toString();
  const card = (name) => html.split('<section').find((s) => s.includes(`<h2>${name}</h2>`));
  assert.match(card('Галиев Хасан'), /<h3>Вопросы родным<\/h3>[^]*Где родился дед Хасан\?[^]*<audio[^]*<h3>Интервью [\d.]+ — черновик<\/h3>[^]*Мама пекла чак-чак/);
  assert.doesNotMatch(card('Безвопросов Тихон'), /Вопросы родным|Интервью/);
  assert.ok(quiet.id);
  const readme = files.get('прочтите.txt').toString();
  assert.match(readme, /2 вопроса родным, 1 черновик интервью/);
  assert.match(readme, /Сохраните архив на компьютер и на флешку/);
});
