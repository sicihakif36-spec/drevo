// Поколенная роспись: нумерация по коленам, «сын № N» и номера детей, мужская линия и все потомки, потомок по двум
// линиям — один раз и «см. № …», указатель, приватность (гость и «скрыть живых»), удалённые не попадают,
// длинная роспись (тысячи человек) и замер: сервер отвечает, пока она собирается.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { signIn } from './helpers.js';
import { renderRospis } from '../src/rospis.js';
import { buildIndex, surnameGenitive, shortGenitive } from '../../shared/names.js';
import { buildRospis, parseRospisOptions, rospisText, roman } from '../../shared/rospis.js';
import { bigTree } from './fixtures/bigtree.js';

// ---------- Сборка на выдуманной семье ----------

// Родоначальник Иван с женой; сын Пётр и дочь Мария; у Петра — Николай и Анна, у Марии (замужем за Орловым) — Ольга.
function family() {
  const persons = [];
  const families = [];
  const children = [];
  const P = (id, sex, surname, given, patronymic, birth, extra = {}) => persons.push({ id, sex, surname, given, patronymic, birth_surname: '',
    living: false, birth_date: birth, birth_place: '', death_date: '', death_place: '', burial_place: '', occupation: '', notes: '', ...extra });
  const F = (id, a, b, kids, extra = {}) => {
    families.push({ id, partner1: a, partner2: b, kind: 'marriage', start_date: '', place: '', ended: '', end_date: '', ...extra });
    for (const k of kids) children.push({ family_id: id, child_id: k });
  };
  P('ivan', 'M', 'Смирнов', 'Иван', 'Фёдорович', '1880', { death_date: '1942', birth_place: 'д. Горки' });
  P('agr', 'F', 'Смирнова', 'Аграфена', 'Петровна', '1884', { birth_surname: 'Кузнецова' });
  P('petr', 'M', 'Смирнов', 'Пётр', 'Иванович', '1912', { occupation: 'мастер цеха', notes: 'Прошёл всю войну.' });
  P('maria', 'F', 'Орлова', 'Мария', 'Ивановна', '1915', { birth_surname: 'Смирнова' });
  P('klav', 'F', 'Смирнова', 'Клавдия', 'Николаевна', '1918', { birth_surname: 'Орлова', death_date: '2001' });
  P('nik', 'M', 'Орлов', 'Николай', 'Семёнович', '1890');
  P('pel', 'F', 'Орлова', 'Пелагея', 'Ивановна', '1893');
  P('orlov', 'M', 'Орлов', 'Степан', 'Ильич', '1913');
  P('kolya', 'M', 'Смирнов', 'Николай', 'Петрович', '1946');
  P('anna', 'F', 'Смирнова', 'Анна', 'Петровна', '1948');
  P('olga', 'F', 'Орлова', 'Ольга', 'Степановна', '1940');
  F('f1', 'ivan', 'agr', ['maria', 'petr'], { start_date: '1910', place: 'с. Горки' });
  F('f2', 'petr', 'klav', ['anna', 'kolya'], { start_date: '1945' });
  F('f3', 'nik', 'pel', ['klav']);
  F('f4', 'orlov', 'maria', ['olga']);
  return { persons, families, children };
}
const R = (data, qs = {}, extras = {}) => buildRospis(buildIndex(data), qs.root || 'ivan', parseRospisOptions({ root: 'ivan', ...qs }), extras);
// Неразрывные пробелы и «склейки» после тире — обычными пробелами, чтобы сравнивать текст.
const plain = (s) => s.replace(/ /g, ' ').replace(/⁠/g, '');
const text = (r) => plain(rospisText(r));
const entry = (r, num) => r.gens.flatMap((g) => g.entries).find((e) => e.num === num);
const entryText = (r, num) => plain(entry(r, num).paras.map((p) => p.parts.map((x) => x.t).join('')).join('\n'));

test('нумерация по коленам: родоначальник — 1, дети по годам рождения, «сын № N», номера детей', () => {
  const r = R(family());
  assert.deepEqual(r.gens.map((g) => g.title), ['I колено', 'II колено', 'III колено']);
  assert.deepEqual(r.gens.map((g) => g.entries.map((e) => e.id)), [['ivan'], ['petr', 'maria'], ['kolya', 'anna', 'olga']]);
  assert.deepEqual(r.gens.flatMap((g) => g.entries.map((e) => e.num)), [1, 2, 3, 4, 5, 6]);
  const ivan = entryText(r, 1);
  assert.match(ivan, /^1\. Смирнов Иван Фёдорович — родоначальник/);
  assert.match(ivan, /Родился: 1880, д\. Горки\. Умер: 1942\./);
  assert.match(ivan, /Жена \(с 1910, с\. Горки\): Смирнова \(Кузнецова\) Аграфена Петровна, 1884 – \?\./);
  assert.match(ivan, /Дети: Пётр \(№ 2\), Мария \(№ 3\)\./);
  const petr = entryText(r, 2);
  assert.match(petr, /^2\. Смирнов Пётр Иванович — сын № 1/);
  assert.match(petr, /Род занятий: мастер цеха\./);
  assert.match(petr, /Прошёл всю войну\./);
  // Жена не из потомков — коротко её родители.
  assert.match(petr, /Жена \(с 1945\): Смирнова \(Орлова\) Клавдия Николаевна, 1918 – 2001, дочь Николая Орлова и Пелагеи Орловой\./);
  assert.match(petr, /Дети: Николай \(№ 4\), Анна \(№ 5\)\./);
  assert.match(entryText(r, 3), /^3\. Орлова \(Смирнова\) Мария Ивановна — дочь № 1/);
  assert.match(entryText(r, 3), /Муж: Орлов Степан Ильич, 1913 – \?\.\nДочь: Ольга \(№ 6\)\./);
  assert.match(entryText(r, 6), /— дочь № 3/);
  // Ссылки на номера — отдельными кусочками с ref: экран делает из них переходы, PDF — ссылки внутри файла.
  const kids = entry(r, 2).paras.find((p) => p.kind === 'kids');
  assert.deepEqual(kids.parts.filter((x) => x.ref).map((x) => x.ref), [4, 5]);
  assert.deepEqual(entry(r, 2).paras[0].parts.filter((x) => x.ref).map((x) => x.ref), [1]);
  // Вступление.
  assert.match(text(r), /Родоначальник — Смирнов Иван Фёдорович \(1880 – 1942\)\./);
  assert.match(text(r), /В росписи 3 колена и 9 человек: 6 потомков и 3 — их мужья и жёны\./);
  assert.match(text(r), /Составлено \d+ [а-я]+ \d{4} года\./);
  assert.equal(r.subtitle, 'потомков Ивана Фёдоровича Смирнова');
  assert.deepEqual([roman(1), roman(4), roman(9), roman(14), roman(30)], ['I', 'IV', 'IX', 'XIV', 'XXX']);
});

test('фамильная роспись: дочери описаны, их дети — нет; колен меньше; родоначальник от середины дерева', () => {
  const r = R(family(), { line: 'male' });
  assert.deepEqual(r.gens.map((g) => g.entries.map((e) => e.id)), [['ivan'], ['petr', 'maria'], ['kolya', 'anna']]);
  assert.doesNotMatch(entryText(r, 3), /Дочь|Дети/);
  assert.match(entryText(r, 3), /Муж: Орлов Степан Ильич/);
  assert.match(text(r), /по мужской линии/);
  assert.equal(r.subtitle, 'потомков Ивана Фёдоровича Смирнова по мужской линии');
  assert.ok(!r.index.some((x) => x.id === 'olga'));
  // Сколько колен.
  const two = R(family(), { gens: '2' });
  assert.equal(two.gens.length, 2);
  // Дети за последним коленом — без номеров, с годами.
  assert.match(entryText(two, 2), /Дети: Николай \(1946 – \?\), Анна \(1948 – \?\)\./);
  assert.deepEqual([parseRospisOptions({}).gens, parseRospisOptions({ gens: '99' }).gens, parseRospisOptions({ gens: 'x' }).gens], [0, 30, 0]);
  assert.deepEqual([parseRospisOptions({}).line, parseRospisOptions({}).events, parseRospisOptions({}).notes, parseRospisOptions({}).sources], ['all', true, true, false]);
  // От Петра: он — родоначальник, номер 1.
  const p = R(family(), { root: 'petr' });
  assert.deepEqual(p.gens.map((g) => g.entries.map((e) => e.id)), [['petr'], ['kolya', 'anna']]);
});

test('потомок по двум линиям описан один раз, во втором месте — «см. № …»; петля в дереве не зацикливает', () => {
  const data = family();
  // Двоюродные Николай (сын Петра) и Ольга (дочь Марии) — муж и жена, у них сын Иван.
  data.persons.push({ id: 'vanya', sex: 'M', surname: 'Смирнов', given: 'Иван', patronymic: 'Николаевич', birth_surname: '', living: false, birth_date: '1970' });
  data.families.push({ id: 'f5', partner1: 'kolya', partner2: 'olga', kind: 'marriage', start_date: '1968', place: '', ended: '' });
  data.children.push({ family_id: 'f5', child_id: 'vanya' });
  const r = R(data);
  const all = r.gens.flatMap((g) => g.entries);
  assert.equal(all.filter((e) => e.id === 'vanya').length, 1);
  assert.equal(entry(r, 7).id, 'vanya');
  assert.match(entryText(r, 7), /— сын № 4 и № 6/);
  assert.match(entryText(r, 4), /Жена \(с 1968\): Орлова Ольга Степановна, 1940 – \?, см\. № 6\./);
  assert.match(entryText(r, 4), /Сын: Иван \(№ 7\)\./);
  assert.match(entryText(r, 6), /Муж \(с 1968\): Смирнов Николай Петрович, 1946 – \?, см\. № 4\./);
  assert.match(entryText(r, 6), /Сын: Иван \(см\. № 7\)\./);
  // Жена-потомок — не «супруг» в указателе: у неё одна строка со своим номером.
  assert.deepEqual(r.index.filter((x) => x.id === 'olga').map((x) => [x.nums, x.own]), [[[6], true]]);
  // Ошибка в дереве: Николай записан отцом Ивана Фёдоровича.
  const loop = family();
  loop.families.push({ id: 'f9', partner1: 'kolya', partner2: null, kind: 'marriage', start_date: '', place: '', ended: '' });
  loop.children.push({ family_id: 'f9', child_id: 'ivan' });
  const l = R(loop);
  assert.equal(l.gens.flatMap((g) => g.entries).length, 6);
  assert.match(entryText(l, 4), /Сын: Иван \(см\. № 1\)\./);
});

test('указатель: потомки и их мужья и жёны по алфавиту, с номерами записей; второй брак — по номеру', () => {
  const data = family();
  // Второй брак Петра.
  data.persons.push({ id: 'zoya', sex: 'F', surname: 'Белова', given: 'Зоя', patronymic: 'Ильинична', birth_surname: '', living: false, birth_date: '1925' });
  data.families.push({ id: 'f6', partner1: 'petr', partner2: 'zoya', kind: 'marriage', start_date: '1960', place: '', ended: '', created_at: '2026-01-02' });
  data.families.find((f) => f.id === 'f2').ended = 'divorce';
  data.families.find((f) => f.id === 'f2').end_date = '1958';
  const r = R(data);
  assert.match(entryText(r, 2), /1-я жена \(с 1945; развод 1958\): Смирнова \(Орлова\)/);
  assert.match(entryText(r, 2), /2-я жена \(с 1960\): Белова Зоя Ильинична, 1925 – \?\./);
  const idx = r.index.map((x) => `${x.name} ${x.nums.join(',')}${x.own ? '*' : ''}`);
  assert.deepEqual(idx, [
    'Белова Зоя Ильинична 2', 'Орлов Степан Ильич 3', 'Орлова (Смирнова) Мария Ивановна 3*', 'Орлова Ольга Степановна 6*',
    'Смирнов Иван Фёдорович 1*', 'Смирнов Николай Петрович 4*', 'Смирнов Пётр Иванович 2*', 'Смирнова (Кузнецова) Аграфена Петровна 1',
    'Смирнова (Орлова) Клавдия Николаевна 2', 'Смирнова Анна Петровна 5*',
  ]);
  assert.deepEqual(r.index.map((x) => x.letter).filter((x, i, a) => a.indexOf(x) === i), ['Б', 'О', 'С']);
  assert.ok(r.index.every((x) => x.parts.some((p) => p.ref === x.nums[0])));
});

test('скрыть живых: живые моложе 100 лет — только имя; их события и браки без дат; ушедшие — как есть', () => {
  const data = family();
  const kolya = data.persons.find((p) => p.id === 'kolya');
  Object.assign(kolya, { living: true, birth_place: 'г. Калинин', occupation: 'инженер', notes: 'Секрет' });
  data.persons.push({ id: 'wife', sex: 'F', surname: 'Смирнова', given: 'Ирина', patronymic: '', birth_surname: 'Зайцева', living: true, birth_date: '1950' });
  data.families.push({ id: 'f7', partner1: 'kolya', partner2: 'wife', kind: 'marriage', start_date: '1972', place: 'г. Калинин', ended: '' });
  const extras = {
    events: [
      { id: 'e1', kind: 'war', date: '1941–1945', title: 'Калининский фронт', persons: ['petr'] },
      { id: 'e2', kind: 'move', date: '1980', title: 'из Горок', persons: ['petr', 'kolya'] },
    ],
    sources: [{ id: 's1', kind: 'metric', title: 'Метрическая книга', archive: 'ГАТО' }],
    citations: [{ source_id: 's1', subject: 'person', subject_id: 'petr', fact: 'birth_date', persons: ['petr'] }],
  };
  const own = R(data, { sources: '1' }, extras);
  assert.match(entryText(own, 4), /Родился: 1946, г\. Калинин\. Род занятий: инженер\./);
  assert.match(entryText(own, 4), /Секрет/);
  assert.match(entryText(own, 4), /Жена \(с 1972, г\. Калинин\): Смирнова \(Зайцева\) Ирина, р\. 1950\./);
  assert.match(entryText(own, 2), /Жизнь: 1941–1945 — Война \(Калининский фронт\); 1980 — Переезд \(из Горок\)\./);
  assert.match(entryText(own, 2), /По документу: Метрическая книга, ГАТО — дата рождения/);
  // Без событий, заметок и источников — по галочкам.
  const bare = R(data, { events: '0', notes: '0' }, extras);
  assert.doesNotMatch(entryText(bare, 2), /Жизнь|Прошёл всю войну|По документу/);

  const hid = R(data, { hideLiving: '1', sources: '1' }, extras);
  const k = entryText(hid, entry(hid, 4).id === 'kolya' ? 4 : 5);
  assert.doesNotMatch(k, /1946|Калинин|инженер|Секрет|Зайцева|1972|1950/);
  assert.match(k, /Николай Петрович/);
  assert.match(k, /Жена: Смирнова Ирина\./);
  // Событие с живым участником не показывается и у ушедшего; своё событие ушедшего — на месте.
  assert.match(entryText(hid, 2), /Жизнь: 1941–1945 — /);
  assert.doesNotMatch(entryText(hid, 2), /Переезд/);
  assert.match(entryText(hid, 2), /Родился: 1912/);
  assert.match(text(hid), /Даты и места живых родственников не показываются\./);
});

test('склонения для «дочь Николая Орлова»: фамилии мужские и женские, незнакомые — как есть', () => {
  assert.deepEqual(['Орлов', 'Кузнецов', 'Пушкин', 'Вяземский', 'Толстой', 'Шевченко', 'Цой', 'Римский-Корсаков'].map((s) => surnameGenitive(s, false)),
    ['Орлова', 'Кузнецова', 'Пушкина', 'Вяземского', 'Толстого', 'Шевченко', 'Цой', 'Римского-Корсакова']);
  assert.deepEqual(['Орлова', 'Пушкина', 'Вяземская', 'Толстая', 'Шевченко', 'Цой'].map((s) => surnameGenitive(s, true)),
    ['Орловой', 'Пушкиной', 'Вяземской', 'Толстой', 'Шевченко', 'Цой']);
  assert.equal(shortGenitive({ sex: 'M', given: 'Пётр', surname: 'Орлов' }), 'Петра Орлова');
  assert.equal(shortGenitive({ sex: 'F', given: 'Анна', surname: 'Белова' }), 'Анны Беловой');
});

// ---------- PDF ----------

function render(data, o) {
  const out = new PassThrough();
  const chunks = [];
  out.on('data', (c) => chunks.push(c));
  const doc = renderRospis(out, data, o);
  return new Promise((resolve) => out.on('end', () => resolve({ doc, pdf: Buffer.concat(chunks) })));
}

test('длинная роспись: 3000 потомков — сотни страниц без ошибок; колено не остаётся внизу, короткая запись не рвётся', async () => {
  const t = bigTree(3000);
  const { doc, pdf } = await render({ ...t, events: [], sources: [], citations: [] }, parseRospisOptions({ root: t.root }));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(doc.pageCount > 200, `${doc.pageCount} страниц`);
  assert.equal(doc.rospis.count.desc, 3000);
  const entries = doc.marks.filter((m) => m.num);
  assert.equal(entries.length, 3000);
  assert.deepEqual(entries.map((m) => m.num), entries.map((_, i) => i + 1));
  // Заголовок колена — на одной странице с первой записью колена.
  for (const g of doc.marks.filter((m) => m.gen)) {
    const first = doc.marks[doc.marks.indexOf(g) + 1];
    assert.equal(first.page, g.page, `${g.gen} колено осталось внизу страницы ${g.page}`);
  }
  // Запись не длиннее полстраницы не рвётся.
  const torn = entries.filter((m) => m.h < 360 && m.end !== m.page);
  assert.deepEqual(torn, []);
  // Ссылки на номера — внутри файла.
  assert.ok(pdf.toString('latin1').includes('/Dests'));
  // Указатель — все потомки и их мужья и жёны.
  assert.equal(doc.rospis.index.length, doc.rospis.count.total);
  assert.ok(doc.printed.includes('Указатель имён'));
});

// ---------- Сервер ----------

let app;
const H = { 'x-drevo': '1' };
let owner;
let guest;
const login = (role) => signIn(app, role, { label: role });
const call = (cookie, url) => app.inject({ method: 'GET', url, headers: { ...H, cookie } });
const add = async (person, relation) => {
  const r = await app.inject({ method: 'POST', url: '/api/persons', payload: { person, relation }, headers: { ...H, cookie: owner } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

let root; let son; let grand; let gone;

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await login('owner');
  guest = await login('viewer');
  root = await add({ sex: 'M', surname: 'Смирнов', given: 'Иван', patronymic: 'Фёдорович', living: false, birth_date: '1880', death_date: '1942', birth_place: 'д. Горки' });
  son = await add({ sex: 'M', surname: 'Смирнов', given: 'Пётр', patronymic: 'Иванович', living: false, birth_date: '1912', death_date: '1985' }, { to: root.id, type: 'child' });
  grand = await add({ sex: 'M', surname: 'Смирнов', given: 'Сергей', patronymic: 'Петрович', living: true, birth_date: '1972', birth_place: 'Тверь', notes: 'Живёт в Твери' }, { to: son.id, type: 'child' });
  gone = await add({ sex: 'F', surname: 'Удалённова', given: 'Галина', living: false, birth_date: '1915' }, { to: root.id, type: 'child' });
  const r = await app.inject({ method: 'DELETE', url: `/api/persons/${gone.id}`, headers: { ...H, cookie: owner } });
  assert.equal(r.statusCode, 200, r.body);
  // Событие ушедшего с живым внуком — гостю не видно.
  const ev = await app.inject({ method: 'POST', url: `/api/persons/${son.id}/life-events`, headers: { ...H, cookie: owner },
    payload: { kind: 'move', date: '1980', title: 'Переезд в Тверь', persons: [grand.id] } });
  assert.equal(ev.statusCode, 200, ev.body);
  const ev2 = await app.inject({ method: 'POST', url: `/api/persons/${son.id}/life-events`, headers: { ...H, cookie: owner },
    payload: { kind: 'work', date: '1946', title: 'Завод «Пролетарка»' } });
  assert.equal(ev2.statusCode, 200, ev2.body);
});
after(async () => { await app.close(); await pool.end(); });

test('PDF: у владельца — живые с датами, с «скрыть живых» и у гостя — только имя; удалённых нет; имя файла', async () => {
  const pdf = async (cookie, qs = '') => {
    const r = await call(cookie, `/api/rospis.pdf?root=${root.id}${qs}`);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.equal(r.rawPayload.subarray(0, 5).toString(), '%PDF-');
    return r;
  };
  const r = await pdf(owner, '&download=1&line=male');
  assert.match(decodeURIComponent(r.headers['content-disposition']), /^attachment; .*Поколенная роспись — Смирнов Иван Фёдорович \(по мужской линии\)\.pdf$/);
  for (const theme of ['classic', 'modern', 'bw']) await pdf(owner, `&theme=${theme}&gens=2&title=Род Смирновых`);
  await pdf(guest, '&hideLiving=0');

  // Содержимое — по тем же данным, что собирает сервер (с правами и приватностью).
  const extras = async (cookie, qs = '') => {
    const x = await call(cookie, `/api/rospis/extras?root=${root.id}&sources=1${qs}`);
    assert.equal(x.statusCode, 200, x.body);
    return x.json();
  };
  const tree = async (cookie) => (await call(cookie, '/api/tree')).json();
  const own = buildRospis(buildIndex(await tree(owner)), root.id, parseRospisOptions({ root: root.id }), await extras(owner));
  assert.match(text(own), /Родился: 1972, Тверь\./);
  assert.match(text(own), /Живёт в Твери/);
  assert.match(text(own), /Переезд в Тверь/);
  assert.doesNotMatch(text(own), /Удалённова/);
  assert.equal(own.count.desc, 3);
  for (const [cookie, qs] of [[guest, ''], [guest, '&hideLiving=0'], [owner, '&hideLiving=1']]) {
    const x = await extras(cookie, qs);
    assert.ok(!x.events.some((e) => e.title === 'Переезд в Тверь'), 'событие с живым');
    assert.ok(x.events.some((e) => e.title === 'Завод «Пролетарка»'));
    const t = text(buildRospis(buildIndex(await tree(cookie)), root.id, parseRospisOptions({ root: root.id, hideLiving: qs.includes('=1') ? '1' : '0' }), x));
    assert.doesNotMatch(t, /1972|Тверь\.|Живёт в Твери|Удалённова/);
    assert.match(t, /Смирнов Сергей Петрович/);
    assert.match(t, /Завод «Пролетарка»/);
  }
});

test('права и ошибки: без входа — нет, неизвестный или удалённый родоначальник — понятная ошибка', async () => {
  assert.equal((await app.inject({ method: 'GET', url: `/api/rospis.pdf?root=${root.id}`, headers: H })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/rospis/extras', headers: H })).statusCode, 401);
  const r = await call(owner, `/api/rospis.pdf?root=${gone.id}`);
  assert.equal(r.statusCode, 404);
  assert.match(r.json().error, /Родоначальник не найден/);
  assert.equal((await call(owner, '/api/rospis.pdf?root=00000000-0000-4000-8000-000000000000')).statusCode, 404);
});

test('скорость: пока собирается роспись на 3000 потомков, сервер отвечает на другие запросы', async () => {
  const t = bigTree(3000);
  await pool.query('delete from family_children; delete from families');
  await pool.query(`insert into persons (id, sex, surname, given, patronymic, living, birth_date, birth_place, death_date, death_place, occupation, notes)
    select id, sex, surname, given, patronymic, living, birth_date, birth_place, death_date, death_place, occupation, notes
    from json_populate_recordset(null::persons, $1)`, [JSON.stringify(t.persons)]);
  await pool.query(`insert into families (id, partner1, partner2, start_date, place) select id, partner1, partner2, start_date, place
    from json_populate_recordset(null::families, $1)`, [JSON.stringify(t.families)]);
  await pool.query('insert into family_children (family_id, child_id) select family_id, child_id from json_populate_recordset(null::family_children, $1)',
    [JSON.stringify(t.children)]);

  // Задержка основного потока: таймер раз в 20 мс — насколько он опаздывает, пока идёт сборка.
  let last = Date.now();
  let worst = 0;
  const timer = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last - 20); last = now; }, 20);
  const started = Date.now();
  const pdf = call(owner, `/api/rospis.pdf?root=${t.root}`);
  // Пока PDF собирается — другие запросы отвечают быстро.
  const answers = [];
  for (let i = 0; i < 5; i++) {
    await new Promise((res) => setTimeout(res, 150));
    const t0 = Date.now();
    const h = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(h.statusCode, 200);
    answers.push(Date.now() - t0);
  }
  const r = await pdf;
  const total = Date.now() - started;
  clearInterval(timer);
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.rawPayload.length > 100000);
  console.log(`# роспись 3000 потомков: ${total} мс, ${r.rawPayload.length} байт; основной поток опаздывал не больше ${worst} мс; ответы во время сборки: ${answers.join(', ')} мс`);
  assert.ok(worst < 1000, `сервер не отвечал ${worst} мс`);
  assert.ok(Math.max(...answers) < 1000);
});
