import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patronymicFrom, surnameFor, guessSex, kinshipTerm, lifespan, isPrivate, exactDate, yearsText, upcomingDates, parsePeriod } from '../../shared/names.js';
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
  for (const t of ['около 1890', '1890', '03.1890', '31.02.1890', '12.03.1890 ст. ст.', '', null]) assert.equal(exactDate(t), null, t);
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
