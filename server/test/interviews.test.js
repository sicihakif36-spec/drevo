// Интервью голосом: права, черновик по шагам, сохранение в истории одним действием и откат, ссылка без входа, гости.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildApp } from '../src/app.js';
import { signIn, H } from './helpers.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { archivePlan } from '../src/archive.js';
import { TOPICS, buildQuestions, namesFor, ivTitle, hasAnswer } from '../../shared/interview.js';
import { buildIndex } from '../../shared/names.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drevo-iv-'));
const VOICE = (() => {
  const file = path.join(tmp, 'golos.webm');
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:a', 'libopus', '-y', file]);
  return fs.readFileSync(file);
})();

let app;
let owner;
let editor;
let relative;
let guest;
let klava;
let ownerId;

const call = (cookie, method, url, payload, headers = {}) => app.inject({ method, url, payload, headers: { ...H, cookie, ...headers } });
const json = async (...args) => {
  const r = await call(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const pub = (token, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, 'x-interview': token } });
const pubJson = async (...args) => {
  const r = await pub(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
function multipart(parts) {
  const b = 'drevo-iv';
  const payload = Buffer.concat([
    ...parts.flatMap(([k, fname, t, d]) => [Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"; filename="${fname}"\r\nContent-Type: ${t}\r\n\r\n`), d, Buffer.from('\r\n')]),
    Buffer.from(`--${b}--\r\n`),
  ]);
  return { payload, type: `multipart/form-data; boundary=${b}` };
}
const voice = () => multipart([['file', 'blob', 'audio/webm;codecs=opus', VOICE]]);
const photo = () => multipart([['file', 'foto.png', 'image/png', PNG]]);
const upload = (url, { payload, type }, headers) => app.inject({ method: 'POST', url, payload, headers: { ...H, ...headers, 'content-type': type } });
const start = (cookie, body) => json(cookie, 'POST', '/api/interviews', { person_id: klava, ...body });

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await signIn(app, 'owner', { name: 'Анна' });
  editor = await signIn(app, 'editor', { name: 'Сергей' });
  relative = await signIn(app, 'relative', { name: 'Ольга' });
  guest = await signIn(app, 'viewer', { name: 'Гость' });
  ownerId = (await json(owner, 'GET', '/api/me')).user.id;
  const add = async (person, rel) => (await json(owner, 'POST', '/api/persons', { person, ...rel })).id;
  klava = await add({ given: 'Клавдия', patronymic: 'Николаевна', surname: 'Орлова', sex: 'F', living: true, birth_date: '1950', notes: 'тайна' });
  await add({ given: 'Мария', patronymic: 'Ивановна', surname: 'Петрова', sex: 'F', living: false }, { relation: { type: 'mother', to: klava } });
  await add({ given: 'Николай', patronymic: 'Петрович', surname: 'Петров', sex: 'M', living: false }, { relation: { type: 'father', to: klava } });
  await add({ given: 'Иван', patronymic: 'Сергеевич', surname: 'Орлов', sex: 'M', living: false }, { relation: { type: 'spouse', to: klava } });
  await add({ given: 'Юрий', sex: 'M', living: true }, { relation: { type: 'child', to: klava } });
});
after(async () => { await app.close(); await pool.end(); });

test('вопросы: темы по-русски, имена родных подставляются, без них — общий вопрос', async () => {
  assert.ok(TOPICS.length >= 9);
  for (const t of TOPICS) assert.ok(t.questions.length >= 5 && t.questions.length <= 8, t.key);
  const plain = buildQuestions(['parents', 'family'], {});
  assert.equal(plain[0].text, 'Какой была ваша мама? Какой вы её помните?');
  assert.equal(plain[0].key, 'parents.0');
  const tree = await json(owner, 'GET', '/api/tree');
  const n = namesFor(buildIndex(tree), klava);
  assert.equal(n.mother, 'Мария Ивановна');
  const qs = buildQuestions(['parents', 'family'], n);
  assert.equal(qs[0].text, 'Какой была ваша мама, Мария Ивановна? Какой вы её помните?');
  assert.equal(qs[1].text, 'Каким был ваш папа, Николай Петрович? Чем он занимался?');
  assert.ok(qs.some((x) => x.text === 'Ваш муж — Иван Сергеевич. Как вы познакомились?'));
  assert.ok(qs.some((x) => x.text.startsWith('Расскажите о ваших детях — Юрий.')));
  assert.equal(ivTitle('2026-10-24T10:00:00Z', new Date('2026-12-01')), 'Интервью 24 октября');
  assert.equal(ivTitle('2025-10-24T10:00:00Z', new Date('2026-12-01')), 'Интервью 24 октября 2025');
  assert.equal(hasAnswer({ skipped: true, note: 'x' }), false);
  // Сервер подставляет имена так же.
  const iv = await start(owner, { topics: ['parents'], own: ['Как звали вашу корову?'] });
  assert.equal(iv.questions[0].text, 'Какой была ваша мама, Мария Ивановна? Какой вы её помните?');
  assert.equal(iv.questions.at(-1).text, 'Как звали вашу корову?');
  assert.equal(iv.questions.at(-1).topic, 'own');
  assert.equal((await call(owner, 'POST', '/api/interviews', { person_id: klava, topics: ['нет такой'] })).statusCode, 400);
});

test('права: записывают все, кроме гостей; родственник видит только свои черновики; в дерево сохраняют участники', async () => {
  const mine = await start(relative, { topics: ['childhood'] });
  const other = await start(editor, { topics: ['school'] });
  // Родственнику не видно чужого черновика, участнику и владельцу — видно всё.
  assert.equal((await call(relative, 'GET', `/api/interviews/${other.id}`)).statusCode, 404);
  assert.ok(!(await json(relative, 'GET', '/api/interviews')).some((x) => x.id === other.id));
  assert.ok((await json(owner, 'GET', '/api/interviews')).some((x) => x.id === mine.id));
  assert.equal((await call(relative, 'PUT', `/api/interviews/${other.id}/answers/school.0`, { note: 'x' })).statusCode, 404);
  // Родственник записывает свой ответ, но сохранить в дерево и сделать ссылку не может.
  assert.equal((await upload(`/api/interviews/${mine.id}/answers/childhood.0/files`, voice(), { cookie: relative })).statusCode, 200);
  assert.equal((await call(relative, 'POST', `/api/interviews/${mine.id}/save`)).statusCode, 403);
  assert.equal((await call(relative, 'POST', `/api/interviews/${mine.id}/link`, { to_name: 'Бабушка' })).statusCode, 403);
  // А участник сохраняет черновик родственника.
  const r = await json(editor, 'POST', `/api/interviews/${mine.id}/save`);
  assert.equal(r.stories, 1);
  // Гость — ничего.
  for (const [m, u] of [['GET', '/api/interviews'], ['GET', `/api/interviews/${mine.id}`], ['POST', '/api/interviews'],
    ['PUT', `/api/interviews/${mine.id}/answers/childhood.0`], ['POST', `/api/interviews/${mine.id}/save`], ['DELETE', `/api/interviews/${mine.id}`]]) {
    assert.equal((await call(guest, m, u, m === 'GET' || m === 'DELETE' ? undefined : { person_id: klava, topics: ['childhood'] })).statusCode, 403, `${m} ${u}`);
  }
});

test('черновик: ответы по одному, «Продолжить» с того же места, переписать, пропуск; в журнал не идёт', async () => {
  const changes = (await q('select count(*)::int as n from changes'))[0].n;
  const iv = await start(owner, { topics: ['childhood', 'parents'] });
  const base = `/api/interviews/${iv.id}`;
  const [a, b, c, d] = iv.questions.map((x) => x.key);
  const v1 = await upload(`${base}/answers/${a}/files`, voice(), { cookie: owner });
  assert.equal(v1.statusCode, 200, v1.body);
  assert.ok(v1.json().duration >= 1);
  await json(owner, 'PUT', `${base}/answers/${a}`, { note: 'Родилась в Горках' });
  await json(owner, 'PUT', `${base}/answers/${b}`, { skipped: true });
  await upload(`${base}/answers/${c}/files`, voice(), { cookie: owner });
  assert.equal((await upload(`${base}/answers/${c}/files`, photo(), { cookie: owner })).statusCode, 200);
  await json(owner, 'PATCH', base, { pos: 3 });
  // Закрыли приложение — открыли снова: тот же вопрос, ответы на месте.
  let got = await json(owner, 'GET', base);
  assert.equal(got.pos, 3);
  assert.equal(got.answered, 2);
  assert.equal(got.skipped, 1);
  assert.equal(got.answers[a].note, 'Родилась в Горках');
  assert.equal(got.answers[b].skipped, true);
  // Переписать: новая запись заменяет прежнюю, старый файл убран с диска.
  const v2 = (await upload(`${base}/answers/${a}/files`, voice(), { cookie: owner })).json();
  got = await json(owner, 'GET', base);
  assert.deepEqual(got.answers[a].files.map((f) => f.id), [v2.id]);
  assert.equal((await call(owner, 'GET', `${base}/files/${v1.json().id}`)).statusCode, 404);
  assert.equal((await call(owner, 'GET', `${base}/files/${v2.id}`)).statusCode, 200);
  // Записали пропущенный — он больше не пропущен.
  await upload(`${base}/answers/${b}/files`, voice(), { cookie: owner });
  assert.equal((await json(owner, 'GET', base)).answers[b].skipped, false);
  await json(owner, 'PUT', `${base}/answers/${d}`, { skipped: true });
  // Свой вопрос — после текущего.
  const own = await json(owner, 'POST', `${base}/questions`, { text: 'Как звали соседей?', after: 3 });
  assert.equal(own.index, 4);
  assert.equal((await json(owner, 'GET', base)).questions[4].text, 'Как звали соседей?');
  // Чужие вопросы и файлы — нельзя.
  assert.equal((await call(owner, 'PUT', `${base}/answers/nope.1`, { note: 'x' })).statusCode, 404);
  const bad = multipart([['file', 'a.txt', 'text/plain', Buffer.from('hi')]]);
  assert.equal((await upload(`${base}/answers/${a}/files`, bad, { cookie: owner })).statusCode, 400);
  assert.equal((await call(owner, 'PUT', `${base}/answers/${a}`, { note: 'x'.repeat(5001) })).statusCode, 400);
  // Черновик — не правка дерева.
  assert.equal((await q('select count(*)::int as n from changes'))[0].n, changes);
});

test('«Сохранить в истории» — одно действие: истории с голосом, фото в альбом, пропущенные — без историй; откат и сохранить снова', async () => {
  const iv = await start(owner, { topics: ['childhood'] });
  const base = `/api/interviews/${iv.id}`;
  const k = iv.questions.map((x) => x.key);
  await upload(`${base}/answers/${k[0]}/files`, voice(), { cookie: owner });
  await json(owner, 'PUT', `${base}/answers/${k[0]}`, { note: 'Дом у реки' });
  await json(owner, 'PUT', `${base}/answers/${k[1]}`, { skipped: true });
  await upload(`${base}/answers/${k[2]}/files`, voice(), { cookie: owner });
  await upload(`${base}/answers/${k[2]}/files`, photo(), { cookie: owner });
  // Пропущенный с записью — тоже без истории.
  await upload(`${base}/answers/${k[3]}/files`, voice(), { cookie: owner });
  await json(owner, 'PUT', `${base}/answers/${k[3]}`, { skipped: true });
  // Только заметка — тоже история.
  await json(owner, 'PUT', `${base}/answers/${k[4]}`, { note: 'Носила воду' });

  const before = (await json(owner, 'GET', `/api/persons/${klava}/stories`)).length;
  const r = await json(owner, 'POST', `${base}/save`);
  assert.deepEqual([r.stories, r.photos], [3, 1]);
  const stories = (await json(owner, 'GET', `/api/persons/${klava}/stories`)).filter((s) => s.interview_id === iv.id)
    .sort((a, b) => a.interview_no - b.interview_no);
  assert.equal(stories.length, 3);
  assert.deepEqual(stories.map((s) => s.title), [iv.questions[0].text, iv.questions[2].text, iv.questions[4].text]);
  assert.deepEqual(stories.map((s) => s.interview_no), [1, 2, 3]);
  assert.equal(stories[0].body, 'Дом у реки');
  assert.ok(stories[0].audio_id && stories[1].audio_id && !stories[2].audio_id);
  assert.ok(stories[0].interview_at);
  assert.equal((await call(owner, 'GET', `/api/media/${stories[0].audio_id}`)).statusCode, 200);
  const album = await json(owner, 'GET', `/api/persons/${klava}/media`);
  assert.ok(album.some((m) => m.caption.startsWith('Интервью ') && m.caption.includes(iv.questions[2].text)));
  // Одно действие в журнале, его сводка — интервью.
  const op = (await json(owner, 'GET', '/api/changes'))[0];
  assert.equal(op.id, r.change);
  assert.equal(op.entries[0].entity, 'interview');
  assert.deepEqual([op.entries[0].after.stories, op.entries[0].after.photos], [3, 1]);
  assert.equal(op.entries.filter((e) => e.entity === 'story').length, 3);
  let list = (await json(owner, 'GET', `/api/interviews?person=${klava}`)).find((x) => x.id === iv.id);
  assert.equal(list.saved, true);
  // Сохранённый черновик больше не правится и второй раз не сохраняется.
  assert.equal((await call(owner, 'POST', `${base}/save`)).statusCode, 409);
  assert.equal((await call(owner, 'PUT', `${base}/answers/${k[1]}`, { note: 'x' })).statusCode, 409);
  assert.equal((await upload(`${base}/answers/${k[1]}/files`, voice(), { cookie: owner })).statusCode, 409);

  // Отмена — одной кнопкой: истории и фото пропадают, черновик снова можно сохранить.
  await json(owner, 'POST', `/api/changes/${r.change}/revert`);
  assert.equal((await json(owner, 'GET', `/api/persons/${klava}/stories`)).length, before);
  assert.ok(!(await json(owner, 'GET', `/api/persons/${klava}/media`)).some((m) => m.caption.startsWith('Интервью ')));
  list = (await json(owner, 'GET', `/api/interviews?person=${klava}`)).find((x) => x.id === iv.id);
  assert.equal(list.saved, false);
  await json(owner, 'PUT', `${base}/answers/${k[1]}`, { note: 'Ходили за грибами', skipped: false });
  const again = await json(owner, 'POST', `${base}/save`);
  assert.equal(again.stories, 4);
  // Вернуть первую отмену нельзя: интервью сохранено заново (иначе истории задвоятся).
  const undo = (await json(owner, 'GET', '/api/changes')).find((o) => o.entries.some((e) => e.entity === 'interview' && e.action === 'unsave'));
  assert.equal((await call(owner, 'POST', `/api/changes/${undo.id}/revert`)).statusCode, 409);
  // Отмена и возврат отмены: снова сохранено.
  await json(owner, 'POST', `/api/changes/${again.change}/revert`);
  const undo2 = (await json(owner, 'GET', '/api/changes'))[0];
  await json(owner, 'POST', `/api/changes/${undo2.id}/revert`);
  assert.equal((await json(owner, 'GET', `/api/interviews?person=${klava}`)).find((x) => x.id === iv.id).saved, true);
  assert.equal((await json(owner, 'GET', `/api/persons/${klava}/stories`)).filter((s) => s.interview_id === iv.id).length, 4);

  // «Скачать всё»: понятные названия по порядку.
  const plan = await archivePlan({ id: ownerId, role: 'owner' });
  const day = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
  const paths = plan.entries.map((e) => e.path).filter((p) => p.includes('Интервью'));
  assert.ok(paths.some((p) => p.startsWith('Истории/') && p.includes(`Интервью ${day} — 01 — Где и когда вы родились`)), paths.join('\n'));
  assert.ok(paths.some((p) => p.startsWith('Записи голоса/') && p.includes(`Интервью ${day} — 03 — Какое ваше самое раннее`) && p.endsWith('.mp3')), paths.join('\n'));

  // Пустое интервью сохранять нечего.
  const empty = await start(owner, { topics: ['work'] });
  await json(owner, 'PUT', `/api/interviews/${empty.id}/answers/work.0`, { skipped: true });
  assert.equal((await call(owner, 'POST', `/api/interviews/${empty.id}/save`)).statusCode, 400);
});

test('по ссылке: только вопросы, без входа и без «Входов»; в несколько заходов; срок, отзыв, перебор', async () => {
  const counts = async () => (await q('select (select count(*) from sessions) as s, (select count(*) from logins) as l'))[0];
  const was = await counts();
  const iv = await start(editor, { topics: ['parents'] });
  const link = await json(editor, 'POST', `/api/interviews/${iv.id}/link`, { to_name: 'Тётя Валя' });
  assert.match(link.url, /\/#\/iv\/[\w-]{40,}$/);
  const row = (await q('select * from interviews where id = $1', [iv.id]))[0];
  assert.notEqual(row.token_hash, link.token);
  assert.ok(Math.abs(row.expires_at - Date.now() - 60 * 86400000) < 60000);

  const r = await pub(link.token, 'GET', '/api/interview');
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['set-cookie'], undefined);
  const got = r.json();
  assert.deepEqual(Object.keys(got).sort(), ['answers', 'expires_at', 'from', 'pos', 'questions', 'saved']);
  assert.equal(got.from, 'Сергей');
  // Ничего из дерева: ни имени, ни дат, ни заметок, ни id человека, ни подписи «для кого».
  for (const x of ['Орлова', '1950', 'тайна', klava, 'Тётя Валя', iv.id]) assert.ok(!JSON.stringify(got).includes(x), x);
  assert.equal((await pub(link.token, 'GET', '/api/tree')).statusCode, 401);
  assert.equal((await pub(link.token, 'GET', `/api/interviews/${iv.id}`)).statusCode, 401);
  assert.equal((await pub(link.token, 'GET', '/api/me')).json().user, null);

  // Первый заход: запись и фото. Второй заход: ещё ответ и место, где остановились.
  const k = got.questions.map((x) => x.key);
  const v = await upload(`/api/interview/answers/${k[0]}/files`, voice(), { 'x-interview': link.token });
  assert.equal(v.statusCode, 200, v.body);
  assert.equal(v.headers['set-cookie'], undefined);
  assert.equal((await pub(link.token, 'GET', `/api/interview/files/${v.json().id}`)).statusCode, 200);
  await pubJson(link.token, 'PUT', `/api/interview/answers/${k[1]}`, { skipped: true });
  await pubJson(link.token, 'PATCH', '/api/interview', { pos: 2 });
  const back = await pubJson(link.token, 'GET', '/api/interview');
  assert.equal(back.pos, 2);
  assert.equal(back.answers[k[0]].files.length, 1);
  await upload(`/api/interview/answers/${k[2]}/files`, voice(), { 'x-interview': link.token });
  // У того, кто ведёт дерево, видно сразу.
  const mine = await json(editor, 'GET', `/api/interviews/${iv.id}`);
  assert.equal(mine.answered, 2);
  assert.equal(mine.to_name, 'Тётя Валя');
  assert.equal((await call(editor, 'GET', `/api/interviews/${iv.id}/files/${v.json().id}`)).statusCode, 200);
  // Родственнику подпись «для кого» не отдаётся (а чужой черновик — вовсе).
  assert.equal((await call(relative, 'GET', `/api/interviews/${iv.id}`)).statusCode, 404);
  assert.deepEqual(await counts(), was);

  // Новая ссылка — старая не работает; отзыв; срок.
  const fresh = await json(editor, 'POST', `/api/interviews/${iv.id}/link`, {});
  assert.equal((await pub(link.token, 'GET', '/api/interview')).statusCode, 404);
  assert.equal((await pubJson(fresh.token, 'GET', '/api/interview')).answers[k[0]].files.length, 1);
  await json(editor, 'POST', `/api/interviews/${iv.id}/revoke`);
  assert.equal((await pub(fresh.token, 'GET', '/api/interview')).statusCode, 410);
  assert.equal((await pub(fresh.token, 'PUT', `/api/interview/answers/${k[3]}`, { note: 'x' })).statusCode, 410);
  const third = await json(editor, 'POST', `/api/interviews/${iv.id}/link`, {});
  await q("update interviews set expires_at = now() - interval '1 minute' where id = $1", [iv.id]);
  assert.equal((await pub(third.token, 'GET', '/api/interview')).statusCode, 410);
  await q("update interviews set expires_at = now() + interval '1 day' where id = $1", [iv.id]);
  // Сохранили в дерево — страничка благодарит, но ничего не меняет.
  await json(editor, 'POST', `/api/interviews/${iv.id}/save`);
  assert.equal((await pubJson(third.token, 'GET', '/api/interview')).saved, true);
  const late = await pub(third.token, 'PUT', `/api/interview/answers/${k[3]}`, { note: 'x' });
  assert.equal(late.statusCode, 409);
  assert.match(late.json().error, /уже сохранены/);

  // Удалённое интервью по ссылке не открывается; перебор ключей — подождать.
  await json(editor, 'DELETE', `/api/interviews/${iv.id}`);
  assert.equal((await pub(third.token, 'GET', '/api/interview')).statusCode, 404);
  assert.ok(!(await json(editor, 'GET', '/api/interviews')).some((x) => x.id === iv.id));
  assert.ok((await q('select deleted_at from interviews where id = $1', [iv.id]))[0].deleted_at);
  let res;
  for (let i = 0; i < 25; i++) res = await pub(`neverny-kluch-${i}-xxxxxxxxxxxxxxxx`, 'GET', '/api/interview');
  assert.equal(res.statusCode, 429);
});

test('гость: ни черновиков, ни интервью; истории из интервью — по общим правилам историй', async () => {
  const tree = await json(guest, 'GET', '/api/tree');
  assert.ok(!JSON.stringify(tree).includes('interview'));
  // Истории Клавдии (жива, моложе 100 лет) гостю не видны, в том числе из интервью.
  assert.deepEqual(await json(guest, 'GET', `/api/persons/${klava}/stories`), []);
  // Интервью об ушедшей Марии Ивановне — гость видит истории, но не черновик.
  const mother = (await json(owner, 'GET', '/api/tree')).persons.find((p) => p.given === 'Мария').id;
  const iv = await json(owner, 'POST', '/api/interviews', { person_id: mother, topics: ['advice'] });
  await upload(`/api/interviews/${iv.id}/answers/advice.0/files`, voice(), { cookie: owner });
  assert.equal((await call(guest, 'GET', `/api/interviews/${iv.id}`)).statusCode, 403);
  assert.equal((await call(guest, 'GET', `/api/interviews/${iv.id}/files/x`)).statusCode, 403);
  await json(owner, 'POST', `/api/interviews/${iv.id}/save`);
  const seen = await json(guest, 'GET', `/api/persons/${mother}/stories`);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].interview_no, 1);
  // В ленте гостю — только числа, без даты и имени.
  const feed = JSON.stringify(await json(guest, 'GET', '/api/changes').catch(() => null)) + JSON.stringify(await json(guest, 'GET', '/api/feed'));
  assert.ok(!feed.includes('Петрова Мария'));
  assert.ok(!feed.includes('"title":"Интервью'));
  // Поток обновлений: событие интервью гостю не шлётся (проверено в events.js по виду), а черновики не попадают в ответы API.
  for (const u of ['/api/interviews', `/api/interviews?person=${mother}`]) assert.equal((await call(guest, 'GET', u)).statusCode, 403);
});
