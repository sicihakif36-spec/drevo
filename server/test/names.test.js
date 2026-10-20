import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patronymicFrom, surnameFor, guessSex, kinshipTerm, lifespan } from '../../shared/names.js';
import { gedDate } from '../src/routes/export.js';

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
