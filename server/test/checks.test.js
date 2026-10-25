// Проверка дерева: находки на синтетических примерах (срабатывает и не срабатывает), скорость на 4000 человек,
// отметки «Всё верно» (общие, пропадают и возвращаются при изменении данных), права, объединение дублей с полным откатом.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { signIn } from './helpers.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { createInvite } from '../src/auth.js';
import { randomTree } from './fixtures/clans.js';
import { checkTree, dateRange, openFindings, activeMarks, defaultChoice, mergedPerson } from '../../shared/checks.js';

// ---------- Находки на синтетике ----------

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const person = (o = {}) => ({
  id: uid(), sex: 'M', surname: 'Сафин', given: 'Марат', patronymic: '', birth_surname: '', living: true,
  birth_date: '', death_date: '', photo_id: null, ...o,
});
// Маленькое дерево: fam(отец, мать, [дети]) — семья; links — ещё семьи.
function tree(persons, fams) {
  const families = [];
  const children = [];
  for (const [p1, p2, kids = [], extra = {}] of fams) {
    const f = { id: uid(), partner1: p1?.id || null, partner2: p2?.id || null, start_date: '', ...extra };
    families.push(f);
    for (const k of kids) children.push({ family_id: f.id, child_id: (k.id || k), kind: k.kind || 'birth' });
  }
  return { persons, families, children };
}
const NOW = new Date('2026-10-24T12:00:00Z');
const kinds = (data) => checkTree(data, { now: NOW }).map((x) => x.kind);
const find = (data, kind) => checkTree(data, { now: NOW }).filter((x) => x.kind === kind);
// Отец, мать и ребёнок с заданными датами.
function family({ father = {}, mother = {}, child = {}, start = '' } = {}) {
  const f = person({ given: 'Ильдар', ...father });
  const m = person({ sex: 'F', given: 'Алия', surname: 'Сафина', ...mother });
  const c = person({ given: 'Марат', ...child });
  return { f, m, c, data: tree([f, m, c], [[f, m, [c], { start_date: start }]]) };
}

test('даты как промежуток: точная, год, около, до, после, между, период, месяц, старый стиль, непонятная', () => {
  assert.deepEqual([dateRange('1967').lo, dateRange('1967').hi], [1967, 1968]);
  assert.equal(dateRange('около 1967').lo, 1962);
  assert.equal(dateRange('ABT 1967').hi, 1973);
  assert.equal(dateRange('до 1960').lo, -Infinity);
  assert.equal(dateRange('BEF 1960').lo, -Infinity);
  assert.equal(dateRange('после 1960').hi, Infinity);
  assert.equal(dateRange('AFT 1960').hi, Infinity);
  assert.equal(dateRange('между 1950 и 1955').lo, 1950);
  assert.equal(dateRange('BET 1950 AND 1955').hi, 1956);
  assert.equal(dateRange('1941–1945').hi, 1946);
  assert.ok(dateRange('март 1950').hi < 1950.3);
  assert.ok(dateRange('12.03.1950').exact);
  assert.ok(dateRange('12.03.1890 ст. ст.').exact);
  for (const bad of ['XIX век', '31.02.1950', 'не знаю', '980', '1950 1960 1970']) assert.ok(dateRange(bad).bad, bad);
  assert.equal(dateRange(''), null);
});

test('родитель слишком молод: ошибка, стоит проверить, неточные даты — только если противоречие при любом прочтении', () => {
  const { data, f } = family({ father: { birth_date: '1967' }, child: { birth_date: '1978' } });
  const [x] = find(data, 'parent_young');
  assert.equal(x.level, 'error');
  assert.equal(x.text, 'Марат родился в 1978 году, а его отец — в 1967: отцу было 11 лет');
  assert.equal(x.fix, f.id);
  assert.equal(find(family({ father: { birth_date: '1965' }, child: { birth_date: '1978' } }).data, 'parent_young')[0].level, 'warn');
  assert.deepEqual(find(family({ father: { birth_date: '1960' }, child: { birth_date: '1978' } }).data, 'parent_young'), []);
  // «около 1967» — могло быть и 1962: 16 лет — не находка.
  assert.deepEqual(find(family({ father: { birth_date: 'около 1967' }, child: { birth_date: '1978' } }).data, 'parent_young'), []);
  assert.deepEqual(find(family({ father: { birth_date: 'ABT 1967' }, child: { birth_date: '1978' } }).data, 'parent_young'), []);
  // «до 1967» — мог родиться сколь угодно раньше.
  assert.deepEqual(find(family({ father: { birth_date: 'BEF 1967' }, child: { birth_date: '1978' } }).data, 'parent_young'), []);
  // Период «между 1966 и 1968» — при любом прочтении меньше 13.
  assert.equal(find(family({ father: { birth_date: 'между 1966 и 1968' }, child: { birth_date: '1978' } }).data, 'parent_young')[0].level, 'error');
  // Ребёнок старше родителя.
  assert.deepEqual(kinds(family({ father: { birth_date: '1990' }, child: { birth_date: '1978' } }).data), ['parent_younger']);
  // Приёмный ребёнок — не проверяем возраст.
  const g = person({ given: 'Ильдар', birth_date: '1967' });
  const k = person({ birth_date: '1978' });
  assert.deepEqual(kinds(tree([g, k], [[g, null, [{ id: k.id, kind: 'adopted' }]]])), []);
});

test('мать старше 55, рождение после смерти матери, посмертный ребёнок в пределах 10 месяцев', () => {
  assert.deepEqual(kinds(family({ mother: { birth_date: '1900', living: false }, child: { birth_date: '1958' } }).data), ['mother_old']);
  assert.deepEqual(kinds(family({ mother: { birth_date: '1900', living: false }, child: { birth_date: '1954' } }).data), []);
  assert.deepEqual(kinds(family({ father: { birth_date: '1930' }, mother: { birth_date: 'около 1900', living: false }, child: { birth_date: '1958' } }).data), []);
  const dead = { living: false, death_date: '10.01.1960' };
  assert.deepEqual(kinds(family({ mother: { ...dead, birth_date: '1930' }, child: { birth_date: '05.05.1961' } }).data), ['after_death']);
  assert.deepEqual(kinds(family({ mother: { ...dead, birth_date: '1930' }, child: { birth_date: '1960' } }).data), []);
  // Отец погиб в январе 1943, сын родился в сентябре — посмертный ребёнок, не находка; через год — находка.
  const war = { living: false, death_date: '15.01.1943', birth_date: '1915' };
  assert.deepEqual(kinds(family({ father: war, child: { birth_date: '20.09.1943' } }).data), []);
  assert.deepEqual(kinds(family({ father: war, child: { birth_date: '20.03.1944' } }).data), ['after_death']);
  assert.equal(find(family({ father: war, child: { birth_date: '1945' } }).data, 'after_death')[0].level, 'error');
});

test('даты одного человека: смерть раньше рождения, будущее, непонятная, старше 110 без отметки «умер»; старый стиль — не расхождение', () => {
  const one = (o) => kinds(tree([person(o)], []));
  assert.deepEqual(one({ living: false, birth_date: '1950', death_date: '1940' }), ['death_before_birth']);
  assert.deepEqual(one({ living: false, birth_date: '1950', death_date: 'около 1948' }), []);
  assert.deepEqual(one({ birth_date: '2031' }), ['future']);
  assert.deepEqual(one({ birth_date: 'XIX век' }), ['bad_date']);
  assert.deepEqual(one({ birth_date: '1900' }), ['too_old']);
  assert.deepEqual(one({ birth_date: '1900', living: false }), []);
  assert.deepEqual(one({ birth_date: '1930' }), []);
  // Рождение 12.03.1890 по старому стилю — это 24.03.1890; смерть «24.03.1890» — тот же день, не расхождение.
  assert.deepEqual(one({ living: false, birth_date: '12.03.1890 ст. ст.', death_date: '20.03.1890' }), []);
  assert.deepEqual(one({ living: false, birth_date: '12.03.1890', death_date: '01.03.1890' }), []);
  assert.deepEqual(one({ living: false, birth_date: '12.03.1890', death_date: '01.01.1890' }), ['death_before_birth']);
});

test('браки: раньше 14 лет, после смерти супруга; брат и сестра, супруг — родитель; брак двоюродных — не находка', () => {
  const a = person({ birth_date: '1950' });
  const b = person({ sex: 'F', given: 'Алия', birth_date: '1950' });
  assert.deepEqual(kinds(tree([a, b], [[a, b, [], { start_date: '1962' }]])), ['marriage_young', 'marriage_young']);
  assert.deepEqual(kinds(tree([a, b], [[a, b, [], { start_date: '1972' }]])), []);
  const d = person({ sex: 'F', given: 'Алия', birth_date: '1950', living: false, death_date: '1970' });
  assert.deepEqual(kinds(tree([a, d], [[a, d, [], { start_date: '1975' }]])), ['marriage_after_death']);
  // Брат и сестра.
  const f = person({ given: 'Ильдар' });
  const s1 = person({ given: 'Марат' });
  const s2 = person({ sex: 'F', given: 'Алия' });
  assert.deepEqual(kinds(tree([f, s1, s2], [[f, null, [s1, s2]], [s1, s2]])), ['sibling_marriage']);
  // Мать и сын записаны мужем и женой.
  assert.deepEqual(kinds(tree([s2, s1], [[s2, null, [s1]], [s1, s2]])), ['spouse_parent']);
  // Двоюродные: общий дед, разные родители — не находка.
  const g = person({ given: 'Дед' });
  const p1 = person({ given: 'Отец' });
  const p2 = person({ given: 'Дядя' });
  const c1 = person({ given: 'Ринат' });
  const c2 = person({ sex: 'F', given: 'Гузель' });
  assert.deepEqual(kinds(tree([g, p1, p2, c1, c2], [[g, null, [p1, p2]], [p1, null, [c1]], [p2, null, [c2]], [c1, c2]])), []);
});

test('связи: замкнутый круг, больше двух родителей; без связей и маленькие оторванные части', () => {
  const a = person({ given: 'А' });
  const b = person({ given: 'Б' });
  const c = person({ given: 'В' });
  const ring = find(tree([a, b, c], [[a, null, [b]], [b, null, [c]], [c, null, [a]]]), 'cycle');
  assert.equal(ring.length, 1);
  assert.equal(ring[0].persons.length, 3);
  const k = person({ given: 'Ребёнок' });
  const ps = [1, 2, 3].map((i) => person({ given: `Р${i}` }));
  assert.ok(kinds(tree([k, ...ps], [[ps[0], ps[1], [k]], [ps[2], null, [k]]])).includes('many_parents'));
  // Родные и приёмные — не «больше двух».
  assert.ok(!kinds(tree([k, ...ps], [[ps[0], ps[1], [k]], [ps[2], null, [{ id: k.id, kind: 'adopted' }]]])).includes('many_parents'));
  // Основное дерево из 7, пара отдельно и один одинокий.
  const big = Array.from({ length: 7 }, (_, i) => person({ given: `Ч${i}` }));
  const pair = [person({ given: 'П1' }), person({ given: 'П2', sex: 'F' })];
  const lone = person({ given: 'Один' });
  const data = tree([...big, ...pair, lone], [[big[0], big[1], big.slice(2)], [pair[0], pair[1]]]);
  assert.deepEqual(find(data, 'alone').map((x) => x.persons), [[lone.id]]);
  assert.deepEqual(find(data, 'island').map((x) => x.persons.length), [2]);
});

test('вероятные дубли: татарское и русское написание — дубль; тёзки в разных поколениях и двоюродные тёзки — нет', () => {
  const a = person({ given: 'Ильгамия', surname: 'Хабибуллина', sex: 'F', birth_date: '1931' });
  const b = person({ given: 'Илһамия', surname: 'Һабибуллина', sex: 'F', birth_date: 'около 1933' });
  const [d] = find(tree([a, b], []), 'dup');
  assert.equal(d.level, 'dup');
  assert.deepEqual(d.persons.sort(), [a.id, b.id].sort());
  // Девичья фамилия совпадает с фамилией второй карточки.
  const c = person({ given: 'Амина', surname: 'Сафина', sex: 'F' });
  const e = person({ given: 'Әминә', surname: 'Галиева', birth_surname: 'Сафина', sex: 'F' });
  assert.equal(find(tree([c, e], []), 'dup').length, 1);
  // Годы дальше чем на 3 — нет; разное отчество — нет; другой пол — нет.
  assert.equal(find(tree([person({ birth_date: '1950' }), person({ birth_date: '1955' })], []), 'dup').length, 0);
  assert.equal(find(tree([person({ patronymic: 'Ильдарович' }), person({ patronymic: 'Ринатович' })], []), 'dup').length, 1 - 1);
  assert.equal(find(tree([person({ patronymic: 'Ильдарович' }), person({ patronymic: 'Ильдар улы' })], []), 'dup').length, 1);
  // Дед и внук — тёзки без дат: родные по прямой, не дубль.
  const gd = person({ given: 'Иван', surname: 'Смирнов' });
  const fa = person({ given: 'Пётр', surname: 'Смирнов' });
  const gs = person({ given: 'Иван', surname: 'Смирнов' });
  assert.equal(find(tree([gd, fa, gs], [[gd, null, [fa]], [fa, null, [gs]]]), 'dup').length, 0);
  // Двоюродные тёзки (названы в честь деда): у обоих известны разные родители — не дубль.
  const u = person({ given: 'Николай', surname: 'Смирнов' });
  const c1 = person({ given: 'Иван', surname: 'Смирнов' });
  const c2 = person({ given: 'Иван', surname: 'Смирнов' });
  assert.equal(find(tree([gd, fa, u, c1, c2], [[gd, null, [fa, u]], [fa, null, [c1]], [u, null, [c2]]]), 'dup').length, 0);
  // Один ребёнок записан дважды у тех же родителей — дубль, и сильнее.
  const twice = find(tree([fa, c1, c2], [[fa, null, [c1, c2]]]), 'dup');
  assert.equal(twice.length, 1);
  assert.ok(twice[0].strong);
  assert.match(twice[0].text, /общие родители/);
});

test('отметки: находка пропадает, пока данные те же; «Вернуть» — снова видна', () => {
  const { data, f } = family({ father: { birth_date: '1967' }, child: { birth_date: '1978' } });
  const all = checkTree(data, { now: NOW });
  const marks = [{ key: all[0].key, sig: all[0].sig }];
  assert.equal(openFindings(all, marks).length, all.length - 1);
  assert.equal(activeMarks(all, marks).length, 1);
  f.living = false;
  const again = checkTree(data, { now: NOW });
  assert.equal(openFindings(again, marks).length, again.length);
  assert.equal(activeMarks(again, marks).length, 0);
});

test('что оставить при объединении: заполненное и более точное', () => {
  const a = { surname: 'Сафин', given: 'Марат', patronymic: '', birth_surname: '', sex: 'U', living: true, birth_date: '1978', birth_place: 'Казань', death_date: '', death_place: '', burial_place: '', occupation: '', notes: 'А' };
  const b = { ...a, patronymic: 'Ильдарович', sex: 'M', birth_date: '12.03.1978', birth_place: '', notes: 'Б' };
  const c = defaultChoice(a, b);
  assert.equal(c.patronymic, 'remove');
  assert.equal(c.sex, 'remove');
  assert.equal(c.birth_date, 'remove');
  assert.equal(c.birth_place, 'keep');
  assert.equal(c.notes, 'both');
  const m = mergedPerson(a, b, c);
  assert.equal(m.notes, 'А\n\nБ');
  assert.equal(m.birth_date, '12.03.1978');
  assert.equal(mergedPerson(a, { ...b, living: false, death_date: '2001' }, { death_date: 'remove' }).living, false);
});

test('скорость: 4000 человек — все проверки быстрее 200 мс', () => {
  const measure = (data) => {
    checkTree(data, { now: NOW });
    const t0 = performance.now();
    const out = checkTree(data, { now: NOW });
    return { ms: performance.now() - t0, n: out.length };
  };
  // Случайное дерево из тестов раскладки, имена и фамилии — как в настоящей семье: по нескольку десятков разных.
  // Каждый двадцатый год рождения — «около», у каждого сотого ошибка в годе, у каждого двухсотого — непонятная дата.
  const GIVEN = ['Ринат', 'Пётр', 'Ильдар', 'Николай', 'Фарит', 'Михаил', 'Габдулла', 'Сергей', 'Марат', 'Иван', 'Рустам', 'Юрий', 'Камиль',
    'Алексей', 'Ильнур', 'Василий', 'Рашит', 'Андрей', 'Тимур', 'Фёдор', 'Айрат', 'Дмитрий', 'Наиль', 'Григорий', 'Азат', 'Степан', 'Ильяс', 'Павел',
    'Амина', 'Мария', 'Гульнара', 'Анна', 'Ильгамия', 'Вера', 'Зульфия', 'Ольга', 'Наиля', 'Клавдия', 'Роза', 'Елена', 'Лилия', 'Татьяна',
    'Альфия', 'Надежда', 'Гузель', 'Ирина', 'Рамиля', 'Галина', 'Диляра', 'Нина', 'Резеда', 'Валентина', 'Алсу', 'Людмила', 'Фания', 'Зоя'];
  const SUR = ['Иванов', 'Гарипов', 'Соколов', 'Валиев', 'Морозов', 'Закиров', 'Лебедев', 'Нуриев', 'Сафин', 'Галиев', 'Смирнов', 'Хабибуллин',
    'Попов', 'Шарипов', 'Кузнецов', 'Ахметов', 'Новиков', 'Юсупов', 'Фёдоров', 'Мухаметов', 'Волков', 'Каримов', 'Павлов', 'Исхаков'];
  const data = randomTree(4000, 7);
  // Годы в случайном дереве уходят в будущее — сдвигаем всё дерево так, чтобы младшие родились до 2020.
  const shift = Math.max(...data.persons.map((p) => Number(p.birth_date))) - 2020;
  data.persons.forEach((p, i) => {
    const y = Number(p.birth_date) - shift;
    Object.assign(p, { birth_date: String(y), living: y > 1935, death_date: y > 1935 ? '' : String(y + 65) });
    p.given = GIVEN[((i * 7919) % 1009 % 28) + (p.sex === 'F' ? 28 : 0)];
    if (p.surname) p.surname = SUR[(i * 104729) % 1013 % SUR.length] + (p.sex === 'F' ? 'а' : '');
    if (i % 20 === 1) p.birth_date = `около ${p.birth_date}`;
    if (i % 100 === 2) p.birth_date = String(Number(p.birth_date) + 40);
    if (i % 200 === 3) p.birth_date = 'XIX век';
  });
  const real = measure(data);
  console.log(`проверка дерева: 4000 человек, ${real.n} находок, ${real.ms.toFixed(0)} мс`);
  assert.ok(real.ms < 200, `${real.ms} мс`);
  // Худший случай: 12 имён и 8 фамилий на 4000 человек — тысячи тёзок; всё равно быстро.
  const stress = measure(randomTree(4000, 7));
  console.log(`проверка дерева, тёзки: 4000 человек, ${stress.n} находок, ${stress.ms.toFixed(0)} мс`);
  assert.ok(stress.ms < 1000, `${stress.ms} мс`);
});

// ---------- Сервер: отметки, права, объединение ----------

const H = { 'x-drevo': '1' };
let app;
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
const add = (cookie, person, relation) => json(cookie, 'POST', '/api/persons', { person, relation });

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { send: async () => {}, timer: false } });
  owner = await login('owner', 'Анна');
  editor = await login('editor', 'Сергей');
  relative = await login('relative', 'Родня');
  guest = await login('viewer', 'Гость');
});
after(async () => { await app.close(); await pool.end(); });

test('отметки: общие, видно кто и когда; пропадают при изменении данных; «Вернуть в проверку»; права', async () => {
  const father = await add(owner, { sex: 'M', surname: 'Сафин', given: 'Ильдар', birth_date: '1967' });
  const son = await add(owner, { sex: 'M', surname: 'Сафин', given: 'Марат', birth_date: '1978' }, { type: 'child', to: father.id });
  const tree1 = await json(owner, 'GET', '/api/tree');
  const x = checkTree(tree1).find((f) => f.kind === 'parent_young');
  assert.ok(x);
  await json(editor, 'POST', '/api/checks/marks', { key: x.key });
  // Отметку участника видит владелец: она общая.
  const t2 = await json(owner, 'GET', '/api/tree');
  assert.equal(t2.check_marks.length, 1);
  assert.equal(t2.check_marks[0].user_name, 'Сергей');
  assert.ok(t2.check_marks[0].at);
  assert.equal(openFindings(checkTree(t2), t2.check_marks).filter((f) => f.kind === 'parent_young').length, 0);
  // Отметка — не правка дерева: в «Последние правки» и ленту не попадает.
  assert.ok(!(await json(owner, 'GET', '/api/changes')).some((op) => op.entries.some((e) => e.entity === 'check')));
  // Данные изменились — находка снова видна (год рождения сына другой, отцу всё ещё мало лет).
  await json(owner, 'PATCH', `/api/persons/${son.id}`, { birth_date: '1979' });
  const t3 = await json(owner, 'GET', '/api/tree');
  assert.equal(openFindings(checkTree(t3), t3.check_marks).filter((f) => f.kind === 'parent_young').length, 1);
  // Вернули как было — отметка снова действует.
  await json(owner, 'PATCH', `/api/persons/${son.id}`, { birth_date: '1978' });
  const t4 = await json(owner, 'GET', '/api/tree');
  assert.equal(activeMarks(checkTree(t4), t4.check_marks).length, 1);
  // «Вернуть в проверку».
  await json(owner, 'DELETE', `/api/checks/marks?key=${encodeURIComponent(x.key)}`);
  const t5 = await json(owner, 'GET', '/api/tree');
  assert.equal(t5.check_marks.length, 0);
  // Несуществующая находка — 404.
  assert.equal((await call(owner, 'POST', '/api/checks/marks', { key: 'parent_young:нет' })).statusCode, 404);
  // Родственник, гость, без входа: ни отметок в дереве, ни API.
  for (const who of [relative, guest]) {
    const t = await json(who, 'GET', '/api/tree');
    assert.equal(t.check_marks, undefined);
    assert.equal((await call(who, 'GET', '/api/checks/marks')).statusCode, 403);
    assert.equal((await call(who, 'POST', '/api/checks/marks', { key: x.key })).statusCode, 403);
    assert.equal((await call(who, 'DELETE', `/api/checks/marks?key=${encodeURIComponent(x.key)}`)).statusCode, 403);
    assert.equal((await call(who, 'POST', '/api/merge', { keep: father.id, remove: son.id })).statusCode, 403);
  }
  for (const [m, u] of [['GET', '/api/checks/marks'], ['POST', '/api/checks/marks'], ['POST', '/api/merge']]) {
    assert.equal((await app.inject({ method: m, url: u, headers: H, payload: {} })).statusCode, 401);
  }
  assert.equal((await json(editor, 'GET', '/api/checks/marks')).length, 0);
  // Родителя с ребёнком объединить нельзя.
  assert.equal((await call(owner, 'POST', '/api/merge', { keep: father.id, remove: son.id })).statusCode, 400);
});

// Все таблицы, кроме журнала и служебных: для сравнения «до объединения» и «после отката».
const SKIP = new Set(['changes', 'schema_migrations', 'sessions', 'push_keys', 'push_subs', 'push_sent', 'push_digests', 'check_marks']);
async function snapshot() {
  const tables = (await q("select tablename from pg_tables where schemaname = 'public' order by 1")).map((r) => r.tablename).filter((t) => !SKIP.has(t));
  const out = {};
  for (const t of tables) {
    const rows = await q(`select * from ${t}`);
    out[t] = rows.map((r) => {
      const x = { ...r };
      if (t === 'persons') { delete x.version; delete x.updated_at; }
      return JSON.stringify(x, Object.keys(x).sort());
    }).sort();
  }
  return out;
}

test('объединение: переносится всё из всех таблиц, без дублей связей; откат возвращает в точности; повтор после отката', async () => {
  // Две карточки одного человека — «Марат» из рукописной схемы и «Марат» из файла.
  const dad = await add(owner, { sex: 'M', surname: 'Галиев', given: 'Ринат', living: false, birth_date: '1920', death_date: '1990' });
  const mom = await add(owner, { sex: 'F', surname: 'Галиева', given: 'Гузель', living: false, birth_date: '1925' }, { type: 'spouse', to: dad.id });
  const keep = await add(owner, { sex: 'M', surname: 'Галиев', given: 'Марат', birth_date: '1950', birth_place: 'Казань' }, { type: 'child', to: dad.id });
  const sister = await add(owner, { sex: 'F', surname: 'Галиева', given: 'Алсу', birth_date: '1952' }, { type: 'sibling', to: keep.id });
  const wife = await add(owner, { sex: 'F', surname: 'Галиева', given: 'Лилия', birth_date: '1955' }, { type: 'spouse', to: keep.id });
  const kid1 = await add(owner, { sex: 'M', surname: 'Галиев', given: 'Тимур', birth_date: '1980' }, { type: 'child', to: keep.id });
  // Вторая карточка: та же жена (второй брак с ней же), общий ребёнок и ещё один, свои родители — отец без матери.
  const dad2 = await add(owner, { sex: 'M', surname: 'Галиев', given: 'Ренат', birth_date: 'около 1920' });
  const remove = await add(owner, { sex: 'M', surname: 'Галиев', given: 'Марат', patronymic: 'Ринатович', birth_date: '12.03.1950', occupation: 'инженер' }, { type: 'child', to: dad2.id });
  await json(owner, 'POST', '/api/relations', { personId: wife.id, to: remove.id, type: 'spouse' });
  const fam2 = (await q('select id from families where (partner1 = $1 or partner2 = $1) and (partner1 = $2 or partner2 = $2) and id not in (select id from families where partner1 = $3 or partner2 = $3)', [remove.id, wife.id, keep.id]))[0].id;
  await q("update families set start_date = '1975', place = 'Казань' where id = $1", [fam2]);
  await json(owner, 'POST', '/api/relations', { personId: kid1.id, to: remove.id, type: 'child', familyId: fam2 });
  const kid2 = await add(owner, { sex: 'F', surname: 'Галиева', given: 'Диляра', birth_date: '1983' }, { type: 'child', to: remove.id, familyId: fam2 });
  // Привязки: фото (одно общее, одно только у второй — главное), история, событие, источник с достоверностью, обсуждение,
  // вопрос исследования, «это я», приглашение, анкета.
  const users = await q('select id from users order by created_at');
  const [m1, m2, m3] = await q(`insert into media (mime, bytes, kind) values ('image/jpeg', 10, 'photo'), ('image/jpeg', 10, 'photo'), ('image/jpeg', 10, 'doc') returning id`);
  await q('insert into media_persons (media_id, person_id) values ($1, $2), ($1, $3), ($4, $3), ($5, $3), ($5, $6)', [m1.id, keep.id, remove.id, m2.id, m3.id, wife.id]);
  await q('update persons set photo_id = $1 where id = $2', [m2.id, remove.id]);
  const story = await json(owner, 'POST', `/api/persons/${remove.id}/stories`, { title: 'Как Марат строил мост', body: 'Текст' });
  const both = await json(owner, 'POST', `/api/persons/${keep.id}/stories`, { title: 'Общая', body: 'Текст' });
  await json(owner, 'PUT', `/api/stories/${both.id}/persons/${remove.id}`);
  const ev = await json(owner, 'POST', `/api/persons/${remove.id}/life-events`, { kind: 'work', date: '1975', title: 'Завод' });
  const src = await json(owner, 'POST', '/api/sources', { kind: 'zags', title: 'Свидетельство о рождении' });
  await json(owner, 'POST', '/api/citations', { source_id: src.id, subject: 'person', subject_id: remove.id, fact: 'birth_date' });
  await json(owner, 'POST', '/api/citations', { source_id: src.id, subject: 'person', subject_id: keep.id, fact: 'birth_date' });
  await json(owner, 'POST', '/api/citations', { source_id: src.id, subject: 'family', subject_id: fam2, fact: 'marriage' });
  await json(owner, 'PUT', '/api/quality', { subject: 'person', subject_id: remove.id, fact: 'birth_date', quality: 'document' });
  await json(owner, 'PUT', '/api/quality', { subject: 'person', subject_id: keep.id, fact: 'birth_date', quality: 'oral' });
  await json(owner, 'PUT', '/api/quality', { subject: 'person', subject_id: remove.id, fact: 'birth_place', quality: 'oral' });
  await json(relative, 'POST', `/api/persons/${remove.id}/comments`, { body: 'Это мой дядя' });
  const rq = await json(editor, 'POST', `/api/persons/${remove.id}/research`, { title: 'Где учился' });
  await q('update users set person_id = $1 where id = $2', [remove.id, users[1].id]);
  await createInvite({ role: 'editor', personId: remove.id });
  await json(owner, 'POST', '/api/surveys', { name: 'Дядя Марат', person_id: remove.id });

  // Проверка видит дубль.
  const t = await json(owner, 'GET', '/api/tree');
  const dup = checkTree(t).find((f) => f.kind === 'dup' && f.persons.includes(keep.id) && f.persons.includes(remove.id));
  assert.ok(dup, 'дубль найден');

  const before0 = await snapshot();
  const choice = defaultChoice(t.persons.find((p) => p.id === keep.id), t.persons.find((p) => p.id === remove.id));
  const res = await json(editor, 'POST', '/api/merge', { keep: keep.id, remove: remove.id, choice, photo: 'remove', versions: { keep: keep.version, remove: remove.version } });
  assert.equal(res.id, keep.id);

  const has = async (sql, params = []) => (await q(sql, params)).length;
  // На удалённой карточке ничего не осталось.
  assert.ok((await q('select deleted_at from persons where id = $1', [remove.id]))[0].deleted_at);
  for (const [table, col] of [['media_persons', 'person_id'], ['story_persons', 'person_id'], ['event_persons', 'person_id'], ['comments', 'person_id'],
    ['research_questions', 'person_id'], ['users', 'person_id'], ['invites', 'person_id'], ['surveys', 'person_id'], ['families', 'partner1'],
    ['families', 'partner2'], ['family_children', 'child_id']]) {
    assert.equal(await has(`select 1 from ${table} where ${col} = $1`, [remove.id]), 0, `${table}.${col}`);
  }
  assert.equal(await has("select 1 from citations where subject = 'person' and subject_id = $1", [remove.id]), 0);
  assert.equal(await has("select 1 from fact_quality where subject = 'person' and subject_id = $1", [remove.id]), 0);
  // Всё на оставшейся: фото без повтора, истории, событие, обсуждение, вопрос, «это я», приглашение, анкета.
  assert.deepEqual((await q('select media_id from media_persons where person_id = $1 order by media_id', [keep.id])).map((r) => r.media_id), [m1.id, m2.id, m3.id].sort());
  assert.equal(await has('select 1 from story_persons where person_id = $1', [keep.id]), 2);
  assert.equal(await has('select 1 from story_persons where story_id = $1', [both.id]), 1);
  assert.equal(await has('select 1 from event_persons where person_id = $1 and event_id = $2', [keep.id, ev.id]), 1);
  assert.equal(await has('select 1 from story_persons where story_id = $1 and person_id = $2', [story.id, keep.id]), 1);
  assert.equal(await has('select 1 from comments where person_id = $1', [keep.id]), 1);
  assert.equal(await has('select 1 from research_questions where person_id = $1 and id = $2', [keep.id, rq.id]), 1);
  assert.equal(await has('select 1 from users where person_id = $1', [keep.id]), 1);
  assert.equal(await has('select 1 from invites where person_id = $1', [keep.id]), 1);
  assert.equal(await has('select 1 from surveys where person_id = $1', [keep.id]), 1);
  // Источник даты рождения — один (повтор убран), достоверность — у выбранного значения (дата со второй карточки: «документ»).
  assert.equal(await has("select 1 from citations where subject = 'person' and subject_id = $1 and fact = 'birth_date'", [keep.id]), 1);
  assert.equal((await q("select quality from fact_quality where subject = 'person' and subject_id = $1 and fact = 'birth_date'", [keep.id]))[0].quality, 'document');
  assert.equal(await has("select 1 from fact_quality where subject = 'person' and subject_id = $1 and fact = 'birth_place'", [keep.id]), 1);
  // Поля и фото.
  const k = (await q('select * from persons where id = $1', [keep.id]))[0];
  assert.equal(k.birth_date, '12.03.1950');
  assert.equal(k.patronymic, 'Ринатович');
  assert.equal(k.occupation, 'инженер');
  assert.equal(k.birth_place, 'Казань');
  assert.equal(k.photo_id, m2.id);
  // Связи: один брак с Лилией, в нём оба ребёнка без повтора; сведения о браке и его источник — со слитого брака.
  const fams = await q('select * from families where partner1 = $1 or partner2 = $1', [keep.id]);
  assert.equal(fams.length, 1);
  assert.equal(fams[0].start_date, '1975');
  assert.deepEqual((await q('select child_id from family_children where family_id = $1 order by child_id', [fams[0].id])).map((r) => r.child_id), [kid1.id, kid2.id].sort());
  assert.equal(await has("select 1 from citations where subject = 'family' and subject_id = $1", [fams[0].id]), 1);
  // Родители: свои (Ринат и Гузель) и отец со второй карточки — по проверке «больше двух родителей», не молча.
  const after1 = await json(owner, 'GET', '/api/tree');
  assert.ok(checkTree(after1).some((f) => f.kind === 'many_parents' && f.persons.includes(keep.id)));
  assert.equal(await has('select 1 from family_children where child_id = $1', [keep.id]), 2);
  assert.ok(!(await q('select 1 from families where partner1 = partner2')).length);
  // Сестра по-прежнему сестра.
  assert.equal(await has('select 1 from family_children a join family_children b on a.family_id = b.family_id where a.child_id = $1 and b.child_id = $2', [keep.id, sister.id]), 1);
  // В журнале — одно действие, подпись объединения первой.
  const [op] = await json(owner, 'GET', '/api/changes');
  assert.equal(op.entries[0].action, 'merge');
  assert.equal(op.entries[0].after.from, remove.id);
  // Гостю в ленте — только кто с кем.
  const feed = await json(guest, 'GET', '/api/feed');
  const fe = feed.items.find((i) => i.op === op.op).entries[0];
  assert.deepEqual(Object.keys(fe.after).sort(), ['from', 'into']);

  // Откат одной кнопкой — всё в точности как было.
  await json(owner, 'POST', `/api/changes/${op.id}/revert`);
  assert.deepEqual(await snapshot(), before0);

  // Повтор: откат отката — снова объединено, и снова откатывается в точности.
  const [undo] = await json(owner, 'GET', '/api/changes');
  await json(owner, 'POST', `/api/changes/${undo.id}/revert`);
  assert.ok((await q('select deleted_at from persons where id = $1', [remove.id]))[0].deleted_at);
  assert.equal(await has('select 1 from comments where person_id = $1', [keep.id]), 1);
  const [redo] = await json(owner, 'GET', '/api/changes');
  await json(owner, 'POST', `/api/changes/${redo.id}/revert`);
  assert.deepEqual(await snapshot(), before0);

  // Объединить снова, уже заново — тоже работает; карточку изменили между сравнением и объединением — 409.
  const cur = (await q('select version from persons where id = $1', [remove.id]))[0].version;
  assert.equal((await call(owner, 'POST', '/api/merge', { keep: keep.id, remove: remove.id, versions: { remove: cur + 1 } })).statusCode, 409);
  await json(owner, 'POST', '/api/merge', { keep: keep.id, remove: remove.id, choice });
  assert.equal((await call(owner, 'POST', '/api/merge', { keep: keep.id, remove: remove.id })).statusCode, 404);
});
