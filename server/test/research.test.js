// Исследование: права, вопросы и записи поиска с откатом, запрос помощнику, вырезание GEDCOM из ответа,
// загрузка ответа участником через обычный предпросмотр и запись о ней в журнале вопроса.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { signIn } from './helpers.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { buildIndex, fullName } from '../../shared/names.js';
import { buildPrompt, extractGedcom, PROMPT, FAITH_UNKNOWN } from '../../shared/research.js';

const H = { 'x-drevo': '1' };
const MIN = 60000;
let app;
let now = null;
let sent = [];
let owner;
let editor;
let relative;
let guest;
let pyotr;
let ivan;

async function login(role, name) {
  return signIn(app, role, { name });
}
const call = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });
const json = async (...args) => {
  const r = await call(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const revert = (cookie, id) => json(cookie, 'POST', `/api/changes/${id}/revert`);
const lastChange = async () => (await q('select max(id) as id from changes'))[0].id;

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { send: async (sub, payload) => sent.push(JSON.parse(payload)), clock: () => now || new Date(), timer: false } });
  owner = await login('owner', 'Анна');
  editor = await login('editor', 'Сергей');
  relative = await login('relative', 'Родня');
  guest = await login('viewer', 'Гость');
  ivan = await json(owner, 'POST', '/api/persons', { person: { sex: 'M', surname: 'Смирнов', given: 'Иван', patronymic: 'Фёдорович', living: false, birth_date: '1868', death_date: '1931' } });
  pyotr = await json(owner, 'POST', '/api/persons', {
    person: { sex: 'M', surname: 'Смирнов', given: 'Пётр', patronymic: 'Иванович', living: false, birth_date: '1895', death_date: '1943' },
    relation: { type: 'child', to: ivan.id },
  });
});
after(async () => { await app.close(); await pool.end(); });

test('права: владелец и участник — да; родственник, гость, без входа — нет', async () => {
  const x = await json(editor, 'POST', `/api/persons/${pyotr.id}/research`, { title: 'Где погиб Пётр в 1943' });
  const n = await json(editor, 'POST', `/api/research/${x.id}/notes`, { place: 'ОБД «Мемориал»', body: 'Нет записей' });
  assert.equal((await json(owner, 'GET', '/api/research')).length, 1);
  const routes = [
    ['GET', '/api/research'], ['GET', `/api/persons/${pyotr.id}/research`], ['GET', `/api/research/${x.id}`],
    ['POST', `/api/persons/${pyotr.id}/research`, { title: 'x' }], ['PATCH', `/api/research/${x.id}`, { status: 'found' }],
    ['DELETE', `/api/research/${x.id}`], ['POST', `/api/research/${x.id}/notes`, { body: 'x' }],
    ['PATCH', `/api/research/notes/${n.id}`, { body: 'x' }], ['DELETE', `/api/research/notes/${n.id}`],
    ['POST', `/api/research/${x.id}/import`, { text: '0 HEAD\n0 @I1@ INDI\n1 NAME А /Б/\n0 TRLR' }],
  ];
  for (const [method, url, payload] of routes) {
    for (const c of [relative, guest]) assert.equal((await call(c, method, url, payload)).statusCode, 403, `${method} ${url}`);
    assert.equal((await app.inject({ method, url, payload, headers: H })).statusCode, 401, `${method} ${url}`);
  }
  // Данные журнала поиска родственнику и гостю не отдаются ни в каком ответе.
  for (const c of [relative, guest]) {
    for (const url of ['/api/feed', '/api/changes', `/api/persons/${pyotr.id}/history`, '/api/tree', '/api/export.ged']) {
      const r = await call(c, 'GET', url);
      if (r.statusCode !== 200) continue;
      assert.ok(!r.body.includes('погиб Пётр') && !r.body.includes('Мемориал') && !r.body.includes('research'), `${url}: ${r.body.slice(0, 300)}`);
    }
  }
  // В ленту исследование не идёт никому, в «Последних правках» участника — есть.
  const feed = await json(owner, 'GET', '/api/feed');
  assert.ok(!JSON.stringify(feed).includes('research'));
  const changes = await json(owner, 'GET', '/api/changes');
  assert.ok(changes.some((op) => op.entries.some((e) => e.entity === 'research')));
  // Новое в ленте у владельца после правок участника — не считается.
  assert.equal((await json(owner, 'GET', '/api/tree')).feed_new, 0, 'вопрос и запись участника — не новость');
});

test('уведомления о правках: записи исследования не рассылаются', async () => {
  for (const [c, name] of [[owner, 'owner'], [relative, 'relative'], [guest, 'guest']]) {
    await json(c, 'PUT', '/api/push/subscription', { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: 'BKey', auth: 'auth' } });
  }
  sent = [];
  now = new Date(Date.now() + 15 * MIN);
  await app.push.tick();
  await app.push.settled();
  assert.ok(!sent.some((m) => /правк/i.test(m.title) && /Сергей/.test(m.body)), JSON.stringify(sent));
  now = null;
});

test('вопросы и записи: создание, правка, статус, удаление и возврат через откат', async () => {
  const x = await json(editor, 'POST', `/api/persons/${ivan.id}/research`, { title: 'Родители Ивана Фёдоровича' });
  assert.equal(x.status, 'open');
  assert.equal(x.user_name, 'Сергей');
  assert.equal((await call(editor, 'POST', `/api/persons/${ivan.id}/research`, { title: '  ' })).statusCode, 400);
  assert.equal((await call(editor, 'PATCH', `/api/research/${x.id}`, { status: 'maybe' })).statusCode, 400);
  assert.equal((await call(editor, 'POST', `/api/research/${x.id}/notes`, { result: 'found' })).statusCode, 400);

  const n = await json(owner, 'POST', `/api/research/${x.id}/notes`, { place: 'ГА Тверской области', ref: 'ф. 160, оп. 12, д. 45', url: 'https://example.ru/1', body: 'Нашли запись о рождении', result: 'found' });
  assert.equal(n.user_name, 'Анна');
  const st = await json(editor, 'PATCH', `/api/research/${x.id}`, { status: 'found' });
  assert.equal(st.status, 'found');
  await json(editor, 'PATCH', `/api/research/notes/${n.id}`, { body: 'Нашли запись о рождении, л. 12 об.' });
  let got = await json(editor, 'GET', `/api/research/${x.id}`);
  assert.equal(got.items.length, 1);
  assert.equal(got.items[0].body, 'Нашли запись о рождении, л. 12 об.');
  assert.equal(got.items[0].ref, 'ф. 160, оп. 12, д. 45');

  // Откат правки записи и статуса.
  await revert(editor, await lastChange());
  got = await json(editor, 'GET', `/api/research/${x.id}`);
  assert.equal(got.items[0].body, 'Нашли запись о рождении');
  const statusChange = (await q("select id from changes where entity = 'research' and action = 'update' order by id desc limit 1"))[0].id;
  await revert(owner, statusChange);
  assert.equal((await json(editor, 'GET', `/api/research/${x.id}`)).status, 'open');

  // Удаление записи и возврат.
  const del = await json(editor, 'DELETE', `/api/research/notes/${n.id}`);
  assert.equal((await json(editor, 'GET', `/api/research/${x.id}`)).items.length, 0);
  await revert(editor, del.changeId);
  assert.equal((await json(editor, 'GET', `/api/research/${x.id}`)).items.length, 1);

  // Удаление вопроса — вместе с записями не видно; возврат возвращает и их.
  const delQ = await json(editor, 'DELETE', `/api/research/${x.id}`);
  assert.equal((await call(editor, 'GET', `/api/research/${x.id}`)).statusCode, 404);
  assert.ok(!(await json(editor, 'GET', '/api/research')).some((r) => r.id === x.id));
  const ops = await json(editor, 'GET', '/api/changes');
  const op = ops.find((o) => o.id === delQ.changeId);
  assert.equal(op.entries[0].before.title, 'Родители Ивана Фёдоровича');
  await revert(editor, delQ.changeId);
  got = await json(editor, 'GET', `/api/research/${x.id}`);
  assert.equal(got.items.length, 1);
  assert.equal((await json(editor, 'GET', `/api/persons/${ivan.id}/research`)).length, 1);
  // Отмена отмены: снова удалён.
  const undo = (await q("select id from changes where entity = 'research' and action = 'restore' order by id desc limit 1"))[0].id;
  await revert(editor, undo);
  assert.equal((await call(editor, 'GET', `/api/research/${x.id}`)).statusCode, 404);
  await revert(editor, (await q("select id from changes where entity = 'research' and action = 'delete' order by id desc limit 1"))[0].id);

  // Удалённый человек — его вопросы не видны.
  const tmp = await json(owner, 'POST', '/api/persons', { person: { given: 'Временный', living: false } });
  await json(editor, 'POST', `/api/persons/${tmp.id}/research`, { title: 'Кто это' });
  await json(owner, 'DELETE', `/api/persons/${tmp.id}`);
  assert.ok(!(await json(editor, 'GET', '/api/research')).some((r) => r.person_id === tmp.id));
  // Сначала «ищем».
  const list = await json(editor, 'GET', '/api/research');
  assert.deepEqual([...list].sort((a, b) => (b.status === 'open') - (a.status === 'open')).map((r) => r.status), list.map((r) => r.status));
});

test('запрос помощнику: подстановки, живые без дат по умолчанию и с датами по галочке', () => {
  const persons = [
    { id: 'g', sex: 'M', surname: 'Смирнов', given: 'Фёдор', patronymic: '', living: false, birth_date: '', death_date: '', birth_place: '' },
    { id: 'i', sex: 'M', surname: 'Смирнов', given: 'Иван', patronymic: 'Фёдорович', living: false, birth_date: 'около 1868', death_date: '1931', birth_place: 'д. Горки', death_place: 'д. Горки', occupation: 'крестьянин', burial_place: 'с. Покров' },
    { id: 'w', sex: 'F', surname: 'Смирнова', given: 'Мария', patronymic: 'Петровна', birth_surname: 'Кузнецова', living: false, birth_date: '1872', death_date: '1940' },
    { id: 'p', sex: 'M', surname: 'Смирнов', given: 'Пётр', patronymic: 'Иванович', living: false, birth_date: '1895', death_date: '1943', birth_place: 'д. Горки' },
    { id: 'a', sex: 'F', surname: 'Смирнова', given: 'Анна', patronymic: 'Ивановна', living: true, birth_date: '1950', birth_place: 'г. Тверь' },
    { id: 'o', sex: 'F', surname: 'Смирнова', given: 'Ольга', patronymic: 'Ивановна', living: true, birth_date: '1915', birth_place: 'д. Горки' },
  ];
  const families = [
    { id: 'f0', partner1: 'g', partner2: null, kind: 'marriage' },
    { id: 'f1', partner1: 'i', partner2: 'w', kind: 'marriage', start_date: '1890', place: 'с. Покров' },
  ];
  const children = [{ family_id: 'f0', child_id: 'i' }, ...['p', 'a', 'o'].map((c) => ({ family_id: 'f1', child_id: c }))];
  const idx = buildIndex({ persons, families, children });
  const events = [{ kind: 'war', date: '1914–1918', title: 'Первая мировая', unit: '', rank: 'рядовой', place: '' }];
  const text = buildPrompt({ person: idx.persons.get('i'), idx, events, goal: 'Родители Ивана Фёдоровича', now: (t) => (t === 'д. Горки' ? 'Тверская обл.' : ''), year: 2026 });
  assert.ok(text.startsWith('Ты — помощник-генеалог.'));
  assert.ok(text.includes('— Кого ищем: Смирнов Иван Фёдорович, ~1868 – 1931'));
  assert.ok(text.includes('Родился: около 1868, д. Горки (сейчас: Тверская обл.)'));
  assert.ok(text.includes('Умер: 1931, д. Горки'));
  assert.ok(text.includes('Похоронен: с. Покров'));
  assert.ok(text.includes('Род занятий: крестьянин'));
  assert.ok(text.includes('Из жизни:\n    1914–1918 — Война: Первая мировая, рядовой'));
  assert.ok(text.includes('Отец: Смирнов Фёдор'));
  assert.ok(text.includes('Жена: Смирнова Мария Петровна, 1872 – 1940; брак 1890, с. Покров'));
  assert.ok(text.includes('Сын: Смирнов Пётр Иванович, 1895 – 1943, род. д. Горки'));
  // Живая моложе 100 лет — только имя и кем приходится; старше 100 — с датами.
  assert.ok(text.includes('Дочь: Смирнова Анна Ивановна (жива)\n'));
  assert.ok(!text.includes('1950') && !text.includes('Тверь'));
  assert.ok(text.includes('Дочь: Смирнова Ольга Ивановна, р. 1915, род. д. Горки (жива)'));
  assert.ok(text.includes(`— Вероисповедание и национальность: ${FAITH_UNKNOWN}`));
  assert.ok(text.includes('— Что хочу узнать: Родители Ивана Фёдоровича'));
  assert.ok(!/\{(who|faith|kin|goal)\}/.test(text));
  // Хвост шаблона — как в docs/issledovanie.md.
  assert.ok(text.endsWith(PROMPT.slice(PROMPT.indexOf('КАК РАБОТАТЬ'))));

  const withDates = buildPrompt({ person: idx.persons.get('i'), idx, living: true, faith: 'православные, русские', year: 2026 });
  assert.ok(withDates.includes('Дочь: Смирнова Анна Ивановна, р. 1950, род. г. Тверь (жива)'));
  assert.ok(withDates.includes('— Вероисповедание и национальность: православные, русские'));

  // Сам человек живой: без дат, мест и событий, брак с ним — без даты.
  const self = buildPrompt({ person: idx.persons.get('a'), idx, events, year: 2026 });
  assert.ok(self.includes('— Кого ищем: Смирнова Анна Ивановна (жива)\n'));
  assert.ok(!self.includes('1950') && !self.includes('Из жизни'));
  assert.ok(self.includes('Отец: Смирнов Иван Фёдорович, ~1868 – 1931'));
  assert.ok(self.includes('Сестра: Смирнова Ольга Ивановна, р. 1915'));
});

const ANSWER = `Короткий отчёт.
Нашли: в метрической книге Покровской церкви за 1868 год — запись о рождении Ивана у Фёдора Смирнова и его жены Анастасии.
Не нашли: дату смерти Фёдора.
Дальше: посмотреть исповедные ведомости.

\`\`\`gedcom
0 HEAD
1 CHAR UTF-8
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
0 @I1@ INDI
1 NAME Иван Фёдорович /Смирнов/
1 SEX M
1 BIRT
2 DATE ABT 1868
0 @I2@ INDI
1 NAME Фёдор /Смирнов/
1 SEX M
1 BIRT
2 DATE ABT 1840
2 SOUR @S1@
3 PAGE запись № 45
3 QUAY 3
0 @I3@ INDI
1 NAME Анастасия /Смирнова/
1 SEX F
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
0 @S1@ SOUR
1 TITL Метрическая книга Покровской церкви, 1868
1 ABBR ГА ТО, ф. 160, оп. 12, д. 45, л. 12 об.
1 _TYPE Метрическая книга
0 TRLR
\`\`\`

Если найдёте исповедные ведомости — пришлите, продолжу.`;

test('вырезание GEDCOM из ответа помощника', () => {
  const a = extractGedcom(ANSWER);
  assert.ok(a.gedcom.startsWith('0 HEAD\n1 CHAR UTF-8'));
  assert.ok(a.gedcom.endsWith('0 TRLR\n'));
  assert.ok(!a.gedcom.includes('```') && !a.gedcom.includes('отчёт'));
  assert.ok(a.report.startsWith('Короткий отчёт.'));
  assert.ok(a.report.includes('Если найдёте исповедные ведомости'));
  assert.ok(!a.report.includes('```') && !a.report.includes('0 HEAD'));

  // Без блока кода, отчёт до и после.
  const b = extractGedcom('Вот что нашёл:\r\n0 HEAD\r\n1 CHAR UTF-8\r\n0 @I1@ INDI\r\n1 NAME Пётр /Сидоров/\r\n0 TRLR\r\nВсё.');
  assert.equal(b.gedcom, '0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Пётр /Сидоров/\n0 TRLR\n');
  assert.equal(b.report, 'Вот что нашёл:\nВсё.');

  // Без TRLR: до конца файла, отчёт после файла — не файл.
  const c = extractGedcom('0 HEAD\n0 @I1@ INDI\n1 NAME Пётр /Сидоров/\n\nДальше поищите в ОГАЧО.');
  assert.equal(c.gedcom, '0 HEAD\n0 @I1@ INDI\n1 NAME Пётр /Сидоров/\n0 TRLR\n');
  assert.equal(c.report, 'Дальше поищите в ОГАЧО.');
  // Блок кода без TRLR и без закрывающей черты.
  const d = extractGedcom('Отчёт\n```\n0 HEAD\n0 @I1@ INDI\n1 NAME Пётр /Сидоров/\n1 NOTE длинная заметка, которую\nпомощник перенёс');
  assert.ok(d.gedcom.includes('помощник перенёс') && d.gedcom.endsWith('0 TRLR\n'));
  assert.equal(d.report, 'Отчёт');

  assert.equal(extractGedcom('Ничего не нашёл, простите.'), null);
  assert.equal(extractGedcom(''), null);
});

test('загрузка ответа участником: предпросмотр, «это он», запись в журнале вопроса, отмена одним действием', async () => {
  const x = await json(editor, 'POST', `/api/persons/${ivan.id}/research`, { title: 'Родители Ивана' });
  const bad = await call(editor, 'POST', `/api/research/${x.id}/import`, { text: 'Простите, ничего не нашёл.' });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error, 'В ответе нет файла для загрузки — попросите помощника прислать результат в формате GEDCOM');
  const pv = await json(editor, 'POST', `/api/research/${x.id}/import`, { text: ANSWER });
  assert.equal(pv.counts.persons, 3);
  const i1 = pv.people.find((p) => p.ref === '@I1@');
  assert.deepEqual(i1.cands, [ivan.id], 'Иван Фёдорович найден в дереве');

  // Чужой файл недоступен даже владельцу; родственнику и гостю — ничего.
  for (const c of [relative, guest]) {
    assert.equal((await call(c, 'POST', `/api/import/${pv.id}/load`, {})).statusCode, 403);
    assert.equal((await call(c, 'DELETE', `/api/import/${pv.id}`)).statusCode, 403);
  }
  assert.equal((await call(owner, 'POST', `/api/import/${pv.id}/load`, {})).statusCode, 404, 'чужой файл');

  const before = (await json(owner, 'GET', '/api/tree')).persons.length;
  const res = await json(editor, 'POST', `/api/import/${pv.id}/load`, { people: { '@I1@': { action: 'match', person_id: ivan.id } } });
  assert.equal(res.persons, 2);
  assert.equal(res.matched, 1);
  assert.equal(res.question_id, x.id);
  const t = await json(owner, 'GET', '/api/tree');
  assert.equal(t.persons.length, before + 2);
  const idx = buildIndex(t);
  assert.ok(idx.parentFamilies.get(ivan.id)?.length, 'у Ивана появились родители');

  let got = await json(editor, 'GET', `/api/research/${x.id}`);
  assert.equal(got.items.length, 1);
  const note = got.items[0];
  assert.ok(note.body.startsWith('Загружено из ответа помощника: 2 новых человека, 1 дополнено.'));
  assert.ok(note.body.includes('Короткий отчёт.'));
  assert.equal(note.result, 'found');
  assert.equal(note.change, res.change);
  assert.equal(note.undone, false);
  // Действие видно по ссылке из журнала вопроса.
  const [op] = await json(editor, 'GET', `/api/changes?op=${note.op}`);
  assert.equal(op.id, res.change);
  assert.ok(op.entries.some((e) => e.entity === 'research_note'));
  // Родственнику то же действие — без записи исследования.
  const [rop] = await json(relative, 'GET', `/api/changes?op=${note.op}`);
  assert.ok(rop.entries.every((e) => e.entity !== 'research_note'));
  const feed = await json(guest, 'GET', '/api/feed');
  assert.ok(!JSON.stringify(feed).includes('Короткий отчёт') && !JSON.stringify(feed).includes('research'));

  // Отмена одной кнопкой: люди ушли, запись о загрузке тоже.
  await revert(editor, res.change);
  assert.equal((await json(owner, 'GET', '/api/tree')).persons.length, before);
  got = await json(editor, 'GET', `/api/research/${x.id}`);
  assert.equal(got.items.length, 0);
  // Возврат — всё на месте, запись снова видна.
  const undo = (await q("select min(id) as id from changes where id > $1 and entity = 'import'", [res.change]))[0].id;
  await revert(editor, undo);
  got = await json(editor, 'GET', `/api/research/${x.id}`);
  assert.equal(got.items.length, 1);
  assert.equal(fullName((await json(owner, 'GET', '/api/tree')).persons.find((p) => p.given === 'Анастасия')), 'Смирнова Анастасия');
});
