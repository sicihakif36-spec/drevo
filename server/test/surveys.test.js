// Анкета для родственника: ссылка без входа, черновик, отправка, загрузка в дерево одним действием и её откат.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { signIn } from './helpers.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { cleanAnswers, suggest, matchScore, findMatches } from '../../shared/survey.js';

const H = { 'x-drevo': '1' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64');
let app;
let sent = [];
let owner;
let editor;
let relative;
let guest;

async function login(role, name) {
  return signIn(app, role, { name });
}
const call = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });
const json = async (...args) => {
  const r = await call(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
// Публичные маршруты: без входа, токен — в заголовке.
const pub = (token, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, 'x-survey': token } });
const pubJson = async (...args) => {
  const r = await pub(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
function photo(token, { type = 'image/png', data = PNG, caption = '' } = {}) {
  const b = 'drevo-survey';
  const file = (k, fname, t, d) => [Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"; filename="${fname}"\r\nContent-Type: ${t}\r\n\r\n`), d, Buffer.from('\r\n')];
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
    ...file('file', 'foto.png', type, data),
    ...file('thumb', 'thumb.jpg', 'image/jpeg', JPEG),
    Buffer.from(`--${b}--\r\n`),
  ]);
  return app.inject({ method: 'POST', url: '/api/survey/photos', payload, headers: { ...H, 'x-survey': token, 'content-type': `multipart/form-data; boundary=${b}` } });
}
const tree = () => json(owner, 'GET', '/api/tree');
const create = (body) => json(editor, 'POST', '/api/surveys', body);
const status = async (id) => (await json(owner, 'GET', `/api/surveys/${id}`)).status;

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async (sub, payload) => { sent.push({ to: sub.endpoint.split('/').at(-1), msg: JSON.parse(payload) }); } } });
  owner = await login('owner', 'Анна');
  editor = await login('editor', 'Сергей');
  relative = await login('relative', 'Родня');
  guest = await login('viewer', 'Гость');
  for (const [c, n] of [[owner, 'owner'], [editor, 'editor'], [relative, 'relative'], [guest, 'guest']]) {
    await json(c, 'PUT', '/api/push/subscription', { endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: 'BKey', auth: 'auth' } });
  }
});
after(async () => { await app.close(); await pool.end(); });

test('ссылка: 30 дней, отзыв, чужие и неверные токены; ничего из дерева', async () => {
  const ivan = await json(owner, 'POST', '/api/persons', { person: { given: 'Иван', surname: 'Смирнов', living: true, birth_date: '12.05.1950', notes: 'тайна' } });
  const s = await create({ name: 'Тётя Валя', person_id: ivan.id });
  assert.match(s.url, /\/#\/survey\/[\w-]{40,}$/);
  const row = (await q('select * from surveys where id = $1', [s.id]))[0];
  assert.notEqual(row.token_hash, s.token);
  assert.ok(Math.abs(row.expires_at - Date.now() - 30 * 86400000) < 60000);
  assert.equal(await status(s.id), 'sent');

  const got = await pubJson(s.token, 'GET', '/api/survey');
  assert.equal(got.name, undefined);
  assert.equal(got.from, 'Сергей');
  assert.equal(got.submitted, false);
  // Ни имени, ни дат человека из дерева, даже если анкета к нему привязана.
  const body = JSON.stringify(got);
  for (const x of ['Иван', 'Смирнов', '1950', 'тайна', ivan.id]) assert.ok(!body.includes(x), x);
  assert.equal(got.answers.people.self.given, '');

  // Без токена, с неверным, отозванный, истёкший.
  assert.equal((await app.inject({ method: 'GET', url: '/api/survey' })).statusCode, 404);
  assert.equal((await pub('x'.repeat(43), 'GET', '/api/survey')).statusCode, 404);
  const other = await create({ name: 'Дядя Коля' });
  await json(editor, 'DELETE', `/api/surveys/${other.id}`);
  assert.equal((await pub(other.token, 'GET', '/api/survey')).statusCode, 410);
  assert.equal((await pub(other.token, 'PUT', '/api/survey', { answers: {} })).statusCode, 410);
  assert.equal(await status(other.id), 'revoked');
  const old = await create({ name: 'Бабушка' });
  await q("update surveys set expires_at = now() - interval '1 minute' where id = $1", [old.id]);
  assert.equal((await pub(old.token, 'GET', '/api/survey')).statusCode, 410);
  assert.equal(await status(old.id), 'expired');
  // Новая ссылка взамен потерянной: старая больше не работает.
  const again = await json(editor, 'POST', `/api/surveys/${old.id}/link`);
  assert.equal((await pub(old.token, 'GET', '/api/survey')).statusCode, 404);
  assert.equal((await pubJson(again.token, 'GET', '/api/survey')).from, 'Сергей');

  // Родственник и гость анкет не видят и не создают: в ответах данные живых.
  for (const c of [relative, guest]) {
    for (const [m, u] of [['GET', '/api/surveys'], ['GET', `/api/surveys/${s.id}`], ['POST', '/api/surveys'], ['POST', `/api/surveys/${s.id}/load`]]) {
      assert.equal((await call(c, m, u, { name: 'x' })).statusCode, 403, `${m} ${u}`);
    }
  }
  // Вход в дерево анкета не даёт.
  assert.equal((await pub(s.token, 'GET', '/api/tree')).statusCode, 401);
  assert.equal((await pub(s.token, 'GET', '/api/feed')).statusCode, 401);
});

test('черновик сохраняется и возвращается; лишнее отбрасывается; размеры ограничены', async () => {
  const s = await create({ name: 'Валентина' });
  const answers = {
    step: 3,
    people: {
      self: { id: 'me', given: 'Валентина', patronymic: 'Ивановна', sex: 'F', living: true, hack: 'x', person_id: 'y', birth_place: 'д. Горки, '.repeat(100) },
      child: [{ id: 'k1', given: 'Ольга', sex: 'F' }, { id: 'k1', given: 'Андрей' }],
      father: { id: 'fa', given: 'Иван', sex: 'F' },
    },
    story: 'Жили в Горках',
    extra: 'нет',
  };
  await pubJson(s.token, 'PUT', '/api/survey', { answers });
  assert.equal(await status(s.id), 'filling');
  // Пока не отправлена, ответов в приложении не видно.
  assert.equal((await json(owner, 'GET', `/api/surveys/${s.id}`)).answers, null);
  const back = (await pubJson(s.token, 'GET', '/api/survey')).answers;
  assert.equal(back.step, 3);
  assert.equal(back.story, 'Жили в Горках');
  assert.equal(back.extra, undefined);
  assert.equal(back.people.self.hack, undefined);
  assert.equal(back.people.self.person_id, undefined);
  assert.equal(back.people.self.birth_place.length, 300);
  assert.equal(back.people.father.sex, 'F');
  assert.equal(back.people.mother.sex, 'F');
  assert.equal(back.people.child.length, 2);
  assert.notEqual(back.people.child[0].id, back.people.child[1].id);

  // Слишком много — 413, черновик не тронут.
  const big = { people: { child: Array.from({ length: 60 }, () => ({ given: 'Я'.repeat(300), notes: 'Я'.repeat(2000) })) } };
  assert.equal((await pub(s.token, 'PUT', '/api/survey', { answers: big })).statusCode, 413);
  assert.equal((await pub(s.token, 'PUT', '/api/survey', { answers: { story: 'Я'.repeat(200000) } })).statusCode, 413);
  assert.equal((await pubJson(s.token, 'GET', '/api/survey')).answers.story, 'Жили в Горках');
});

test('фото: только снимки, не больше 12, своя анкета — свои фото', async () => {
  const s = await create({ name: 'Фото' });
  const other = await create({ name: 'Другая' });
  const f = await (async () => { const r = await photo(s.token, { caption: 'Свадьба 1975' }); assert.equal(r.statusCode, 200, r.body); return r.json(); })();
  assert.equal(f.caption, 'Свадьба 1975');
  assert.equal((await photo(s.token, { type: 'application/pdf', data: Buffer.from('%PDF') })).statusCode, 400);
  const img = await pub(s.token, 'GET', `/api/survey/photos/${f.id}`);
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/jpeg');
  // По чужому токену фото не отдаётся и не удаляется.
  assert.equal((await pub(other.token, 'GET', `/api/survey/photos/${f.id}`)).statusCode, 404);
  assert.equal((await pub(other.token, 'DELETE', `/api/survey/photos/${f.id}`)).statusCode, 404);
  assert.equal((await pubJson(s.token, 'PATCH', `/api/survey/photos/${f.id}`, { caption: 'Свадьба' })).caption, 'Свадьба');
  for (let i = 1; i < 12; i++) assert.equal((await photo(s.token)).statusCode, 200);
  const r = await photo(s.token);
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /не больше 12/);
  assert.equal((await pubJson(s.token, 'GET', '/api/survey')).photos.length, 12);
  await pubJson(s.token, 'DELETE', `/api/survey/photos/${f.id}`);
  assert.equal((await pubJson(s.token, 'GET', '/api/survey')).photos.length, 11);
});

test('отправка: только чтение, лента, уведомление создавшему и владельцу', async () => {
  const s = await create({ name: 'Валентина' });
  const f = (await photo(s.token)).json();
  sent = [];
  const answers = { people: { self: { id: 'me', given: 'Валентина', sex: 'F' } }, story: 'Помню' };
  await pubJson(s.token, 'POST', '/api/survey/submit', { answers });
  await app.push.settled();
  assert.deepEqual(sent.map((x) => x.to).sort(), ['editor', 'owner']);
  assert.equal(sent[0].msg.title, 'Валентина заполнила анкету');
  assert.equal(sent[0].msg.url, `/#/surveys/${s.id}`);

  // После отправки — только чтение, повторная отправка ничего не шлёт.
  const got = await pubJson(s.token, 'GET', '/api/survey');
  assert.equal(got.submitted, true);
  assert.equal(got.answers.story, 'Помню');
  for (const [m, u, b] of [['PUT', '/api/survey', { answers }], ['POST', '/api/survey/submit', { answers }], ['DELETE', `/api/survey/photos/${f.id}`],
    ['PATCH', `/api/survey/photos/${f.id}`, { caption: 'x' }]]) {
    assert.equal((await pub(s.token, m, u, b)).statusCode, 409, `${m} ${u}`);
  }
  assert.equal((await photo(s.token)).statusCode, 409);
  assert.equal((await call(editor, 'POST', `/api/surveys/${s.id}/link`)).statusCode, 409);
  await app.push.settled();
  assert.equal(sent.length, 2);

  assert.equal(await status(s.id), 'submitted');
  const full = await json(owner, 'GET', `/api/surveys/${s.id}`);
  assert.equal(full.answers.people.self.given, 'Валентина');
  assert.equal(full.files.length, 1);
  assert.equal((await call(owner, 'GET', `/api/surveys/${s.id}/photos/${full.files[0].id}`)).statusCode, 200);

  // Лента: владельцу и участнику — «заполнила анкету» и точка «есть новое»; родственнику и гостю — нет.
  const item = (await json(owner, 'GET', '/api/feed')).items.find((i) => i.kind === 'survey' && i.id === s.id);
  assert.equal(item.name, 'Валентина');
  assert.equal(item.sex, 'F');
  assert.equal(item.fresh, true);
  assert.ok((await tree()).feed_new >= 1);
  for (const c of [relative, guest]) assert.ok(!(await json(c, 'GET', '/api/feed')).items.some((i) => i.kind === 'survey'));
  assert.ok((await json(owner, 'GET', '/api/surveys')).some((x) => x.id === s.id && x.status === 'submitted' && x.photos === 1));
});

test('загрузка в дерево — одно действие: люди, связи, дописанные поля, рассказ, фото; откат целиком', async () => {
  // В дереве: Иван и Мария Смирновы, их сын Сергей.
  const ivan = await json(owner, 'POST', '/api/persons', { person: { given: 'Иван', patronymic: 'Петрович', surname: 'Смирнов', sex: 'M', birth_date: '1930', occupation: 'кузнец' } });
  const maria = await json(owner, 'POST', '/api/persons', { person: { given: 'Мария', surname: 'Смирнова', sex: 'F' }, relation: { to: ivan.id, type: 'spouse' } });
  const sergey = await json(owner, 'POST', '/api/persons', { person: { given: 'Сергей', surname: 'Смирнов', sex: 'M', birth_date: '1958' }, relation: { to: ivan.id, type: 'child' } });
  const before = await tree();
  const lastOp = async () => (await json(owner, 'GET', '/api/changes'))[0].id;
  const was = await lastOp();

  const s = await create({ name: 'Валентина' });
  const answers = {
    people: {
      self: { id: 'me', given: 'Валентина', patronymic: 'Ивановна', surname: 'Кузнецова', birth_surname: 'Смирнова', sex: 'F', birth_date: '1955' },
      spouse: [{ id: 'sp', given: 'Николай', surname: 'Кузнецов', sex: 'M' }],
      child: [{ id: 'c1', given: 'Ольга', sex: 'F' }, { id: 'c2', given: 'Андрей', sex: 'M' }, { id: 'c3', given: '' }],
      father: { id: 'fa', given: 'Иван', patronymic: 'Петрович', surname: 'Смирнов', birth_date: 'около 1930', birth_place: 'д. Горки', death_date: '2001', occupation: 'плотник', living: false },
      mother: { id: 'mo', given: 'Мария', birth_surname: 'Орлова' },
      ff: { id: 'ff', given: 'Пётр', surname: 'Смирнов' },
      fm: { id: 'fm', given: '' },
      sibling: [{ id: 'sb', given: 'Сергей', surname: 'Смирнов', sex: 'M' }],
    },
    story: 'Жили в Горках, отец был кузнецом.',
  };
  assert.equal((await photo(s.token, { caption: 'Мы с отцом' })).statusCode, 200);
  await pubJson(s.token, 'POST', '/api/survey/submit', { answers });

  // Нельзя: пропустить того, кто заполнял; выбрать одного человека дважды; загрузить незаполненную.
  const plan = {
    people: {
      fa: { action: 'match', person_id: ivan.id, replace: ['birth_date'] },
      mo: { action: 'match', person_id: maria.id },
      sb: { action: 'match', person_id: sergey.id },
      c2: { action: 'new', fix: { given: 'Андрей', birth_date: '1980' } },
    },
  };
  assert.equal((await call(owner, 'POST', `/api/surveys/${s.id}/load`, { people: { ...plan.people, me: { action: 'skip' } } })).statusCode, 400);
  assert.equal((await call(owner, 'POST', `/api/surveys/${s.id}/load`, { people: { ...plan.people, ff: { action: 'match', person_id: ivan.id } } })).statusCode, 400);
  const draft = await create({ name: 'Ещё пишет' });
  assert.equal((await call(owner, 'POST', `/api/surveys/${draft.id}/load`, plan)).statusCode, 409);
  assert.equal(await lastOp(), was); // неудачные попытки ничего не записали

  const res = await json(editor, 'POST', `/api/surveys/${s.id}/load`, plan);
  assert.deepEqual(res.notes, []);
  const t = await tree();
  const by = (id) => t.persons.find((p) => p.id === id);
  const id = res.ids;
  assert.equal(t.persons.length, before.persons.length + 5); // Валентина, Николай, Ольга, Андрей, Пётр
  assert.ok(!id.c3 && !id.fm);

  // Совпадение: пустые поля дописаны, непустые не тронуты, кроме явно выбранного; «умер» — дописано.
  const iv = by(ivan.id);
  assert.equal(iv.occupation, 'кузнец');
  assert.equal(iv.birth_place, 'д. Горки');
  assert.equal(iv.death_date, '2001');
  assert.equal(iv.living, false);
  assert.equal(iv.birth_date, 'около 1930');
  assert.equal(by(maria.id).birth_surname, 'Орлова');
  assert.equal(by(id.c2).birth_date, '1980');
  assert.equal(by(id.me).birth_surname, 'Смирнова');

  // Связи: Валентина — дочь Ивана и Марии, сестра Сергея; Пётр — отец Ивана; Николай — муж, дети в их семье.
  const famOf = (child) => t.families.filter((f) => t.children.some((c) => c.family_id === f.id && c.child_id === child));
  const [pf] = famOf(id.me);
  assert.deepEqual([pf.partner1, pf.partner2].sort(), [ivan.id, maria.id].sort());
  assert.equal(famOf(sergey.id)[0].id, pf.id);
  assert.equal(famOf(ivan.id)[0].partner1, id.ff);
  const [cf] = famOf(id.c1);
  assert.deepEqual([cf.partner1, cf.partner2].sort(), [id.me, id.sp].sort());
  assert.equal(famOf(id.c2)[0].id, cf.id);

  // Рассказ — история у Валентины, фото — в её альбоме.
  const stories = await json(owner, 'GET', `/api/persons/${id.me}/stories`);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].title, 'Воспоминания: Валентина Ивановна');
  assert.equal(stories[0].body, 'Жили в Горках, отец был кузнецом.');
  const album = await json(owner, 'GET', `/api/persons/${id.me}/media`);
  assert.deepEqual(album.map((m) => m.caption), ['Мы с отцом']);
  assert.equal((await call(owner, 'GET', `/api/media/${album[0].id}`)).statusCode, 200);

  // Одно действие в журнале; анкета — «загружена» со ссылкой на него; второй раз не загрузить.
  const [op] = await json(owner, 'GET', '/api/changes');
  assert.equal(op.id, res.change);
  assert.ok(op.entries.some((e) => e.entity === 'story') && op.entries.some((e) => e.entity === 'media') && op.entries.some((e) => e.entity === 'family'));
  const full = await json(owner, 'GET', `/api/surveys/${s.id}`);
  assert.equal(full.status, 'loaded');
  assert.equal(full.load.id, op.id);
  assert.equal(full.loaded_by_name, 'Сергей');
  assert.equal((await call(owner, 'POST', `/api/surveys/${s.id}/load`, plan)).statusCode, 409);
  assert.equal((await call(owner, 'DELETE', `/api/surveys/${s.id}`)).statusCode, 409);

  // Откат целиком: дерево как было, история и фото убраны, анкету можно загрузить снова.
  await json(owner, 'POST', `/api/changes/${op.id}/revert`);
  const back = await tree();
  const strip = (x) => ({ persons: x.persons.map((p) => [p.id, p.living, p.birth_date, p.birth_place, p.death_date, p.birth_surname]).sort(),
    families: x.families.map((f) => [f.id, f.partner1, f.partner2]).sort(), children: x.children.map((c) => [c.family_id, c.child_id]).sort() });
  assert.deepEqual(strip(back), strip(before));
  assert.equal((await call(owner, 'GET', `/api/persons/${id.me}/stories`)).json().length ?? 0, 0);
  assert.equal(await status(s.id), 'submitted');
  const res2 = await json(owner, 'POST', `/api/surveys/${s.id}/load`, plan);
  assert.equal(await status(s.id), 'loaded');
  assert.equal((await tree()).persons.length, before.persons.length + 5);
  assert.notEqual(res2.change, res.change);
});

test('связи, противоречащие дереву, не делаются — остаётся заметка', async () => {
  const kid = await json(owner, 'POST', '/api/persons', { person: { given: 'Пётр', surname: 'Орлов', sex: 'M' } });
  await json(owner, 'POST', '/api/persons', { person: { given: 'Алексей', sex: 'M' }, relation: { to: kid.id, type: 'father' } });
  await json(owner, 'POST', '/api/persons', { person: { given: 'Анна', sex: 'F' }, relation: { to: kid.id, type: 'mother' } });
  const s = await create({ name: 'Пётр', person_id: kid.id });
  await pubJson(s.token, 'POST', '/api/survey/submit', { answers: { people: { self: { id: 'me', given: 'Пётр' }, father: { id: 'fa', given: 'Борис' } } } });
  const res = await json(owner, 'POST', `/api/surveys/${s.id}/load`, { people: { me: { action: 'match', person_id: kid.id } } });
  assert.equal(res.notes.length, 1);
  assert.match(res.notes[0], /^Орлов Пётр — в дереве уже указаны другие родители; Борис не связан\(а\) как родитель$/);
  assert.ok((await tree()).persons.some((p) => p.id === res.ids.fa));
});

test('подсказки отчества и фамилии по родству, поиск совпадений', () => {
  const a = cleanAnswers({ people: {
    self: { given: 'Валентина', sex: 'F' }, father: { given: 'Иван', surname: 'Смирнов' }, mf: { given: 'Пётр', surname: 'Орлов' },
    spouse: [{ id: 'n', given: 'Николай', sex: 'M', surname: 'Кузнецов' }], child: [{ given: 'Ольга', sex: 'F', parent2: 'n' }],
  } });
  assert.deepEqual(suggest(a, 'self', a.people.self), { surname: '', patronymic: 'Ивановна', birth_surname: 'Смирнова' });
  assert.deepEqual(suggest(a, 'mother', { sex: 'F' }), { surname: 'Смирнова', patronymic: 'Петровна', birth_surname: 'Орлова' });
  assert.deepEqual(suggest(a, 'child', a.people.child[0]), { surname: 'Кузнецова', patronymic: 'Николаевна', birth_surname: '' });
  assert.equal(suggest(a, 'ff', { sex: 'M' }).surname, 'Смирнов');

  const ivan = { id: '1', given: 'Иван', patronymic: 'Петрович', surname: 'Смирнов', birth_date: '1930' };
  assert.equal(matchScore({ given: 'иван', surname: 'Смирнов', birth_date: 'около 1931' }, ivan), 5);
  assert.equal(matchScore({ given: 'Иван', patronymic: 'Сергеевич' }, ivan), 0);
  assert.equal(matchScore({ given: 'Иван', birth_date: '1950' }, ivan), 0);
  assert.deepEqual(findMatches({ given: 'Иван' }, [ivan]), []);
  assert.deepEqual(findMatches({ given: 'Иван' }, [ivan], new Set(['1'])), [ivan]);
});

test('перебор токенов: после 20 неверных ссылок с одного адреса — подождать', async () => {
  const s = await create({ name: 'Проверка' });
  let r;
  for (let i = 0; i < 25; i++) r = await pub(`neverny-token-${i}-xxxxxxxxxxxxxxxx`, 'GET', '/api/survey');
  assert.equal(r.statusCode, 429);
  // Даже верная ссылка с этого адреса теперь ждёт.
  assert.equal((await pub(s.token, 'GET', '/api/survey')).statusCode, 429);
});
