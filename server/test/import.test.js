// Загрузка дерева из файла GEDCOM: разбор, предпросмотр с совпадениями, загрузка одним действием, откат, права, лента, скорость.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { signIn } from './helpers.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { parseGedcom, fromGedDate, splitPatronymic } from '../src/gedcom.js';
import { toGedcom, gedDate, gedPeriod } from '../src/routes/export.js';
import { loadTreeData } from '../src/routes/print.js';
import { sourceData } from '../src/routes/sources.js';
import { eventData } from '../src/routes/timeline.js';
import { listPlaces } from '../src/routes/places.js';
import { digestText } from '../src/push.js';
import { fullName, textHas, personHas, sameName, nameGenitive, nameAccusative, namePrepositional, patronymicFrom } from '../../shared/names.js';
import { findMatches } from '../../shared/survey.js';

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
function upload(cookie, data, name = 'семья.ged') {
  const b = 'drevo-import';
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.isBuffer(data) ? data : Buffer.from(data), Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return app.inject({ method: 'POST', url: '/api/import', payload, headers: { ...H, cookie, 'content-type': `multipart/form-data; boundary=${b}` } });
}
async function preview(data, name) {
  const r = await upload(owner, data, name);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const load = (id, plan = {}) => json(owner, 'POST', `/api/import/${id}/load`, plan);
const ged = (body) => `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n${body.trim()}\n0 TRLR\n`;
const tree = () => json(owner, 'GET', '/api/tree');
const byName = (t, n) => t.persons.find((p) => fullName(p) === n);

async function fresh() {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  if (app) await app.close();
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await login('owner', 'Анна');
  editor = await login('editor', 'Сергей');
  relative = await login('relative', 'Родня');
  guest = await login('viewer', 'Гость');
}

before(fresh);
after(async () => { await app.close(); await pool.end(); });

test('поиск и сравнение без различий татарских и русских букв', () => {
  assert.ok(textHas('Әминә', 'Амина'));
  assert.ok(textHas('Илһамия', 'Ильгамия'));
  assert.ok(textHas('Өлфәт', 'Ульфат'));
  assert.ok(textHas('Урманчеев Ринат', 'ренат урман'));
  assert.ok(textHas('Пётр', 'петр'));
  assert.ok(!textHas('Иван', 'Пётр'));
  assert.ok(personHas({ surname: 'Иванова', given: 'Мария', patronymic: '', birth_surname: 'Искәндәрова' }, 'искандарова'));
  assert.ok(sameName('Ренат', 'Ринат'));
  assert.ok(sameName('Габдулла', 'Габдула'));
  assert.ok(!sameName('Ренат', 'Марат'));
  // Склонения: татарское отчество и имена с татарскими буквами — как записаны.
  const amina = { given: 'Әминә', patronymic: 'Дәүләтшә кызы', sex: 'F' };
  assert.equal(nameGenitive(amina), 'Әминә Дәүләтшә кызы');
  assert.equal(nameAccusative(amina), 'Әминә Дәүләтшә кызы');
  assert.equal(namePrepositional(amina), 'Әминә Дәүләтшә кызы');
  assert.equal(nameGenitive({ given: 'Ринат', patronymic: 'Закир улы', sex: 'M' }), 'Рината Закир улы');
  assert.equal(nameGenitive({ given: 'Гульнара', patronymic: 'Ринатовна', sex: 'F' }), 'Гульнары Ринатовны');
  assert.equal(patronymicFrom('Дәүләтшә', 'F'), 'Дәүләтшә кызы');
  assert.equal(patronymicFrom('Илһам', 'M'), 'Илһам улы');
  assert.equal(patronymicFrom('Ринат', 'M'), 'Ринатович');
});

test('совпадения: татарские буквы, Ренат и Ринат, отчество по-татарски и по-русски', () => {
  const people = [
    { id: 'a', given: 'Әминә', patronymic: 'Дәүләтшә кызы', surname: 'Урманчеева', birth_surname: '', birth_date: '1931' },
    { id: 'b', given: 'Ринат', patronymic: 'Закирович', surname: 'Фазлыев', birth_surname: '', birth_date: '1950' },
    { id: 'c', given: 'Марат', patronymic: 'Закирович', surname: 'Фазлыев', birth_surname: '', birth_date: '1952' },
  ];
  assert.deepEqual(findMatches({ given: 'Амина', patronymic: 'Дәүләтшә кызы', surname: 'Урманчеева', birth_date: '1930' }, people).map((p) => p.id), ['a']);
  assert.deepEqual(findMatches({ given: 'Ренат', patronymic: 'Закир улы', surname: 'Фазлыев', birth_date: '1951' }, people).map((p) => p.id), ['b']);
  assert.deepEqual(findMatches({ given: 'Ренат', patronymic: 'Закирович', surname: 'Фазлыев', birth_date: '1970' }, people), []);
});

test('даты GEDCOM — в формат приложения и обратно', () => {
  const cases = [
    ['12 MAR 1890', '12.03.1890'], ['MAR 1890', '03.1890'], ['1890', '1890'], ['ABT 1930', 'около 1930'], ['EST 1930', 'около 1930'],
    ['CAL 1930', 'около 1930'], ['BEF 1917', 'до 1917'], ['AFT 2 JAN 1950', 'после 02.01.1950'], ['BET 1880 AND 1885', 'между 1880 и 1885'],
    ['FROM 1941 TO 1945', '1941–1945'], ['FROM 1950', 'с 1950'], ['TO 1960', 'до 1960'], ['(весна 1890)', 'весна 1890'],
    ['INT 1900 (со слов)', '1900'], ['@#DJULIAN@ 12 MAR 1880', '12.03.1880 ст. ст.'], ['1720/21', '1720'], ['вчера', 'вчера'], ['', ''],
  ];
  for (const [g, app] of cases) assert.equal(fromGedDate(g), app, g);
  for (const d of ['12.03.1890', '03.1890', 'около 1930', 'до 1895', 'после 1950', 'между 1880 и 1885', '12.03.1880 ст. ст.']) {
    assert.equal(fromGedDate(gedDate(d)), d, d);
  }
  assert.equal(fromGedDate(gedPeriod('1941–1945')), '1941–1945');
  assert.equal(fromGedDate(gedPeriod('с 1950')), 'с 1950');
});

test('разбор: имена, фамилия при рождении, события, источники, заметки', () => {
  const g = parseGedcom(Buffer.from(ged(`
0 @I1@ INDI
1 NAME Иван /Петров/
2 GIVN Иван
2 _PATR Петрович
2 SURN Петров
1 SEX M
1 BIRT
2 DATE ABT 1890
2 PLAC д. Горки
2 SOUR @S1@
3 PAGE запись № 5
3 QUAY 3
1 DEAT Y
1 OCCU кузнец
1 OCCU колхоз «Заря», бригадир
2 DATE FROM 1930 TO 1941
1 EDUC церковно-приходская школа
2 DATE 1900
1 _MILT
2 TYPE Война
2 DATE FROM 1914 TO 1917
2 NOTE Часть: 12-й полк
3 CONT Звание: унтер-офицер
1 RESI
2 PLAC г. Казань
2 DATE 1925
1 EVEN Георгиевский крест
2 TYPE Награда
1 EVEN
2 TYPE Построил дом
2 DATE 1928
1 CHR
2 DATE 5 MAR 1890
1 NOTE @N1@
1 NOTE Вторая заметка
1 OBJE @O1@
1 _FOO что-то
1 RELI мусульманин
1 FAMS @F1@
0 @I2@ INDI
1 NAME Әминә Дәүләтшә кызы /Урманчеева/
1 SEX F
1 BIRT
2 DATE 1931
1 NAME Әминә Дәүләтшә кызы /Искәндәрова/
2 TYPE birth
1 FAMS @F1@
0 @I3@ INDI
1 NAME Мария Ивановна /Сидорова/
2 _MARNM Петрова
1 BIRT
2 DATE 1925
0 @I4@ INDI
1 NAME Ринат /Фазлыев/
1 BIRT
2 DATE 1990
0 @I5@ INDI
1 NAME Старик /Никто/
1 BIRT
2 DATE 1880
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 1920
2 PLAC с. Горки
2 SOUR со слов
3 QUAY 1
1 DIV
2 DATE 1930
0 @N1@ NOTE Первая строка
1 CONT вторая строка
1 CONC  и её хвост
0 @S1@ SOUR
1 TITL Метрическая книга
1 AUTH Священник
1 ABBR НА РТ, ф. 4, оп. 1, д. 2, л. 3 об.
1 _TYPE Метрическая книга
1 NOTE https://example.org/kniga
`)));
  const [ivan, amina, maria, rinat, old] = g.persons;
  assert.equal(ivan.patronymic, 'Петрович');
  assert.equal(ivan.given, 'Иван');
  assert.equal(ivan.living, false);
  assert.equal(ivan.birth_date, 'около 1890');
  assert.equal(ivan.birth_place, 'д. Горки');
  assert.equal(ivan.occupation, 'кузнец');
  assert.match(ivan.notes, /Первая строка\nвторая строка и её хвост/);
  assert.match(ivan.notes, /Вторая заметка/);
  assert.match(ivan.notes, /Вероисповедание: мусульманин/);
  assert.deepEqual([amina.given, amina.patronymic, amina.surname, amina.birth_surname, amina.sex], ['Әминә', 'Дәүләтшә кызы', 'Урманчеева', 'Искәндәрова', 'F']);
  assert.deepEqual([maria.surname, maria.birth_surname, maria.patronymic, maria.sex], ['Петрова', 'Сидорова', 'Ивановна', 'F']);
  assert.equal(rinat.living, true);
  assert.equal(old.living, false, 'родился больше 110 лет назад');
  const kinds = g.events.map((e) => `${e.kind}:${e.title}:${e.date}`);
  assert.deepEqual(kinds, ['work:колхоз «Заря», бригадир:1930–1941', 'study:церковно-приходская школа:1900', 'war::1914–1917', 'move::1925',
    'award:Георгиевский крест:', 'other:Построил дом:1928', 'other:Крещение:05.03.1890']);
  const war = g.events.find((e) => e.kind === 'war');
  assert.deepEqual([war.unit, war.rank], ['12-й полк', 'унтер-офицер']);
  assert.equal(g.events.find((e) => e.kind === 'move').place, 'г. Казань');
  const [f] = g.families;
  assert.deepEqual([f.husb, f.wife, f.children[0].ref, f.start_date, f.place, f.ended, f.end_date], ['@I1@', '@I2@', '@I3@', '1920', 'с. Горки', 'divorce', '1930']);
  const s = g.sources[0];
  assert.deepEqual([s.title, s.kind, s.archive, s.fond, s.opis, s.delo, s.sheet, s.verso, s.url], ['Метрическая книга', 'metric', 'НА РТ', '4', '1', '2', '3', true, 'https://example.org/kniga']);
  assert.match(s.note, /Автор: Священник/);
  assert.deepEqual(g.citations, [{ subject: 'person', ref: '@I1@', fact: 'birth_date', sref: '@S1@', page: 'запись № 5' }]);
  assert.deepEqual(g.quality.map((x) => `${x.subject}:${x.fact}:${x.quality}`), ['person:birth_date:document', 'family:marriage:oral']);
  assert.deepEqual(g.skipped.map((x) => x.label).sort(), ['сведения с пометкой _FOO', 'фото и файлы (их можно добавить в альбом вручную)']);
  assert.deepEqual(splitPatronymic('Иван Петрович'), { given: 'Иван', patronymic: 'Петрович' });
  assert.deepEqual(splitPatronymic('Анна Мария'), { given: 'Анна Мария', patronymic: '' });
});

test('кодировки и битые файлы', () => {
  const text = ged('0 @I1@ INDI\n1 NAME Пётр /Сидоров/').replace('CHAR UTF-8', 'CHAR ANSI');
  const cp = Buffer.from(new Uint8Array([...text].map((ch) => {
    const c = ch.charCodeAt(0);
    if (c < 128) return c;
    if (c === 0x401) return 0xa8;
    if (c === 0x451) return 0xb8;
    return c - 0x410 + 0xc0;
  })));
  assert.equal(fullName(parseGedcom(cp).persons[0]), 'Сидоров Пётр');
  assert.equal(fullName(parseGedcom(Buffer.from(text.replace('CHAR ANSI', 'CHAR windows-1251'))).persons[0]), 'Сидоров Пётр');
  assert.throws(() => parseGedcom(Buffer.from('это не родословная\nа просто текст')), /не похоже на файл GEDCOM/);
  assert.throws(() => parseGedcom(Buffer.from(text.replace('CHAR ANSI', 'CHAR ANSEL'))), /ANSEL/);
});

test('права: владелец и участник — да; родственник, гость, без входа — нет', async () => {
  const file = ged('0 @I1@ INDI\n1 NAME Пётр /Сидоров/');
  for (const c of [relative, guest]) assert.equal((await upload(c, file)).statusCode, 403);
  assert.equal((await upload('', file)).statusCode, 401);
  const p = await preview(file);
  for (const c of [relative, guest]) {
    assert.equal((await call(c, 'POST', `/api/import/${p.id}/load`, {})).statusCode, 403);
    assert.equal((await call(c, 'DELETE', `/api/import/${p.id}`)).statusCode, 403);
  }
  assert.equal((await call('', 'POST', `/api/import/${p.id}/load`, {})).statusCode, 401);
  // Чужой незагруженный файл не виден ни участнику, ни владельцу.
  assert.equal((await call(editor, 'POST', `/api/import/${p.id}/load`, {})).statusCode, 404);
  assert.equal((await call(editor, 'DELETE', `/api/import/${p.id}`)).statusCode, 404);
  assert.equal((await call(owner, 'DELETE', `/api/import/${p.id}`)).statusCode, 200);
  assert.equal((await call(owner, 'POST', `/api/import/${p.id}/load`, {})).statusCode, 404);

  // Участник: свой файл — предпросмотр, «передумал», загрузка; отменить могут он сам и владелец.
  const e1 = await upload(editor, file);
  assert.equal(e1.statusCode, 200, e1.body);
  assert.equal((await call(owner, 'POST', `/api/import/${e1.json().id}/load`, {})).statusCode, 404, 'чужой файл');
  assert.equal((await call(editor, 'DELETE', `/api/import/${e1.json().id}`)).statusCode, 200);
  const n = (await tree()).persons.length;
  for (const who of [editor, owner]) {
    const e = (await upload(editor, file)).json();
    const res = await json(editor, 'POST', `/api/import/${e.id}/load`, {});
    assert.equal(res.persons, 1);
    assert.equal((await tree()).persons.length, n + 1);
    await json(who, 'POST', `/api/changes/${res.change}/revert`);
    assert.equal((await tree()).persons.length, n);
  }
});

// Сведения дерева без id, с именами вместо ссылок: так их можно сравнить до выгрузки и после загрузки.
async function snapshot() {
  const u = { role: 'owner' };
  const d = { ...(await loadTreeData(u)), ...(await sourceData(u)), ...(await eventData(u)) };
  const name = new Map(d.persons.map((p) => [p.id, fullName(p)]));
  const date = (x) => gedPeriod(x);
  const persons = d.persons.map((p) => ({
    name: fullName(p), sex: p.sex, living: p.living, birth_surname: p.birth_surname, birth: date(p.birth_date), birth_place: p.birth_place,
    death: date(p.death_date), death_place: p.death_place, burial_place: p.burial_place, occupation: p.occupation, notes: p.notes,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const families = d.families.map((f) => ({
    pair: [f.partner1, f.partner2].map((id) => name.get(id) || '').sort().join(' + '), kind: f.kind, date: date(f.start_date), place: f.place,
    ended: f.ended, children: d.children.filter((c) => c.family_id === f.id).map((c) => `${name.get(c.child_id)}:${c.kind}`).sort(),
  })).sort((a, b) => a.pair.localeCompare(b.pair));
  const events = d.events.map((e) => ({
    kind: e.kind, date: date(e.date), place: e.place, title: e.title, body: e.body, unit: e.unit, rank: e.rank, persons: e.persons.map((id) => name.get(id)).sort(),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const sources = d.sources.map((s) => ({ kind: s.kind, title: s.title, archive: s.archive, fond: s.fond, opis: s.opis, delo: s.delo, sheet: s.sheet, verso: s.verso, url: s.url, note: s.note }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const src = new Map(d.sources.map((s) => [s.id, s.title]));
  const subject = (c) => (c.subject === 'person' ? name.get(c.subject_id) : c.subject === 'event' ? 'событие' : 'семья');
  // Источник даты и места рождения в GEDCOM один — под BIRT: здесь их не различаем.
  const citations = [...new Set(d.citations.map((c) => `${subject(c)} ${c.fact.replace(/_(date|place)$/, '')} ${src.get(c.source_id)} ${c.page}`))].sort();
  return { persons, families, events, sources, citations, data: d };
}

test('круг: выгрузка демо-семьи -> загрузка в пустое дерево -> то же самое', async () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../bin/demo.js', import.meta.url))], { stdio: 'ignore' });
  const was = await snapshot();
  const file = toGedcom({ ...was.data, places: await listPlaces() });
  await fresh();
  const p = await preview(file, 'демо.ged');
  assert.equal(p.counts.persons, was.persons.length);
  assert.deepEqual(p.skipped, []);
  const res = await load(p.id);
  assert.equal(res.persons, was.persons.length);
  const now = await snapshot();
  for (const k of ['persons', 'families', 'events', 'sources', 'citations']) assert.deepEqual(now[k], was[k], k);
  // Достоверность — так же, по событию GEDCOM.
  const qual = (d) => [...new Set(d.data.quality.map((x) => `${x.subject} ${x.fact.replace(/_(date|place)$/, '')} ${x.quality}`))].sort();
  assert.deepEqual(qual(now), qual(was));
  assert.ok(qual(now).length >= 5);
});

test('совпадения в предпросмотре, «это он» — только пустые поля, связи не дублируются', async () => {
  await fresh();
  const mk = (person, relation) => json(owner, 'POST', '/api/persons', { person, relation });
  const zakir = await mk({ given: 'Закир', surname: 'Фазлыев', sex: 'M', living: false, birth_date: '1920', occupation: 'учитель' });
  const gulsum = await mk({ given: 'Гөлсем', surname: 'Фазлыева', sex: 'F', living: false }, { to: zakir.id, type: 'spouse' });
  const rinat = await mk({ given: 'Ринат', patronymic: 'Закирович', surname: 'Фазлыев', sex: 'M', living: true, birth_date: '1950' }, { to: zakir.id, type: 'child' });
  const t0 = await tree();
  const file = ged(`
0 @I1@ INDI
1 NAME Закир /Фазлыев/
1 SEX M
1 BIRT
2 DATE 1921
2 PLAC с. Кукмор
1 DEAT
2 DATE 1990
1 OCCU директор школы
0 @I2@ INDI
1 NAME Гульсум /Фазлыева/
1 SEX F
0 @I3@ INDI
1 NAME Ренат Закир улы /Фазлыев/
1 SEX M
1 BIRT
2 DATE 1951
0 @I4@ INDI
1 NAME Әлфия Закировна /Фазлыева/
1 SEX F
1 BIRT
2 DATE 1955
0 @I5@ INDI
1 NAME Чужой /Человек/
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CHIL @I4@
1 MARR
2 DATE 1948
`);
  const p = await preview(file);
  const cand = Object.fromEntries(p.people.map((x) => [x.ref, x.cands]));
  assert.deepEqual(cand['@I1@'], [zakir.id]);
  assert.deepEqual(cand['@I3@'], [rinat.id]);
  assert.deepEqual(cand['@I4@'], []);
  // Гульсум и Гөлсем без годов и отчества — подсказки нет (мало сведений), выбираем вручную.
  const res = await load(p.id, { people: {
    '@I1@': { action: 'match', person_id: zakir.id, replace: [] },
    '@I2@': { action: 'match', person_id: gulsum.id },
    '@I3@': { action: 'match', person_id: rinat.id },
    '@I5@': { action: 'skip' },
  } });
  assert.deepEqual([res.persons, res.matched, res.families], [1, 3, 0]);
  const t = await tree();
  const z = t.persons.find((x) => x.id === zakir.id);
  assert.deepEqual([z.birth_date, z.birth_place, z.occupation, z.living, z.death_date], ['1920', 'с. Кукмор', 'учитель', false, '1990']);
  assert.equal(t.persons.find((x) => x.id === rinat.id).patronymic, 'Закирович');
  assert.equal(t.persons.length, t0.persons.length + 1);
  assert.equal(t.families.length, t0.families.length, 'семья Закира и Гөлсем дополнена, а не заведена вторая');
  const fam = t.families[0];
  assert.equal(fam.start_date, '1948');
  assert.equal(t.children.filter((c) => c.family_id === fam.id).length, 2);
  assert.ok(!t.persons.some((x) => x.given === 'Чужой'));

  // Тот же файл ещё раз с «заменить»: непустое меняется только по отметке.
  const p2 = await preview(file);
  const alfia = t.persons.find((x) => x.given === 'Әлфия');
  const r2 = await load(p2.id, { people: Object.fromEntries([['@I1@', zakir.id, ['birth_date']], ['@I2@', gulsum.id], ['@I3@', rinat.id], ['@I4@', alfia.id]]
    .map(([ref, id, replace]) => [ref, { action: 'match', person_id: id, replace }]).concat([['@I5@', { action: 'skip' }]])) });
  assert.equal(r2.persons, 0);
  const t2 = await tree();
  assert.equal(t2.persons.find((x) => x.id === zakir.id).birth_date, '1921');
  assert.deepEqual([t2.families.length, t2.children.length], [t.families.length, t.children.length]);
  // Дважды один и тот же человек из дерева — ошибка.
  const p3 = await preview(file);
  const bad = await call(owner, 'POST', `/api/import/${p3.id}/load`, { people: { '@I1@': { action: 'match', person_id: zakir.id }, '@I3@': { action: 'match', person_id: zakir.id } } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /дважды/);
});

test('откат загрузки целиком и возврат; лента — одна запись, уведомление — одной сводкой', async () => {
  await fresh();
  const was = await tree();
  const file = ged(Array.from({ length: 30 }, (_, i) => `0 @I${i}@ INDI\n1 NAME Человек${i} /Урманчеев/\n1 BIRT\n2 DATE ${1900 + i}\n2 SOUR @S1@\n1 EDUC школа ${i}\n2 DATE ${1910 + i}`).join('\n')
    + '\n0 @F1@ FAM\n1 HUSB @I0@\n1 WIFE @I1@\n' + Array.from({ length: 28 }, (_, i) => `1 CHIL @I${i + 2}@`).join('\n') + '\n0 @S1@ SOUR\n1 TITL Записи отца');
  const p = await preview(file);
  const res = await load(p.id);
  assert.equal(res.persons, 30);
  const feed = await json(owner, 'GET', '/api/feed');
  const ops = feed.items.filter((x) => x.kind === 'op');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entries[0].entity, 'import');
  assert.deepEqual(ops[0].entries[0].after, { file: 'семья.ged', persons: 30, matched: 0, families: 1, events: 30, sources: 1 });
  const gfeed = await json(guest, 'GET', '/api/feed');
  assert.equal(gfeed.items.filter((x) => x.kind === 'op').length, 1);
  const entries = (await q('select c.op, c.entity, c.entity_id, c.action, c.before, c.after from changes c order by id'));
  assert.equal(digestText('Анна', 'F', entries, [entries[0].op]), 'Анна загрузила из файла 30 человек');

  const r = await call(owner, 'POST', `/api/changes/${res.change}/revert`);
  assert.equal(r.statusCode, 200, r.body);
  const back = await tree();
  assert.deepEqual([back.persons.length, back.families.length, back.children.length], [was.persons.length, was.families.length, was.children.length]);
  assert.equal((await q('select count(*)::int as n from life_events where deleted_at is null'))[0].n, 0);
  assert.equal((await q('select count(*)::int as n from sources where deleted_at is null'))[0].n, 0);
  assert.equal((await q('select count(*)::int as n from citations'))[0].n, 0);
  // Отмену можно отменить — всё возвращается.
  const undo = (await q('select min(id) as id from changes where id > $1 and entity = $2', [res.change, 'import']))[0].id;
  const rr = await call(owner, 'POST', `/api/changes/${undo}/revert`);
  assert.equal(rr.statusCode, 200, rr.body);
  const again = await tree();
  assert.equal(again.persons.length, 30);
  assert.equal(again.children.length, 28);
});

test('3000 человек: загрузка, отзывчивость сервера, откат', async () => {
  await fresh();
  const N = 3000;
  const lines = [];
  for (let i = 0; i < N; i++) {
    lines.push(`0 @I${i}@ INDI`, `1 NAME Имя${i} Отчество${i}ович /Фамилия${i % 50}/`, `1 SEX ${i % 2 ? 'F' : 'M'}`, '1 BIRT', `2 DATE ${1850 + (i % 150)}`, '2 PLAC д. Горки',
      '2 SOUR @S1@', `3 PAGE л. ${i}`, '1 OCCU крестьянин', '1 EDUC школа', `2 DATE ${1860 + (i % 150)}`, '1 NOTE Заметка');
  }
  for (let i = 0; i + 2 < N; i += 3) lines.push(`0 @F${i}@ FAM`, `1 HUSB @I${i}@`, `1 WIFE @I${i + 1}@`, `1 CHIL @I${i + 2}@`, '1 MARR', '2 DATE 1900');
  lines.push('0 @S1@ SOUR', '1 TITL Ревизская сказка');
  const file = ged(lines.join('\n'));
  let t = Date.now();
  const p = await preview(file);
  const previewMs = Date.now() - t;
  assert.equal(p.people.length, N);
  t = Date.now();
  const loading = load(p.id);
  // Пока идёт загрузка, сервер отвечает другим.
  const pings = [];
  let done = false;
  loading.finally(() => { done = true; });
  while (!done) {
    const s = Date.now();
    await json(guest, 'GET', '/api/tree');
    pings.push(Date.now() - s);
    await new Promise((r) => setTimeout(r, 200));
  }
  const res = await loading;
  const loadMs = Date.now() - t;
  assert.equal(res.persons, N);
  t = Date.now();
  const r = await call(owner, 'POST', `/api/changes/${res.change}/revert`);
  assert.equal(r.statusCode, 200, r.body);
  const revertMs = Date.now() - t;
  const feed = await json(owner, 'GET', '/api/feed');
  assert.ok(feed.items.every((x) => x.kind !== 'op' || x.entries.length <= 300));
  console.log(`3000 человек: предпросмотр ${previewMs} мс, загрузка ${loadMs} мс, откат ${revertMs} мс, ответ сервера во время загрузки — до ${Math.max(...pings)} мс`);
  assert.ok(Math.max(...pings) < 2000);
});
