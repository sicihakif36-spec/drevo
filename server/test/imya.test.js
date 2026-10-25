// Второе написание имени (татарское в семейной схеме и русское в документах): подсказка русского написания, поиск по любому
// написанию (люди, загрузка из файла, проверка дублей), поля — правка, журнал, откат; «Написание имён» — сохранить всех одним
// действием и отменить; объединение дублей; GEDCOM туда и обратно (TYPE aka против TYPE birth); роспись; гость видит только имя.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { signIn } from './helpers.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { parseGedcom } from '../src/gedcom.js';
import { toGedcom } from '../src/routes/export.js';
import { loadTreeData } from '../src/routes/print.js';
import { matchIndex } from '../src/gedimport.js';
import {
  suggestRussian, russianPatronymic, russianLetters, isTatarName, altName, altLabel, personHas, textHas, buildIndex, fullName,
} from '../../shared/names.js';
import { matchScore } from '../../shared/survey.js';
import { checkTree, defaultChoice, mergedPerson } from '../../shared/checks.js';
import { buildRospis, parseRospisOptions, rospisText } from '../../shared/rospis.js';
import { buildPrompt } from '../../shared/research.js';

// ---------- Подсказка русского написания ----------

test('подсказка: татарские буквы по-русски', () => {
  assert.equal(russianLetters('Гыйльмия'), 'Гильмия');
  assert.equal(russianLetters('Рәшит'), 'Рашит');
  assert.equal(russianLetters('Фәридә'), 'Фарида');
  assert.equal(russianLetters('Гөлнара'), 'Гульнара');
  assert.equal(russianLetters('Өлфәт'), 'Ульфат');
  assert.equal(russianLetters('Һади'), 'Хади');
  assert.equal(russianLetters('Миңнулла'), 'Миннулла');
  assert.equal(russianLetters('Галимҗан'), 'Галимжан');
  assert.equal(russianLetters('Хәсәнова-Галиева'), 'Хасанова-Галиева');
  assert.equal(russianLetters('Габдулла'), 'Габдулла', 'без татарских букв — как было');
});

test('подсказка: татарское отчество по-русски, а где правило не подходит — пусто', () => {
  assert.equal(russianPatronymic('Хәсән улы', 'M'), 'Хасанович');
  assert.equal(russianPatronymic('Хәсән кызы', 'F'), 'Хасановна');
  assert.equal(russianPatronymic('Хәсән кызы'), 'Хасановна', 'пол — по «кызы»');
  assert.equal(russianPatronymic('Габдулла улы', 'M'), 'Габдуллович');
  assert.equal(russianPatronymic('Миңнулла кызы', 'F'), 'Миннулловна');
  assert.equal(russianPatronymic('Вәли улы', 'M'), 'Валиевич');
  assert.equal(russianPatronymic('Шәриф кызы', 'F'), 'Шарифовна');
  assert.equal(russianPatronymic('Галимҗан улы', 'M'), 'Галимжанович');
  assert.equal(russianPatronymic('Ильяс улы', 'M'), 'Ильясович', 'без татарских букв — тоже');
  // Женское имя «отцом», имя на -а (кроме -улла), на -ә: как по-русски, неочевидно — пусть впишет человек.
  for (const x of ['Фәридә кызы', 'Дәүләтшә улы', 'Муса улы', 'Иса кызы', 'Хәсән Габдулла улы']) assert.equal(russianPatronymic(x), '', x);
  // Уже русское отчество: только буквы.
  assert.equal(russianPatronymic('Хәсәнович'), 'Хасанович');
  assert.equal(russianPatronymic('Петрович'), 'Петрович');
  assert.equal(russianPatronymic(''), '');
});

test('подсказка целиком и кто записан по-татарски', () => {
  assert.deepEqual(suggestRussian({ surname: 'Галиев', given: 'Рәшит', patronymic: 'Хәсән улы', sex: 'M' }),
    { alt_surname: 'Галиев', alt_given: 'Рашит', alt_patronymic: 'Хасанович' });
  assert.deepEqual(suggestRussian({ surname: 'Сафина', given: 'Гыйльмия', patronymic: 'Фәридә кызы', sex: 'F' }),
    { alt_surname: 'Сафина', alt_given: 'Гильмия', alt_patronymic: '' });
  assert.ok(isTatarName({ given: 'Рәшит' }));
  assert.ok(isTatarName({ given: 'Рашит', patronymic: 'Хасан улы' }));
  assert.ok(!isTatarName({ surname: 'Смирнов', given: 'Иван', patronymic: 'Петрович' }));
  assert.ok(!isTatarName({ given: 'Ульяна' }), '«улы» — только целым словом в отчестве');
  assert.equal(altLabel({ alt_given: 'Рашит' }), 'В документах');
  assert.equal(altLabel({ alt_given: 'Рәшит' }), 'По-татарски');
  assert.equal(altLabel({ alt_given: 'Rashit' }), 'Латиницей');
});

// ---------- Поиск по любому написанию ----------

const rashit = { id: 'r', sex: 'M', surname: 'Галиев', given: 'Рәшит', patronymic: 'Хәсән улы', birth_surname: '', alt_surname: '', alt_given: 'Рашит', alt_patronymic: 'Хасанович', living: false, birth_date: '1931', death_date: '1999' };

test('поиск: русское и татарское написания находят друг друга', () => {
  assert.ok(textHas('Рәшит', 'рашит'));
  assert.ok(textHas('Рашит', 'рәшит'));
  assert.ok(textHas('Гыйльмия', 'гильмия'));
  assert.ok(textHas('Гильмия', 'гыйльмия'));
  assert.ok(textHas('Гөлнара', 'гульнара'));
  assert.ok(personHas(rashit, 'Галиев Рашит Хасанович'), 'по второму написанию');
  assert.ok(personHas(rashit, 'Хәсән улы'), 'по основному');
  assert.ok(personHas(rashit, 'хасанович'));
  assert.ok(!personHas({ ...rashit, alt_patronymic: '' }, 'хасанович'), 'без второго написания русского отчества нет');
});

test('загрузка из файла: совпадения по любому написанию', () => {
  const find = matchIndex([rashit, { id: 'x', sex: 'M', surname: 'Галиев', given: 'Марат', patronymic: '', birth_surname: '' }]);
  assert.deepEqual(find({ given: 'Рашит', surname: 'Галиев', patronymic: 'Хасанович', birth_date: '1931' }), ['r']);
  assert.deepEqual(find({ given: 'Рәшит', surname: 'Галиев', patronymic: 'Хәсән улы' }), ['r']);
  // В файле — второе написание, в дереве — только основное.
  const plain = { ...rashit, alt_given: '', alt_patronymic: '' };
  assert.deepEqual(matchIndex([plain])({ given: 'Rashit', surname: 'Galiev', alt_given: 'Рашит', alt_surname: 'Галиев', alt_patronymic: 'Хасанович' }), ['r']);
  assert.ok(matchScore({ given: 'Рашит', surname: 'Галиев', patronymic: 'Хасанович' }, rashit) >= 4);
});

test('проверка дублей: одна карточка по-татарски, другая по-русски', () => {
  const ru = { ...rashit, id: 's', surname: 'Галеев', given: 'Рашид', patronymic: 'Хасанович', alt_given: '', alt_patronymic: '' };
  const tat = { ...rashit, id: 't', given: 'Рәшит', patronymic: 'Хәсән улы', alt_given: '', alt_patronymic: '', alt_surname: '' };
  const data = (ps) => ({ persons: ps, families: [], children: [] });
  const dup = (ps) => checkTree(data(ps)).filter((x) => x.kind === 'dup');
  assert.equal(dup([tat, { ...ru, surname: 'Галиев', given: 'Рашит' }]).length, 1, 'Рашит Хасанович и Рәшит Хәсән улы');
  // Имя по-русски записано совсем иначе (Шамиль и Шәмсетдин) — по основному не сходится, по второму написанию сходится.
  const a = { ...rashit, id: 'a', given: 'Шәмсетдин', patronymic: '', alt_given: '', alt_patronymic: '' };
  const b = { ...rashit, id: 'b', given: 'Шамиль', patronymic: '', alt_given: '', alt_patronymic: '' };
  assert.equal(dup([a, b]).length, 0);
  assert.equal(dup([{ ...a, alt_given: 'Шамиль' }, b]).length, 1);
});

test('объединение дублей: второе написание выбирается и переносится, как остальные поля', () => {
  const keep = { ...rashit, alt_given: '', alt_patronymic: '' };
  const c = defaultChoice(keep, rashit);
  assert.equal(c.alt_given, 'remove');
  assert.equal(mergedPerson(keep, rashit, c).alt_patronymic, 'Хасанович');
  assert.equal(mergedPerson(rashit, keep, defaultChoice(rashit, keep)).alt_given, 'Рашит');
});

// ---------- Роспись, запрос помощнику ----------

test('роспись: второе написание в скобках, в указателе — по обоим написаниям на одно место', () => {
  const ivan = { id: 'ivan', sex: 'M', surname: 'Галиев', given: 'Хәсән', patronymic: '', birth_surname: '', alt_surname: '', alt_given: 'Хасан', alt_patronymic: '', living: false, birth_date: '1900' };
  const wife = { id: 'w', sex: 'F', surname: 'Галиева', given: 'Гыйльмия', patronymic: '', birth_surname: 'Сафина', alt_surname: '', alt_given: 'Гильмия', alt_patronymic: '', living: false };
  const data = { persons: [ivan, wife, rashit], families: [{ id: 'f', partner1: 'ivan', partner2: 'w', kind: 'marriage' }], children: [{ family_id: 'f', child_id: 'r' }] };
  const r = buildRospis(buildIndex(data), 'ivan', parseRospisOptions({ root: 'ivan' }));
  const text = rospisText(r).replace(/\u00a0/g, ' ').replace(/\u2060/g, '');
  assert.match(text, /2\. Галиев Рәшит Хәсән улы \(в документах: Галиев Рашит Хасанович\) — сын № 1/);
  assert.match(text, /Жена: Галиева \(Сафина\) Гыйльмия \(в документах: Галиева Гильмия\)/);
  const row = (name) => r.index.filter((x) => x.name === name).map((x) => x.nums);
  assert.deepEqual(row('Галиев Рәшит Хәсән улы'), [[2]]);
  assert.deepEqual(row('Галиев Рашит Хасанович'), [[2]]);
  assert.deepEqual(row('Галиева Гильмия'), [[1]]);
  assert.deepEqual(row('Галиева (Сафина) Гыйльмия'), [[1]]);
  assert.equal(r.index.filter((x) => x.id === 'r').length, 2);
  assert.equal(r.count.total, 3, 'людей столько же — строк в указателе больше');
  assert.ok(r.index.every((x, i) => !i || r.index[i - 1].name.localeCompare(x.name, 'ru') <= 0), 'по алфавиту');
});

test('запрос помощнику: второе написание рядом с именем, у живого тоже — это имя', () => {
  const kid = { ...rashit, id: 'k', given: 'Әминә', patronymic: 'Рәшит кызы', sex: 'F', alt_given: 'Амина', alt_patronymic: 'Рашитовна', living: true, birth_date: '1990', death_date: '' };
  const data = { persons: [rashit, kid], families: [{ id: 'f', partner1: 'r', partner2: null, kind: 'marriage' }], children: [{ family_id: 'f', child_id: 'k' }] };
  const text = buildPrompt({ person: rashit, idx: buildIndex(data) });
  assert.match(text, /Галиев Рәшит Хәсән улы \(в документах: Рашит Хасанович\), 1931 – 1999/);
  assert.match(text, /Дочь: Галиев Әминә Рәшит кызы \(в документах: Амина Рашитовна\) \(жива\)/);
  assert.ok(!text.includes('1990'), 'год рождения живой не попал');
  assert.match(text, /2 TYPE aka/);
});

// ---------- GEDCOM ----------

const ged = (body) => Buffer.from(`0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n${body.trim()}\n0 TRLR\n`);

test('GEDCOM: TYPE aka, _AKA, ROMN, FONE — во второе написание; TYPE birth — фамилия при рождении', () => {
  const g = parseGedcom(ged(`
0 @I1@ INDI
1 NAME Рәшит Хәсән улы /Галиев/
1 NAME Рашит Хасанович /Галиев/
2 TYPE aka
1 SEX M
0 @I2@ INDI
1 NAME Гыйльмия /Галиева/
1 NAME Гыйльмия /Сафина/
2 TYPE birth
1 NAME Гильмия /Сафина/
2 TYPE aka
0 @I3@ INDI
1 NAME Мөхәммәт /Хәсәнов/
2 ROMN Mukhammat /Khasanov/
3 TYPE pinyin
0 @I4@ INDI
1 NAME Әминә /Галиева/
1 _AKA Амина /Галиева/
0 @I5@ INDI
1 NAME Гөлнара /Галиева/
2 FONE Гульнара /Галиева/
0 @I6@ INDI
1 NAME Анна /Петрова/
2 TYPE married
1 NAME Анна /Смирнова/
2 TYPE birth
`));
  const [a, b, c, d, e, f] = g.persons;
  assert.deepEqual([a.surname, a.given, a.patronymic, a.alt_surname, a.alt_given, a.alt_patronymic], ['Галиев', 'Рәшит', 'Хәсән улы', '', 'Рашит', 'Хасанович']);
  assert.deepEqual([b.surname, b.birth_surname, b.alt_surname, b.alt_given], ['Галиева', 'Сафина', 'Сафина', 'Гильмия']);
  assert.deepEqual([c.alt_surname, c.alt_given], ['Khasanov', 'Mukhammat']);
  assert.deepEqual([d.alt_surname, d.alt_given], ['', 'Амина']);
  assert.deepEqual([e.alt_given], ['Гульнара']);
  assert.deepEqual([f.surname, f.birth_surname, altName(f)], ['Петрова', 'Смирнова', ''], 'девичья и в браке — не второе написание');
  for (const p of g.persons) assert.ok(!/Другое имя/.test(p.notes), p.notes);
  assert.ok(!g.skipped.some((s) => /_AKA|ROMN|FONE/.test(s.label)), JSON.stringify(g.skipped));
  // Третье написание не теряется — в заметки.
  const h = parseGedcom(ged('0 @I1@ INDI\n1 NAME Рәшит /Галиев/\n1 NAME Рашит /Галиев/\n2 TYPE aka\n1 NAME Rashit /Galiev/\n2 TYPE aka')).persons[0];
  assert.equal(h.alt_given, 'Рашит');
  assert.match(h.notes, /Другое имя: Rashit Galiev/);
});

// ---------- Через сервер ----------

const H = { 'x-drevo': '1' };
let app;
let owner;
let editor;
let relative;
let guest;
const call = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });
const json = async (...args) => {
  const r = await call(...args);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const add = (person, relation) => json(owner, 'POST', '/api/persons', { person, relation });
const row = async (id) => (await q('select * from persons where id = $1', [id]))[0];

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await signIn(app, 'owner', { name: 'Анна' });
  editor = await signIn(app, 'editor', { name: 'Сергей' });
  relative = await signIn(app, 'relative', { name: 'Тётя' });
  guest = await signIn(app, 'viewer', { name: 'Гость' });
});
after(async () => {
  await app.close();
  await pool.end();
});

test('поля второго написания: правка, журнал, откат; родственник и гость не правят', async () => {
  const p = await add({ sex: 'M', surname: 'Галиев', given: 'Рәшит', patronymic: 'Хәсән улы', birth_date: '1931', living: false });
  assert.deepEqual([p.alt_surname, p.alt_given, p.alt_patronymic], ['', '', '']);
  const next = await json(editor, 'PATCH', `/api/persons/${p.id}`, { alt_surname: ' Галиев ', alt_given: 'Рашит', alt_patronymic: 'Хасанович', version: p.version });
  assert.deepEqual([next.alt_surname, next.alt_given, next.alt_patronymic], ['Галиев', 'Рашит', 'Хасанович']);
  const [op] = await json(owner, 'GET', `/api/persons/${p.id}/history`);
  assert.deepEqual(op.entries[0].after, { alt_surname: 'Галиев', alt_given: 'Рашит', alt_patronymic: 'Хасанович' });
  assert.deepEqual(op.entries[0].before, { alt_surname: '', alt_given: '', alt_patronymic: '' });
  for (const who of [relative, guest]) assert.equal((await call(who, 'PATCH', `/api/persons/${p.id}`, { alt_given: 'X' })).statusCode, 403);
  await json(owner, 'POST', `/api/changes/${op.entries[0].id}/revert`);
  const back = await row(p.id);
  assert.deepEqual([back.alt_surname, back.alt_given, back.alt_patronymic], ['', '', '']);
});

test('«Написание имён»: всех отмеченных одним действием, отмена одной кнопкой; уже заполненное не трогается', async () => {
  const a = await add({ sex: 'F', surname: 'Сафина', given: 'Гыйльмия', patronymic: 'Габдулла кызы', living: false });
  const b = await add({ sex: 'M', surname: 'Хәсәнов', given: 'Мөхәммәт', living: false });
  const c = await add({ sex: 'M', surname: 'Хәсәнов', given: 'Илдар', alt_given: 'Ильдар', living: false });
  const items = [a, b, c].map((p) => ({ id: p.id, ...suggestRussian(p) }));
  for (const who of [relative, guest]) assert.equal((await call(who, 'POST', '/api/persons/alt-names', { items })).statusCode, 403);
  assert.equal((await call(editor, 'POST', '/api/persons/alt-names', { items: [] })).statusCode, 400);
  const r = await json(editor, 'POST', '/api/persons/alt-names', { items: [...items, { id: 'не-номер' }, { id: '00000000-0000-4000-8000-000000000000' }] });
  assert.equal(r.saved, 2);
  assert.deepEqual([(await row(a.id)).alt_given, (await row(a.id)).alt_patronymic], ['Гильмия', 'Габдулловна']);
  assert.deepEqual([(await row(b.id)).alt_surname, (await row(b.id)).alt_given], ['Хасанов', 'Мухаммат']);
  assert.deepEqual([(await row(c.id)).alt_surname, (await row(c.id)).alt_given], ['', 'Ильдар'], 'у кого уже есть — не трогаем');
  const [op] = await json(owner, 'GET', '/api/changes');
  assert.equal(op.entries.length, 2, 'одно действие');
  assert.deepEqual(new Set(op.entries.map((e) => e.entity_id)), new Set([a.id, b.id]));
  // Повторно — сохранять нечего.
  assert.equal((await call(editor, 'POST', '/api/persons/alt-names', { items })).statusCode, 409);
  await json(owner, 'POST', `/api/changes/${op.entries[0].id}/revert`);
  for (const p of [a, b]) assert.equal(altName(await row(p.id)), '', 'отменено у всех');
});

test('гость видит второе написание как имя — и ничего лишнего у живых', async () => {
  const p = await add({ sex: 'F', surname: 'Галиева', given: 'Әминә', patronymic: 'Рәшит кызы', birth_surname: 'Сафина', alt_given: 'Амина', alt_patronymic: 'Рашитовна', birth_date: '1990', birth_place: 'Казань', living: true });
  const t = await json(guest, 'GET', '/api/tree');
  const g = t.persons.find((x) => x.id === p.id);
  assert.deepEqual([g.alt_given, g.alt_patronymic, g.given], ['Амина', 'Рашитовна', 'Әминә']);
  assert.deepEqual([g.birth_date, g.birth_place, g.birth_surname], ['', '', '']);
  assert.ok(g.hidden);
  // В журнале у гостя — имя при создании и только названия полей при правке.
  await json(owner, 'PATCH', `/api/persons/${p.id}`, { alt_surname: 'Галиева' });
  const feed = await json(guest, 'GET', '/api/feed');
  const entries = feed.items.flatMap((i) => i.entries || []).filter((e) => e.entity_id === p.id);
  const created = entries.find((e) => e.action === 'create');
  if (created) assert.deepEqual(Object.keys(created.after).sort(), ['alt_given', 'alt_patronymic', 'given', 'patronymic', 'sex', 'surname']);
  for (const e of entries.filter((x) => x.action === 'update')) assert.ok(Object.values(e.after).every((v) => v === null));
  // GEDCOM гостя: второе имя есть, даты живой — нет.
  const gedText = (await call(guest, 'GET', '/api/export.ged')).body;
  assert.match(gedText, /1 NAME Амина Рашитовна \/Галиева\/\r?\n2 TYPE aka/);
  assert.ok(!gedText.includes('1990'));
});

test('GEDCOM туда и обратно: второе написание не теряется и не путается с девичьей фамилией', async () => {
  const p = await add({ sex: 'F', surname: 'Галиева', given: 'Гыйльмия', patronymic: 'Габдулла кызы', birth_surname: 'Сафина', alt_given: 'Гильмия', alt_patronymic: 'Габдулловна', living: false, birth_date: '1935' });
  const q2 = await add({ sex: 'M', surname: 'Хәсәнов', given: 'Мөхәммәт', alt_surname: 'Khasanov', alt_given: 'Mukhammat', living: false });
  const text = toGedcom(await loadTreeData({ role: 'owner' }));
  assert.match(text, /1 NAME Гыйльмия Габдулла кызы \/Галиева\/\r?\n2 GIVN Гыйльмия\r?\n2 SURN Галиева\r?\n2 _PATR Габдулла кызы/);
  assert.match(text, /1 NAME Гыйльмия Габдулла кызы \/Сафина\/\r?\n2 TYPE birth/);
  assert.match(text, /1 NAME Гильмия Габдулловна \/Галиева\/\r?\n2 TYPE aka\r?\n2 GIVN Гильмия\r?\n2 SURN Галиева\r?\n2 _PATR Габдулловна/);
  const back = parseGedcom(Buffer.from(text)).persons;
  const x = back.find((y) => y.given === 'Гыйльмия' && y.surname === 'Галиева');
  assert.deepEqual([x.surname, x.patronymic, x.birth_surname, x.alt_surname, x.alt_given, x.alt_patronymic],
    ['Галиева', 'Габдулла кызы', 'Сафина', '', 'Гильмия', 'Габдулловна']);
  const y = back.find((z) => z.given === 'Мөхәммәт' && z.alt_surname === 'Khasanov');
  assert.deepEqual([y.surname, y.alt_given, y.alt_patronymic], ['Хәсәнов', 'Mukhammat', '']);
  assert.ok(!/Другое имя/.test(x.notes + y.notes));
  // Загрузка того же файла: все — «уже есть в дереве», в том числе по второму написанию.
  const b = 'drevo-imya';
  // В файле другой программы — только русское написание или только латиница.
  const file = ged('0 @I1@ INDI\n1 NAME Гильмия Габдулловна /Галиева/\n1 SEX F\n1 BIRT\n2 DATE 1935\n0 @I2@ INDI\n1 NAME Mukhammat /Khasanov/\n1 SEX M').toString();
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="t.ged"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.from(file), Buffer.from(`\r\n--${b}--\r\n`)]);
  const r = await app.inject({ method: 'POST', url: '/api/import', payload, headers: { ...H, cookie: owner, 'content-type': `multipart/form-data; boundary=${b}` } });
  assert.equal(r.statusCode, 200, r.body);
  const people = r.json().people;
  assert.ok(people.find((z) => z.given === 'Гильмия').cands.includes(p.id), 'по русскому написанию нашлась татарская карточка');
  assert.ok(people.find((z) => z.given === 'Mukhammat').cands.includes(q2.id), 'по латинице');
});

test('объединение через сервер переносит второе написание, отмена возвращает', async () => {
  const keep = await add({ sex: 'M', surname: 'Шәрипов', given: 'Габдулла', birth_date: '1920', living: false });
  const remove = await add({ sex: 'M', surname: 'Шарипов', given: 'Габдулла', alt_surname: 'Шарипов', alt_given: 'Абдулла', birth_date: '1920', living: false });
  const t = await json(owner, 'GET', '/api/tree');
  const [k, r] = [keep.id, remove.id].map((id) => t.persons.find((p) => p.id === id));
  assert.ok(checkTree(t).some((f) => f.kind === 'dup' && f.persons.includes(k.id) && f.persons.includes(r.id)));
  const choice = defaultChoice(k, r);
  await json(editor, 'POST', '/api/merge', { keep: k.id, remove: r.id, choice, versions: { keep: k.version, remove: r.version } });
  assert.deepEqual([(await row(k.id)).alt_surname, (await row(k.id)).alt_given], ['Шарипов', 'Абдулла']);
  const [op] = await json(owner, 'GET', '/api/changes');
  await json(owner, 'POST', `/api/changes/${op.entries[0].id}/revert`);
  assert.equal(altName(await row(k.id)), '');
  assert.equal(altName(await row(r.id)), 'Шарипов Абдулла');
  assert.equal((await row(r.id)).deleted_at, null);
});

test('печать: карточка PDF и роспись с вторым написанием собираются', async () => {
  const dad = await add({ sex: 'M', surname: 'Галиев', given: 'Хәсән', alt_given: 'Хасан', living: false, birth_date: '1900' });
  const son = await add({ sex: 'M', surname: 'Галиев', given: 'Рәшит', patronymic: 'Хәсән улы', alt_given: 'Рашит', alt_patronymic: 'Хасанович', living: false }, { type: 'child', to: dad.id });
  const card = await call(guest, 'GET', `/api/persons/${son.id}/card.pdf`);
  assert.equal(card.statusCode, 200);
  assert.equal(card.rawPayload.subarray(0, 4).toString(), '%PDF');
  const ros = await call(owner, 'GET', `/api/rospis.pdf?root=${dad.id}`);
  assert.equal(ros.statusCode, 200, ros.body);
  assert.equal(ros.rawPayload.subarray(0, 4).toString(), '%PDF');
  assert.equal(fullName(await row(son.id)), 'Галиев Рәшит Хәсән улы');
});
