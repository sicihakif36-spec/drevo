// «Спросить у родных»: права, вопрос в приложении и по ссылке, уведомления, ответ в дерево через журнал, гости.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildApp } from '../src/app.js';
import { createInvite } from '../src/auth.js';
import { signIn, H, cookieOf } from './helpers.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { askHints, findingAsk, researchAsk, askStatus, about } from '../../shared/asks.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drevo-ask-'));
const VOICE = (() => {
  const file = path.join(tmp, 'golos.webm');
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:a', 'libopus', '-y', file]);
  return fs.readFileSync(file);
})();

let app;
let sent = [];
let owner;
let editor;
let relative;
let guest;
let olga; // id пользователя-родственника
let klava; // человек, о котором спрашивают

const call = (cookie, method, url, payload, headers = {}) => app.inject({ method, url, payload, headers: { ...H, cookie, ...headers } });
const json = async (...args) => {
  const r = await call(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
// По ссылке: без входа, токен — в заголовке x-ask.
const pub = (token, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, 'x-ask': token } });
const pubJson = async (...args) => {
  const r = await pub(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
function multipart(parts) {
  const b = 'drevo-ask';
  const payload = Buffer.concat([
    ...parts.flatMap(([k, fname, t, d]) => [Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"; filename="${fname}"\r\nContent-Type: ${t}\r\n\r\n`), d, Buffer.from('\r\n')]),
    Buffer.from(`--${b}--\r\n`),
  ]);
  return { payload, type: `multipart/form-data; boundary=${b}` };
}
const photoParts = () => multipart([['file', 'foto.png', 'image/png', PNG], ['thumb', 'thumb.jpg', 'image/jpeg', JPEG]]);
const voiceParts = () => multipart([['file', 'blob', 'audio/webm;codecs=opus', VOICE]]);
const upload = (url, { payload, type }, headers) => app.inject({ method: 'POST', url, payload, headers: { ...H, ...headers, 'content-type': type } });
const ask = (cookie, body) => json(cookie, 'POST', '/api/asks', { person_id: klava, ...body });
const settled = () => app.push.settled();
const pushesTo = (n) => sent.filter((s) => s.to === n).map((s) => s.msg);
const lastOp = async () => (await json(owner, 'GET', '/api/changes'))[0];

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async (sub, payload) => { sent.push({ to: sub.endpoint.split('/').at(-1), msg: JSON.parse(payload) }); } } });
  owner = await signIn(app, 'owner', { name: 'Анна' });
  editor = await signIn(app, 'editor', { name: 'Сергей' });
  relative = await signIn(app, 'relative', { name: 'Ольга' });
  guest = await signIn(app, 'viewer', { name: 'Гость' });
  for (const [c, n] of [[owner, 'owner'], [editor, 'editor'], [relative, 'relative'], [guest, 'guest']]) {
    await json(c, 'PUT', '/api/push/subscription', { endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: 'BKey', auth: 'auth' } });
  }
  olga = (await json(relative, 'GET', '/api/me')).user.id;
  klava = (await json(owner, 'POST', '/api/persons', { person: { given: 'Клавдия', patronymic: 'Николаевна', surname: 'Орлова', sex: 'F', living: true, birth_date: '1950', notes: 'тайна' } })).id;
  // Ольга в дереве — женщина: «Ольга ответила».
  const me = await json(owner, 'POST', '/api/persons', { person: { given: 'Ольга', sex: 'F', living: true } });
  await json(relative, 'PATCH', '/api/me', { person_id: me.id });
});
after(async () => { await app.close(); await pool.end(); });

test('подсказки вопроса: чего не хватает, находка проверки, вопрос исследования', () => {
  const p = { id: '1', given: 'Клавдия', patronymic: 'Николаевна', sex: 'F', living: false, photo_id: null };
  const hints = askHints(p, null);
  assert.equal(hints[0].text, 'Когда родилась Клавдия Николаевна? Хотя бы примерно — год.');
  assert.equal(hints[0].field, 'birth_date');
  assert.ok(hints.some((h) => h.field === 'birth_place'));
  assert.ok(hints.some((h) => h.text.startsWith('Есть ли у вас фото Клавдии Николаевны')));
  assert.equal(hints.at(-1).text, 'Что вы помните о Клавдии Николаевне?');
  assert.equal(about({ given: 'Анна', sex: 'F' }), 'об Анне');
  assert.deepEqual(findingAsk({ text: 'Юрий — в 1936: матери было 12 лет', field: 'birth_date' }), { text: 'Юрий — в 1936: матери было 12 лет. Как правильно?', field: 'birth_date' });
  assert.equal(researchAsk({ id: 'x', title: 'Где похоронен?' }).text, 'Где похоронен — что вы об этом знаете?');
  assert.equal(askStatus({ expires_at: new Date(Date.now() - 1000) }), 'expired');
  assert.equal(askStatus({ answered_at: new Date(), closed_at: new Date() }), 'closed');
});

test('права: спрашивают владелец и участники; гостя и себя спросить нельзя', async () => {
  const people = await json(editor, 'GET', '/api/asks/people');
  assert.deepEqual(people.map((u) => u.name).sort(), ['Анна', 'Ольга']);
  for (const c of [relative, guest]) {
    const r = await call(c, 'POST', '/api/asks', { person_id: klava, question: 'Где родилась?', to_user: olga });
    assert.equal(r.statusCode, 403);
    assert.equal((await call(c, 'GET', '/api/asks/people')).statusCode, 403);
    assert.equal((await call(c, 'GET', '/api/asks')).statusCode, 403);
  }
  const guestId = (await json(guest, 'GET', '/api/me')).user.id;
  assert.equal((await call(owner, 'POST', '/api/asks', { person_id: klava, question: 'Где?', to_user: guestId })).statusCode, 400);
  const me = (await json(owner, 'GET', '/api/me')).user.id;
  assert.equal((await call(owner, 'POST', '/api/asks', { person_id: klava, question: 'Где?', to_user: me })).statusCode, 400);
  assert.equal((await call(owner, 'POST', '/api/asks', { person_id: klava, question: '  ', to_user: olga })).statusCode, 400);
  assert.equal((await call(owner, 'POST', '/api/asks', { person_id: klava, question: 'x'.repeat(1001), to_user: olga })).statusCode, 400);
  assert.equal((await call(owner, 'POST', '/api/asks', { person_id: klava, question: 'Где?' })).statusCode, 400); // ни кому, ни ссылки
  // Участник без пароля пока только смотрит — и спросить не может.
  const { token } = await createInvite({ role: 'editor' });
  const nopass = cookieOf(await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token, name: 'Новый' } }));
  const r = await call(nopass, 'POST', '/api/asks', { person_id: klava, question: 'Где?', to_user: olga });
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().password, true);
});

test('вопрос в приложении: уведомление адресату, «Вас спросили», ответ с фото и голосом, ответ спросившему и в обсуждении', async () => {
  await settled();
  sent = [];
  const a = await ask(editor, { question: 'Где родилась Клавдия Николаевна?', field: 'birth_place', to_user: olga });
  assert.equal(a.status, 'waiting');
  await settled();
  // Только адресату — без шума остальным.
  assert.deepEqual(sent.map((s) => s.to), ['relative']);
  assert.equal(sent[0].msg.title, 'Сергей спрашивает вас о Клавдии Николаевне');
  assert.equal(sent[0].msg.body, 'Где родилась Клавдия Николаевна?');
  assert.equal(sent[0].msg.url, `/#/asks/${a.id}`);

  // «Вас спросили»: в ленте, в дереве — сколько ждут ответа, в обсуждении карточки.
  const feed = await json(relative, 'GET', '/api/feed');
  assert.deepEqual(feed.asked.map((x) => x.id), [a.id]);
  assert.equal(feed.asked[0].from_name, 'Сергей');
  assert.equal((await json(relative, 'GET', '/api/tree')).asks_waiting, 1);
  assert.equal((await json(owner, 'GET', '/api/tree')).asks_waiting, 0);
  assert.deepEqual((await json(relative, 'GET', '/api/asks/mine')).map((x) => x.id), [a.id]);
  assert.deepEqual((await json(owner, 'GET', `/api/persons/${klava}/asks`)).map((x) => x.id), [a.id]);
  // Вопрос — не правка дерева и не комментарий: нет ни в журнале, ни в обсуждении-комментариях, ни в ленте у других.
  assert.ok(!JSON.stringify(await json(owner, 'GET', '/api/changes')).includes('Где родилась'));
  assert.deepEqual(await json(owner, 'GET', `/api/persons/${klava}/comments`), []);
  assert.deepEqual((await json(owner, 'GET', '/api/feed')).asked, []);

  // Отвечает только адресат.
  assert.equal((await call(owner, 'POST', `/api/asks/${a.id}/answer`, { answer: 'не я' })).statusCode, 404);
  assert.equal((await upload(`/api/asks/${a.id}/files`, photoParts(), { cookie: editor })).statusCode, 404);
  const ph = await upload(`/api/asks/${a.id}/files`, photoParts(), { cookie: relative });
  assert.equal(ph.statusCode, 200, ph.body);
  assert.equal(ph.json().kind, 'photo');
  const vo = await upload(`/api/asks/${a.id}/files`, voiceParts(), { cookie: relative });
  assert.equal(vo.statusCode, 200, vo.body);
  assert.equal(vo.json().kind, 'audio');
  assert.ok(vo.json().duration >= 1);
  // Вторая запись голоса — нельзя, пока не уберёшь первую.
  assert.equal((await upload(`/api/asks/${a.id}/files`, voiceParts(), { cookie: relative })).statusCode, 400);
  // До ответа файлы не видны никому, кроме отвечающего.
  assert.equal((await call(owner, 'GET', `/api/asks/${a.id}/files/${ph.json().id}`)).statusCode, 404);
  assert.equal((await call(relative, 'GET', `/api/asks/${a.id}/files/${ph.json().id}`)).statusCode, 200);

  sent = [];
  assert.equal((await call(relative, 'POST', `/api/asks/${a.id}/answer`, { answer: 'x'.repeat(10001) })).statusCode, 400);
  await json(relative, 'POST', `/api/asks/${a.id}/answer`, { answer: 'В деревне Горки, Калининская область.' });
  await settled();
  assert.deepEqual(sent.map((s) => s.to), ['editor']);
  assert.equal(sent[0].msg.title, 'Ольга ответила на ваш вопрос о Клавдии Николаевне');
  assert.equal(sent[0].msg.body, 'В деревне Горки, Калининская область.');
  // Повторный ответ — нельзя.
  assert.equal((await call(relative, 'POST', `/api/asks/${a.id}/answer`, { answer: 'ещё' })).statusCode, 409);
  assert.equal((await upload(`/api/asks/${a.id}/files`, photoParts(), { cookie: relative })).statusCode, 409);

  // Ответ — в обсуждении у всех, кто его видит (родственнику тоже), с фото и голосом; у спросившего — в ленте.
  const talk = (await json(relative, 'GET', `/api/persons/${klava}/asks`))[0];
  assert.equal(talk.answer, 'В деревне Горки, Калининская область.');
  assert.equal(talk.status, 'answered');
  assert.deepEqual(talk.files.map((f) => f.kind).sort(), ['audio', 'photo']);
  assert.equal(talk.research_id, undefined);
  const audio = talk.files.find((f) => f.kind === 'audio');
  const r = await call(owner, 'GET', `/api/asks/${a.id}/files/${audio.id}?full`, undefined, { range: 'bytes=0-9' });
  assert.equal(r.statusCode, 206);
  assert.equal(r.headers['content-type'], 'audio/mpeg');
  const item = (await json(editor, 'GET', '/api/feed')).items.find((x) => x.kind === 'answer');
  assert.equal(item.who, 'Ольга');
  assert.equal(item.fresh, true);
  assert.equal((await json(relative, 'GET', '/api/tree')).asks_waiting, 0);
  assert.deepEqual(await json(relative, 'GET', '/api/asks/mine'), []);
});

test('уведомления — по настройке «обсуждение»; «Напомнить» — не чаще раза в час; отзыв', async () => {
  await json(relative, 'PATCH', '/api/push/settings', { comments: false });
  sent = [];
  const a = await ask(owner, { question: 'Как звали её мать?', to_user: olga });
  await settled();
  assert.deepEqual(sent, []);
  await json(relative, 'PATCH', '/api/push/settings', { comments: true });
  // Напомнить сразу — рано.
  assert.equal((await call(owner, 'POST', `/api/asks/${a.id}/remind`)).statusCode, 409);
  await q("update asks set created_at = now() - interval '2 hours' where id = $1", [a.id]);
  await json(owner, 'POST', `/api/asks/${a.id}/remind`);
  await settled();
  assert.deepEqual(pushesTo('relative').map((m) => m.title), ['Анна спрашивает вас о Клавдии Николаевне']);
  // Отозвать: адресат больше не видит, ответить нельзя, в обсуждении нет.
  await json(owner, 'POST', `/api/asks/${a.id}/revoke`);
  assert.deepEqual(await json(relative, 'GET', '/api/asks/mine'), []);
  assert.equal((await call(relative, 'POST', `/api/asks/${a.id}/answer`, { answer: 'Мария' })).statusCode, 410);
  assert.ok(!(await json(relative, 'GET', `/api/persons/${klava}/asks`)).some((x) => x.id === a.id));
  assert.equal((await json(owner, 'GET', '/api/asks')).find((x) => x.id === a.id).status, 'revoked');
});

test('по ссылке: только вопрос, без сессии; ответ с фото и голосом; срок, отзыв, повтор, новая ссылка', async () => {
  const before = (await q('select (select count(*) from sessions) as s, (select count(*) from logins) as l'))[0];
  sent = [];
  const a = await ask(editor, { question: 'Какой год рождения верный — 1946 или 1936?', field: 'birth_date', to_name: 'Тётя Валя' });
  assert.match(a.url, /\/#\/ask\/[\w-]{40,}$/);
  assert.equal(a.link, true);
  const row = (await q('select * from asks where id = $1', [a.id]))[0];
  assert.notEqual(row.token_hash, a.token);
  assert.ok(Math.abs(row.expires_at - Date.now() - 30 * 86400000) < 60000);
  await settled();
  assert.deepEqual(sent, []); // ссылку отправляют сами

  const r = await pub(a.token, 'GET', '/api/ask');
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['set-cookie'], undefined);
  const got = r.json();
  assert.deepEqual(Object.keys(got).sort(), ['about', 'answer', 'answered', 'expires_at', 'files', 'from', 'question']);
  assert.equal(got.from, 'Сергей');
  assert.equal(got.about, 'Орлова Клавдия Николаевна');
  // Ничего из дерева: ни дат, ни заметок, ни id, ни подписи «для кого».
  for (const x of ['1950', 'тайна', klava, 'Тётя Валя']) assert.ok(!JSON.stringify(got).includes(x), x);
  // Вход ссылка не даёт.
  assert.equal((await pub(a.token, 'GET', '/api/tree')).statusCode, 401);
  assert.equal((await pub(a.token, 'GET', `/api/asks/${a.id}`)).statusCode, 401);
  assert.equal((await pub(a.token, 'GET', '/api/me')).json().user, null);
  // Пока ответа нет, родственнику по ссылочному вопросу ничего не видно.
  assert.equal((await call(relative, 'GET', `/api/asks/${a.id}`)).statusCode, 404);

  const ph = await upload('/api/ask/files', photoParts(), { 'x-ask': a.token });
  assert.equal(ph.statusCode, 200, ph.body);
  assert.equal(ph.headers['set-cookie'], undefined);
  assert.equal((await upload('/api/ask/files', voiceParts(), { 'x-ask': a.token })).statusCode, 200);
  const bad = multipart([['file', 'a.txt', 'text/plain', Buffer.from('hi')]]);
  assert.equal((await upload('/api/ask/files', bad, { 'x-ask': a.token })).statusCode, 400);
  assert.equal((await pub(a.token, 'GET', `/api/ask/files/${ph.json().id}`)).statusCode, 200);
  // Фото и голос без текста — тоже ответ. Второй раз ответить нельзя.
  assert.equal((await pub(a.token, 'POST', '/api/ask/answer', { answer: '' })).statusCode, 200);
  assert.equal((await pub(a.token, 'POST', '/api/ask/answer', { answer: 'В 1936' })).statusCode, 409);
  assert.equal((await pub(a.token, 'DELETE', `/api/ask/files/${ph.json().id}`)).statusCode, 409);
  await settled();
  assert.deepEqual(pushesTo('editor').map((m) => m.title), ['Тётя Валя ответил(а) на ваш вопрос о Клавдии Николаевне']);
  // Отвеченную страничку можно открыть и после срока — увидеть, что ответ отправлен.
  await q("update asks set expires_at = now() - interval '1 minute' where id = $1", [a.id]);
  assert.equal((await pubJson(a.token, 'GET', '/api/ask')).answered, true);
  const now = (await q('select (select count(*) from sessions) as s, (select count(*) from logins) as l'))[0];
  assert.deepEqual(now, before);
  const list = (await json(owner, 'GET', '/api/asks')).find((x) => x.id === a.id);
  assert.equal(list.status, 'answered');
  assert.equal(list.to_name, 'Тётя Валя');
  assert.equal(list.files.length, 2);

  // Срок истёк, отзыв, новая ссылка взамен старой.
  const b = await ask(owner, { question: 'Где похоронена?', to_name: 'Дядя Коля' });
  await q("update asks set expires_at = now() - interval '1 minute' where id = $1", [b.id]);
  assert.equal((await pub(b.token, 'GET', '/api/ask')).statusCode, 410);
  assert.equal((await json(owner, 'GET', '/api/asks')).find((x) => x.id === b.id).status, 'expired');
  const again = await json(owner, 'POST', `/api/asks/${b.id}/remind`);
  assert.equal((await pub(b.token, 'GET', '/api/ask')).statusCode, 404);
  assert.equal((await pubJson(again.token, 'GET', '/api/ask')).question, 'Где похоронена?');
  await json(owner, 'POST', `/api/asks/${b.id}/revoke`);
  assert.equal((await pub(again.token, 'GET', '/api/ask')).statusCode, 410);
  assert.equal((await pub(again.token, 'POST', '/api/ask/answer', { answer: 'там' })).statusCode, 410);
  // Без токена и с неверным.
  assert.equal((await app.inject({ method: 'GET', url: '/api/ask' })).statusCode, 404);
  assert.equal((await pub('x'.repeat(43), 'GET', '/api/ask')).statusCode, 404);
});

test('«Сохранить как историю» и «Дописать в карточку» — через журнал и отменяются', async () => {
  const a = await ask(editor, { question: 'Что вы помните о Клавдии Николаевне?', to_user: olga });
  await upload(`/api/asks/${a.id}/files`, photoParts(), { cookie: relative });
  await upload(`/api/asks/${a.id}/files`, voiceParts(), { cookie: relative });
  await json(relative, 'POST', `/api/asks/${a.id}/answer`, { answer: 'Пекла пироги с капустой.' });
  // Родственник и гость в дерево не переносят.
  for (const c of [relative, guest]) assert.equal((await call(c, 'POST', `/api/asks/${a.id}/story`)).statusCode, 403);
  const before = (await json(owner, 'GET', `/api/persons/${klava}/media`)).length;
  const res = await json(owner, 'POST', `/api/asks/${a.id}/story`);
  const stories = await json(owner, 'GET', `/api/persons/${klava}/stories`);
  const s = stories.find((x) => x.id === res.story_id);
  assert.equal(s.title, 'Ольга: Что вы помните о Клавдии Николаевне?');
  assert.equal(s.body, 'Пекла пироги с капустой.');
  assert.ok(s.audio_id);
  assert.equal((await json(owner, 'GET', `/api/persons/${klava}/media`)).length, before + 1);
  assert.equal((await call(owner, 'POST', `/api/asks/${a.id}/story`)).statusCode, 409);
  assert.equal((await json(owner, 'GET', `/api/asks/${a.id}`)).story, true);
  // Одно действие в журнале: история и фото; отмена убирает оба, и ответ можно сохранить снова.
  const op = await lastOp();
  assert.equal(op.id, res.change);
  assert.deepEqual(op.entries.map((e) => `${e.entity}:${e.action}`).sort(), ['media:add', 'story:add']);
  await json(owner, 'POST', `/api/changes/${op.id}/revert`);
  assert.ok(!(await json(owner, 'GET', `/api/persons/${klava}/stories`)).some((x) => x.id === res.story_id));
  assert.equal((await json(owner, 'GET', `/api/persons/${klava}/media`)).length, before);
  assert.equal((await json(owner, 'GET', `/api/asks/${a.id}`)).story, false);
  await json(owner, 'POST', `/api/asks/${a.id}/story`);

  // «Дописать в карточку» — обычная правка карточки: в журнал и отменяется.
  const p = (await json(owner, 'GET', '/api/tree')).persons.find((x) => x.id === klava);
  await json(owner, 'PATCH', `/api/persons/${klava}`, { birth_place: 'д. Горки', version: p.version });
  const edit = await lastOp();
  assert.deepEqual(edit.entries.map((e) => [e.entity, e.action, e.after?.birth_place]), [['person', 'update', 'д. Горки']]);
  await json(owner, 'POST', `/api/changes/${edit.id}/revert`);
  assert.equal((await json(owner, 'GET', '/api/tree')).persons.find((x) => x.id === klava).birth_place, '');

  // «Закрыть вопрос».
  await json(owner, 'POST', `/api/asks/${a.id}/close`);
  assert.equal((await json(owner, 'GET', `/api/asks/${a.id}`)).status, 'closed');
});

test('«Записать в журнал поиска» — запись к вопросу исследования; отменяется', async () => {
  const x = await json(owner, 'POST', `/api/persons/${klava}/research`, { title: 'Где похоронена' });
  const a = await ask(owner, { question: 'Где похоронена — что вы об этом знаете?', research_id: x.id, to_user: olga });
  // Родственнику вопрос виден, а исследование — нет.
  const seen = await json(relative, 'GET', `/api/asks/${a.id}`);
  assert.equal(seen.research_id, undefined);
  assert.equal(seen.research_title, undefined);
  assert.equal((await call(owner, 'POST', `/api/asks/${a.id}/research`)).statusCode, 409); // ответа ещё нет
  await json(relative, 'POST', `/api/asks/${a.id}/answer`, { answer: 'На кладбище в Горках, у церкви.' });
  const res = await json(owner, 'POST', `/api/asks/${a.id}/research`);
  const notes = (await json(owner, 'GET', `/api/research/${x.id}`)).items;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].place, 'Спросили: Ольга');
  assert.equal(notes[0].body, 'Вопрос: Где похоронена — что вы об этом знаете?\nОтвет: На кладбище в Горках, у церкви.');
  assert.equal(notes[0].id, res.note_id);
  assert.equal((await call(owner, 'POST', `/api/asks/${a.id}/research`)).statusCode, 409);
  const op = await lastOp();
  assert.deepEqual(op.entries.map((e) => e.entity), ['research_note']);
  await json(owner, 'POST', `/api/changes/${op.id}/revert`);
  assert.equal((await json(owner, 'GET', `/api/research/${x.id}`)).items.length, 0);
  assert.equal((await json(owner, 'GET', `/api/asks/${a.id}`)).note, false);
  // Вопрос не из исследования — некуда записывать.
  const b = await ask(owner, { question: 'Кем работала?', to_user: olga });
  await json(relative, 'POST', `/api/asks/${b.id}/answer`, { answer: 'Учительницей.' });
  assert.equal((await call(owner, 'POST', `/api/asks/${b.id}/research`)).statusCode, 400);
});

test('гость не получает вопросов и ответов ни в каком ответе API', async () => {
  const a = await ask(owner, { question: 'Секретный вопрос гостю не виден?', to_user: olga });
  await json(relative, 'POST', `/api/asks/${a.id}/answer`, { answer: 'Секретный ответ' });
  const dead = await json(owner, 'POST', '/api/persons', { person: { given: 'Пётр', sex: 'M', living: false } });
  const b = await ask(owner, { person_id: dead.id, question: 'Секретный вопрос об ушедшем', to_user: olga });
  for (const url of ['/api/asks', '/api/asks/mine', '/api/asks/people', `/api/asks/${a.id}`, `/api/persons/${klava}/asks`, `/api/persons/${dead.id}/asks`,
    `/api/asks/${b.id}`]) {
    assert.equal((await call(guest, 'GET', url)).statusCode, 403, url);
  }
  for (const url of ['/api/feed', '/api/tree', `/api/persons/${dead.id}/comments`, '/api/changes', `/api/persons/${dead.id}/history`]) {
    const r = await call(guest, 'GET', url);
    assert.ok(!r.body.includes('Секретный'), url);
  }
  const feed = await json(guest, 'GET', '/api/feed');
  assert.deepEqual(feed.asked, []);
  assert.ok(!feed.items.some((x) => x.kind === 'answer'));
  assert.equal((await json(guest, 'GET', '/api/tree')).asks_waiting, undefined);
  assert.equal((await call(guest, 'POST', `/api/asks/${b.id}/answer`, { answer: 'x' })).statusCode, 403);
});

test('удаление вопроса — мягкое: пропадает из списков, ссылка не работает, в базе остаётся', async () => {
  const a = await ask(owner, { question: 'Удалить меня', to_name: 'Сосед' });
  const b = await ask(owner, { question: 'И меня', to_user: olga });
  await json(owner, 'DELETE', `/api/asks/${a.id}`);
  await json(owner, 'DELETE', `/api/asks/${b.id}`);
  assert.equal((await call(owner, 'DELETE', `/api/asks/${a.id}`)).statusCode, 404);
  assert.ok(!(await json(owner, 'GET', '/api/asks')).some((x) => [a.id, b.id].includes(x.id)));
  assert.ok(!(await json(relative, 'GET', '/api/asks/mine')).some((x) => x.id === b.id));
  assert.ok(!(await json(relative, 'GET', `/api/persons/${klava}/asks`)).some((x) => x.id === b.id));
  assert.equal((await pub(a.token, 'GET', '/api/ask')).statusCode, 404);
  assert.equal((await call(relative, 'POST', `/api/asks/${b.id}/answer`, { answer: 'x' })).statusCode, 404);
  const rows = await q('select id, deleted_at from asks where id = any($1)', [[a.id, b.id]]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.deleted_at));
});

test('перебор ссылок: после 20 неверных с одного адреса — подождать', async () => {
  const a = await ask(owner, { question: 'Проверка', to_name: 'Проверка' });
  let r;
  for (let i = 0; i < 25; i++) r = await pub(`neverny-token-${i}-xxxxxxxxxxxxxxxx`, 'GET', '/api/ask');
  assert.equal(r.statusCode, 429);
  assert.equal((await pub(a.token, 'GET', '/api/ask')).statusCode, 429);
});
