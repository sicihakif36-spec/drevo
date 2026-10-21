import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  patronymicFrom, surnameFor, guessSex, kinshipTerm, lifespan, isPrivate, exactDate, yearsText, upcomingDates, parsePeriod,
  toNewStyle, dateText, isOldStyle, withOldStyle, canBeOldStyle, parseDate,
} from '../../shared/names.js';
import { placeTitle, placeKey, suggestPlaces } from '../../shared/places.js';
import { gedDate, gedPeriod } from '../src/routes/export.js';

test('отчества', () => {
  const cases = [['Иван', 'Иванович', 'Ивановна'], ['Андрей', 'Андреевич', 'Андреевна'], ['Юрий', 'Юрьевич', 'Юрьевна'],
    ['Игорь', 'Игоревич', 'Игоревна'], ['Илья', 'Ильич', 'Ильинична'], ['Никита', 'Никитич', 'Никитична'],
    ['Пётр', 'Петрович', 'Петровна'], ['Михаил', 'Михайлович', 'Михайловна'], ['Сергей', 'Сергеевич', 'Сергеевна']];
  for (const [n, m, f] of cases) {
    assert.equal(patronymicFrom(n, 'M'), m);
    assert.equal(patronymicFrom(n, 'F'), f);
  }
});

test('фамилии и пол', () => {
  assert.equal(surnameFor('Смирнов', 'F'), 'Смирнова');
  assert.equal(surnameFor('Вишневский', 'F'), 'Вишневская');
  assert.equal(surnameFor('Смирнова', 'M'), 'Смирнов');
  assert.equal(surnameFor('Черных', 'F'), 'Черных');
  assert.equal(guessSex('Мария', ''), 'F');
  assert.equal(guessSex('Илья', ''), 'M');
  assert.equal(guessSex('Саша', 'Петровна'), 'F');
  assert.equal(guessSex('Любовь', ''), 'F');
});

test('родство и даты', () => {
  assert.equal(kinshipTerm(2, 0, 'M', 'mother'), 'дед по матери');
  assert.equal(kinshipTerm(3, 0, 'F', 'father'), 'прабабушка по отцу');
  assert.equal(kinshipTerm(2, 2, 'F'), 'двоюродная сестра');
  assert.equal(kinshipTerm(2, 1, 'M'), 'дядя');
  assert.equal(lifespan({ living: false, birth_date: 'около 1880', death_date: '1942' }), '~1880 – 1942');
  assert.equal(gedDate('12.03.1890'), '12 MAR 1890');
  assert.equal(gedDate('между 1880 и 1885'), 'BET 1880 AND 1885');
  assert.equal(gedDate('весна 1943'), '(весна 1943)');
});

test('чьи данные скрывать от гостей', () => {
  assert.equal(isPrivate({ living: true, birth_date: '1990' }, 2026), true);
  assert.equal(isPrivate({ living: true, birth_date: '' }, 2026), true);
  assert.equal(isPrivate({ living: true, birth_date: 'около 1900' }, 2026), false);
  assert.equal(isPrivate({ living: false, birth_date: '1990' }, 2026), false);
});

test('точные даты и ближайшие памятные дни', () => {
  assert.deepEqual(exactDate('12.03.1890'), { day: 12, month: 3, year: 1890 });
  assert.deepEqual(exactDate(' 1.2.1990 '), { day: 1, month: 2, year: 1990 });
  for (const t of ['около 1890', '1890', '03.1890', '31.02.1890', '1890 ст. ст.', '', null]) assert.equal(exactDate(t), null, t);
  assert.equal(yearsText(1), '1 год');
  assert.equal(yearsText(22), '22 года');
  assert.equal(yearsText(28), '28 лет');
  assert.equal(yearsText(111), '111 лет');
  assert.equal(yearsText(12), '12 лет');

  const today = new Date(2026, 9, 21);
  const people = [
    { id: 'anna', given: 'Анна', living: true, birth_date: '25.10.1998' },
    { id: 'today', given: 'Борис', living: true, birth_date: '21.10.1976' },
    { id: 'far', given: 'Вера', living: true, birth_date: '25.12.1990' },
    { id: 'past', given: 'Глеб', living: true, birth_date: '20.10.1990' },
    { id: 'approx', given: 'Дарья', living: true, birth_date: 'около 1950' },
    { id: 'gone', given: 'Иван', living: false, birth_date: '01.11.1926', death_date: '05.11.1976' },
    { id: 'hidden', given: 'Гость не видит', living: true, birth_date: '' },
  ];
  const got = upcomingDates(people, today).map((x) => [x.person.id, x.kind, x.day, x.month, x.inDays, x.years, x.round]);
  assert.deepEqual(got, [
    ['today', 'birthday', 21, 10, 0, 50, true],
    ['anna', 'birthday', 25, 10, 4, 28, false],
    ['gone', 'birth', 1, 11, 11, 100, true],
    ['gone', 'death', 5, 11, 15, 50, true],
  ]);

  // Через Новый год и 29 февраля.
  const dec = upcomingDates([{ given: 'Е', living: true, birth_date: '05.01.2000' }, { given: 'Ж', living: true, birth_date: '29.02.2000' }], new Date(2026, 11, 28), 70);
  assert.deepEqual(dec.map((x) => [x.day, x.month, x.years, x.inDays]), [[5, 1, 27, 8], [28, 2, 27, 62]]);
});

test('даты и периоды ленты жизни: по первому году, приблизительные и периоды, без даты', () => {
  const cases = [
    ['1941–1945', { from: '1941', to: '1945', since: false, year: 1941 }],
    ['1941-1945', { from: '1941', to: '1945', since: false, year: 1941 }],
    ['с 1950 по 1962', { from: '1950', to: '1962', since: false, year: 1950 }],
    ['с 1950 до 1962', { from: '1950', to: '1962', since: false, year: 1950 }],
    ['с 22.06.1941 по 9.05.1945', { from: '22.06.1941', to: '9.05.1945', since: false, year: 1941 }],
    ['с 1950', { from: '1950', to: '', since: true, year: 1950 }],
    ['около 1930', { from: 'около 1930', to: '', since: false, year: 1930 }],
    ['между 1880 и 1885', { from: '1880', to: '1885', since: false, year: 1880 }],
    ['1960-е', { from: '1960-е', to: '', since: false, year: 1960 }],
    ['сентябрь 1941', { from: 'сентябрь 1941', to: '', since: false, year: 1941 }],
  ];
  for (const [text, want] of cases) {
    const { key, ...got } = parsePeriod(text);
    assert.deepEqual(got, want, text);
  }
  assert.equal(parsePeriod(''), null);
  assert.equal(parsePeriod('после войны'), null);
  // Порядок: год, потом месяц и день; без месяца — в начале года.
  const order = ['около 1930', 'с 22.06.1941 по 9.05.1945', '1941', 'март 1942', '05.1943', '12.03.1943', 'лето 1960']
    .sort((a, b) => parsePeriod(a).key - parsePeriod(b).key);
  assert.deepEqual(order, ['около 1930', '1941', 'с 22.06.1941 по 9.05.1945', 'март 1942', '12.03.1943', '05.1943', 'лето 1960']);
});

test('период в GEDCOM: FROM … TO …', () => {
  assert.equal(gedPeriod('1941–1945'), 'FROM 1941 TO 1945');
  assert.equal(gedPeriod('с 22.06.1941 по 9.05.1945'), 'FROM 22 JUN 1941 TO 9 MAY 1945');
  assert.equal(gedPeriod('с 1950'), 'FROM 1950');
  assert.equal(gedPeriod('около 1941 – 1945'), 'FROM 1941 TO 1945');
  assert.equal(gedPeriod('май 1942 – 1945'), 'FROM 1942 TO 1945');
  assert.equal(gedPeriod('около 1930'), 'ABT 1930');
  assert.equal(gedPeriod('между 1880 и 1885'), 'BET 1880 AND 1885');
  assert.equal(gedPeriod('12.03.1943'), '12 MAR 1943');
});

test('старый стиль: перевод в новый на границах веков', () => {
  const ns = (day, month, year) => toNewStyle({ day, month, year });
  // До 1700 — 10 дней, в XVIII веке — 11, в XIX — 12, в XX — 13; разница растёт с 29 февраля юлианского года.
  assert.deepEqual(ns(1, 1, 1650), { day: 11, month: 1, year: 1650 });
  assert.deepEqual(ns(28, 2, 1700), { day: 10, month: 3, year: 1700 });
  assert.deepEqual(ns(29, 2, 1700), { day: 11, month: 3, year: 1700 });
  assert.deepEqual(ns(1, 3, 1700), { day: 12, month: 3, year: 1700 });
  assert.deepEqual(ns(28, 2, 1800), { day: 11, month: 3, year: 1800 });
  assert.deepEqual(ns(29, 2, 1800), { day: 12, month: 3, year: 1800 });
  assert.deepEqual(ns(28, 2, 1900), { day: 12, month: 3, year: 1900 });
  assert.deepEqual(ns(29, 2, 1900), { day: 13, month: 3, year: 1900 });
  assert.deepEqual(ns(26, 5, 1799), { day: 6, month: 6, year: 1799 }); // Пушкин
  assert.deepEqual(ns(25, 10, 1917), { day: 7, month: 11, year: 1917 });
  assert.deepEqual(ns(31, 1, 1918), { day: 13, month: 2, year: 1918 }); // следующий день — 14.02.1918
  assert.deepEqual(ns(25, 12, 1890), { day: 6, month: 1, year: 1891 });
  // 1600 — високосный в обоих календарях: разница не меняется.
  assert.deepEqual(ns(29, 2, 1600), { day: 10, month: 3, year: 1600 });

  // 29 февраля 1900 есть только в юлианском календаре.
  assert.deepEqual(exactDate('29.02.1900 ст. ст.'), { day: 13, month: 3, year: 1900, old: { day: 29, month: 2, year: 1900 } });
  assert.equal(exactDate('29.02.1900'), null);
  assert.deepEqual(exactDate('12.03.1890 ст. ст.'), { day: 24, month: 3, year: 1890, old: { day: 12, month: 3, year: 1890 } });
  assert.deepEqual(exactDate('12.03.1890 ст.ст.'), { day: 24, month: 3, year: 1890, old: { day: 12, month: 3, year: 1890 } });
  // После 31.01.1918 старого стиля не было.
  assert.equal(exactDate('01.02.1918 ст. ст.'), null);
  assert.equal(exactDate('30.02.1890 ст. ст.'), null);
});

test('старый стиль: пометка в тексте, показ в обоих стилях, годовщины по новому', () => {
  assert.equal(isOldStyle('12.03.1890 ст. ст.'), true);
  assert.equal(isOldStyle('12.03.1890'), false);
  assert.equal(withOldStyle('12.03.1890', true), '12.03.1890 ст. ст.');
  assert.equal(withOldStyle('12.03.1890 ст. ст.', true), '12.03.1890 ст. ст.');
  assert.equal(withOldStyle('12.03.1890 ст. ст.', false), '12.03.1890');
  assert.equal(withOldStyle('', true), '');
  assert.equal(canBeOldStyle('12.03.1890'), true);
  assert.equal(canBeOldStyle('1914–1918'), true);
  assert.equal(canBeOldStyle('1950'), false);
  assert.equal(canBeOldStyle('около'), false);
  // Старые записи читаются как раньше; «ст. ст.» больше не делает дату приблизительной.
  assert.deepEqual(parseDate('1890 ст. ст.'), { year: 1890, approx: false, text: '1890 ст. ст.' });

  assert.equal(dateText('12.03.1890 ст. ст.'), '12 (24) марта 1890');
  assert.equal(dateText('20.02.1890 ст. ст.'), '20 февраля (4 марта) 1890');
  assert.equal(dateText('25.12.1890 ст. ст.'), '25 декабря 1890 (6 января 1891)');
  assert.equal(dateText('12.03.1890'), '12.03.1890');
  assert.equal(dateText('около 1890 ст. ст.'), 'около 1890 ст. ст.');
  assert.equal(dateText(''), '');

  // Годовщина рождения по новому стилю: 12 марта ст. ст. — 24 марта.
  const people = [{ id: 'ivan', given: 'Иван', living: false, birth_date: '12.03.1890 ст. ст.' }];
  assert.deepEqual(upcomingDates(people, new Date(2026, 2, 12), 0), []);
  const [d] = upcomingDates(people, new Date(2026, 2, 24), 0);
  assert.deepEqual({ kind: d.kind, day: d.day, month: d.month, years: d.years }, { kind: 'birth', day: 24, month: 3, years: 136 });
  // Год по новому стилю: 25.12.1890 ст. ст. — 6 января 1891.
  const [n] = upcomingDates([{ id: 'n', living: false, birth_date: '25.12.1890 ст. ст.' }], new Date(2027, 0, 6), 0);
  assert.equal(n.years, 136);

  // Лента жизни: порядок по новому стилю, период со старым стилем.
  const keys = ['20.03.1890', '12.03.1890 ст. ст.', '25.03.1890'].sort((a, b) => parsePeriod(a).key - parsePeriod(b).key);
  assert.deepEqual(keys, ['20.03.1890', '12.03.1890 ст. ст.', '25.03.1890']);
  const p = parsePeriod('с 01.09.1905 ст. ст. по 1910');
  assert.deepEqual([p.from, p.to, p.year], ['01.09.1905 ст. ст.', '1910', 1905]);
  assert.equal(p.key, 19050914);
});

test('старый стиль в GEDCOM: @#DJULIAN@', () => {
  assert.equal(gedDate('12.03.1890 ст. ст.'), '@#DJULIAN@ 12 MAR 1890');
  assert.equal(gedDate('около 1890 ст. ст.'), 'ABT @#DJULIAN@ 1890');
  assert.equal(gedDate('03.1890 ст. ст.'), '@#DJULIAN@ MAR 1890');
  assert.equal(gedDate('между 1880 и 1885 ст. ст.'), 'BET @#DJULIAN@ 1880 AND @#DJULIAN@ 1885');
  assert.equal(gedDate('весна 1890 ст. ст.'), '(весна 1890 ст. ст.)');
  assert.equal(gedPeriod('с 01.09.1905 ст. ст. по 1910'), 'FROM @#DJULIAN@ 1 SEP 1905 TO 1910');
});

test('места: полное название, сравнение и подсказка', () => {
  const gorki = { kind: 'village', name: 'Горки', volost: 'Ивановская', uezd: 'Старицкий', gubernia: 'Тверская', country: 'Россия' };
  assert.equal(placeTitle(gorki), 'деревня Горки, Ивановская волость, Старицкий уезд, Тверская губерния');
  assert.equal(placeTitle({ kind: 'town', name: 'Старица', uezd: 'Старицкого уезда', gubernia: 'Тверская губ.' }), 'город Старица, Старицкого уезда, Тверская губ.');
  assert.equal(placeTitle({ kind: 'other', name: 'Варшава', country: 'Польша' }), 'Варшава, Польша');
  assert.equal(placeKey('  Деревня  ГОРКИ, Старицкий уезд '), 'деревня горки, старицкий уезд');
  assert.equal(placeKey('Ёлкино'), placeKey('елкино'));

  const places = [{ id: 1, title: placeTitle(gorki), now: 'Старицкий район, Тверская область' }];
  const used = ['д. Горки', 'Старица', 'деревня Горки, Ивановская волость, Старицкий уезд, Тверская губерния'];
  assert.deepEqual(suggestPlaces('горки', places, used).map((s) => [s.text, Boolean(s.place)]),
    [[places[0].title, true], ['д. Горки', false]]);
  // Подсказка ищет и по тому, как это сейчас.
  assert.deepEqual(suggestPlaces('тверская обл', places, used).map((s) => s.text), [places[0].title]);
  assert.deepEqual(suggestPlaces('стариц', places, used).map((s) => s.text), [places[0].title, 'Старица']);
  assert.deepEqual(suggestPlaces('', places, used), []);
});
