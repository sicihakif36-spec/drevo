// «Всё дерево»: каждый человек связной части ровно один раз, дети ниже родителей, супруги в одном ряду рядом,
// рамки не налезают, линии не идут сквозь рамки; три рода с браками, два брака, вдова замужем второй раз, брак двоюродных, 7 поколений;
// запутанные случаи (брак дяди с племянницей, с собственным внуком) не ломают раскладку; скорость на 1000 и 4000;
// с кого начинать дерево. Прежние режимы (предки, потомки, прямая линия) не изменились.
// «Родня» по отцу, по матери, по деду и бабушке: только кровные с мужьями и жёнами, поколения вверх, печать.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, fullName, shortGenitive } from '../../shared/names.js';
import { BOX, layoutTree } from '../../shared/layout.js';
import { homePerson, treeParts, layoutWhole } from '../../shared/wholetree.js';
import { kinLines, kinOf } from '../../shared/kin.js';
import { clans, randomTree } from './fixtures/clans.js';
import { PassThrough } from 'node:stream';
import { parsePrintOptions, renderPdf } from '../src/routes/print.js';

// Проверки раскладки: возвращает узлы по id.
function check(idx, L, ids) {
  const at = new Map();
  for (const n of L.nodes) {
    assert.ok(!at.has(n.id), `${fullName(idx.persons.get(n.id))} нарисован дважды`);
    at.set(n.id, n);
  }
  assert.equal(at.size, ids.length, 'на месте все люди связной части');
  for (const id of ids) assert.ok(at.has(id));
  // рамки не налезают
  const rows = new Map();
  for (const n of L.nodes) {
    if (!rows.has(n.y)) rows.set(n.y, []);
    rows.get(n.y).push(n);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) assert.ok(row[i].x - row[i - 1].x >= BOX.w + BOX.hgap - 0.01, 'рамки рядом не налезают');
  }
  // линии не проходят сквозь рамки (концы — у края рамки)
  for (const e of L.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const [[x1, y1], [x2, y2]] = [e.points[i - 1], e.points[i]];
      for (const row of rows.values()) {
        if (Math.min(y1, y2) >= row[0].y + BOX.h - 1 || Math.max(y1, y2) <= row[0].y + 1) continue;
        for (const n of row) assert.ok(Math.min(x1, x2) >= n.x + BOX.w - 1 || Math.max(x1, x2) <= n.x + 1, 'линия не проходит сквозь рамку');
      }
    }
  }
  let couples = 0;
  for (const f of idx.families.values()) {
    const p = [f.partner1, f.partner2].filter((id) => at.has(id));
    if (p.length === 2) {
      const [a, b] = p.map((id) => at.get(id));
      assert.equal(a.y, b.y, 'супруги в одном ряду');
      couples++;
    }
    for (const c of f.children) for (const id of p) if (at.has(c)) assert.ok(at.get(c).y > at.get(id).y, 'дети ниже родителей');
  }
  return { at, couples };
}

// Супруги рядом: между ними никого, кроме других супругов того же человека.
function adjacent(at, a, b) {
  const [x, y] = [at.get(a), at.get(b)];
  return x.y === y.y && Math.abs(x.x - y.x) === BOX.w + BOX.hgap;
}

test('три рода, связанные браками: все на месте ровно один раз, особые случаи', () => {
  const data = clans();
  const idx = buildIndex(data);
  const { list } = treeParts(idx);
  assert.equal(list.length, 1, 'три рода связаны в одно дерево');
  assert.ok(data.persons.length >= 170 && data.persons.length <= 230, `около 190 человек: ${data.persons.length}`);
  const root = homePerson(idx);
  const t = performance.now();
  const L = layoutTree(idx, root, { mode: 'all' });
  const ms = performance.now() - t;
  assert.ok(ms < 300, `200 человек — мгновенно: ${ms.toFixed(0)} мс`);
  const { at } = check(idx, L, list[0]);
  assert.equal(new Set(L.nodes.map((n) => n.y)).size, 7, '7 поколений — 7 рядов');
  assert.equal(L.nodes.filter((n) => n.root).map((n) => n.id).join(), root);
  assert.equal(L.others, 0);

  const { twoWives, remarried, cousins } = data.special;
  // мужчина с двумя жёнами: обе рядом с ним, по разные стороны; дети каждой — под своей парой
  const wives = [...idx.families.values()].filter((f) => f.partner1 === twoWives);
  assert.equal(wives.length, 2);
  for (const f of wives) assert.ok(adjacent(at, twoWives, f.partner2), 'жена рядом с мужем');
  const side = wives.map((f) => Math.sign(at.get(f.partner2).x - at.get(twoWives).x));
  assert.deepEqual(side.sort(), [-1, 1]);
  // дети каждой жены — со своей стороны (кто ушёл в семью мужа или жены — у той семьи)
  const median = (a) => a.sort((p, q) => p - q)[Math.floor((a.length - 1) / 2)];
  const kidsX = wives.map((f) => median(f.children.map((c) => at.get(c).x)));
  const wifeX = wives.map((f) => at.get(f.partner2).x);
  assert.equal(Math.sign(kidsX[0] - kidsX[1]), Math.sign(wifeX[0] - wifeX[1]), 'дети под своей парой');
  // вдова вышла второй раз: оба мужа рядом с ней
  for (const f of [...idx.families.values()].filter((x) => x.partner2 === remarried)) assert.ok(adjacent(at, remarried, f.partner1));
  // брак двоюродных: пара рядом, оба один раз
  assert.ok(cousins && adjacent(at, ...cousins), 'двоюродные — рядом');
});

test('случайные деревья на 1000 и 4000 человек: все на месте, без наложений, быстро', () => {
  for (const [n, limit] of [[1000, 600], [4000, 2500]]) {
    const idx = buildIndex(randomTree(n, n));
    const { list } = treeParts(idx);
    const root = homePerson(idx);
    const t = performance.now();
    const L = layoutWhole(idx, root);
    const ms = performance.now() - t;
    check(idx, L, list[0]);
    assert.ok(ms < limit, `${n} человек: ${ms.toFixed(0)} мс`);
    console.log(`# раскладка ${n} человек: ${ms.toFixed(0)} мс`);
    // второй раз — из запаса, другой выбранный человек той же части не пересчитывает раскладку
    const t2 = performance.now();
    const L2 = layoutWhole(idx, list[0][5], { anchor: root });
    assert.ok(performance.now() - t2 < 50);
    assert.deepEqual(L2.nodes.map((x) => [x.x, x.y]), L.nodes.map((x) => [x.x, x.y]));
  }
});

// Маленькое дерево из описания: [id, пол], семьи [муж, жена, [дети]].
function tiny(people, fams) {
  return {
    persons: people.map(([id, sex]) => ({ id, sex, given: id, surname: '', living: true })),
    families: fams.map(([a, b], i) => ({ id: `f${i}`, partner1: a, partner2: b })),
    children: fams.flatMap(([, , kids], i) => kids.map((c) => ({ family_id: `f${i}`, child_id: c }))),
  };
}

test('запутанные случаи: брак дяди с племянницей, с собственной внучкой, семья без родителей, одинокий родитель', () => {
  // дед и бабка -> сын и дочь; дочь -> внучка; сын женат на внучке (своей племяннице)
  let idx = buildIndex(tiny([['дед', 'M'], ['бабка', 'F'], ['сын', 'M'], ['дочь', 'F'], ['зять', 'M'], ['внучка', 'F'], ['правнук', 'M']],
    [['дед', 'бабка', ['сын', 'дочь']], ['зять', 'дочь', ['внучка']], ['сын', 'внучка', ['правнук']]]));
  let L = layoutWhole(idx, 'дед');
  check(idx, L, [...idx.persons.keys()]);
  // брак с собственной внучкой: связь по кругу не ломает раскладку, каждый один раз
  idx = buildIndex(tiny([['дед', 'M'], ['бабка', 'F'], ['сын', 'M'], ['сноха', 'F'], ['внучка', 'F'], ['ребёнок', 'M']],
    [['дед', 'бабка', ['сын']], ['сын', 'сноха', ['внучка']], ['дед', 'внучка', ['ребёнок']]]));
  L = layoutWhole(idx, 'сын');
  assert.equal(L.nodes.length, 6);
  assert.equal(new Set(L.nodes.map((n) => n.id)).size, 6);
  // семья без родителей (братья), одинокая мать, человек без связей — в своей части
  idx = buildIndex(tiny([['брат1', 'M'], ['брат2', 'M'], ['мать', 'F'], ['сын', 'M'], ['один', 'F']],
    [[null, null, ['брат1', 'брат2']], [null, 'мать', ['сын']]]));
  L = layoutWhole(idx, 'сын');
  check(idx, L, ['мать', 'сын']);
  assert.equal(L.others, 3);
  assert.equal(layoutWhole(idx, 'один').nodes.length, 1);
});

test('с кого начинать: сам вошедший, человек владельца, иначе — из самой большой части, не первый по алфавиту', () => {
  const data = clans();
  // маленькая отдельная семья «Аавы» — первая по алфавиту
  data.persons.unshift({ id: 'a1', sex: 'M', surname: 'Аав', given: 'Аарон', living: true }, { id: 'a2', sex: 'F', surname: 'Аав', given: 'Ада', living: true });
  data.families.push({ id: 'fa', partner1: 'a1', partner2: null });
  data.children.push({ family_id: 'fa', child_id: 'a2' });
  const idx = buildIndex(data);
  const big = treeParts(idx).list[0];
  const some = big[10];
  assert.equal(homePerson(idx, some, 'a1'), some);
  assert.equal(homePerson(idx, null, 'a1'), 'a1');
  assert.equal(homePerson(idx, 'нет-такого', undefined), homePerson(idx));
  const h = homePerson(idx);
  assert.ok(big.includes(h), 'из самой большой части');
  assert.notEqual(h, 'a1');
  assert.equal(homePerson(buildIndex({ persons: [], families: [], children: [] })), null);
  // «Ещё N человек не связаны с этой веткой»
  assert.equal(layoutWhole(idx, h).others, 2);
});

test('прежние режимы не изменились: предки, потомки, прямая линия', () => {
  const data = clans();
  const idx = buildIndex(data);
  const root = data.special.twoWives;
  for (const mode of ['ancestors', 'descendants', 'hourglass']) {
    const L = layoutTree(idx, root, { mode, up: 3, down: 2 });
    assert.ok(L.nodes.some((n) => n.id === root && n.root), mode);
    assert.ok(L.nodes.length > 2 && L.nodes.length < idx.persons.size, mode);
  }
});

test('печать всего дерева: на одном листе и плакатом — ровно столько листов, сколько в плане', async () => {
  const data = clans();
  for (const qs of [{ fit: 'page', paper: 'A1' }, { fit: 'tiles', paper: 'A4' }, { fit: 'tiles', paper: 'A3', scale: '60' }]) {
    const o = parsePrintOptions({ mode: 'all', ...qs });
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => out.on('end', r));
    const plan = renderPdf(out, data, o);
    await done;
    const pdf = Buffer.concat(chunks).toString('latin1');
    assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, plan.cols * plan.rows, JSON.stringify(qs));
    if (qs.fit === 'tiles') assert.ok(plan.cols > 1);
  }
});

// «Родня»: прадеды -> дед и его брат; бабка -> отец и тётя от деда, сын от второго мужа; отец + мать -> я и сестра;
// у матери — сын от первого мужа и брат; у тёти, брата деда и брата матери — свои дети.
function kinFamily() {
  return buildIndex(tiny(
    [['прадед', 'M'], ['прабабка', 'F'], ['дед', 'M'], ['бабка', 'F'], ['отчим отца', 'M'], ['брат деда', 'M'], ['его жена', 'F'], ['его сын', 'M'],
      ['отец', 'M'], ['тётя', 'F'], ['муж тёти', 'M'], ['двоюродный', 'M'], ['полудядя', 'M'],
      ['дед2', 'M'], ['бабка2', 'F'], ['мать', 'F'], ['первый муж', 'M'], ['полубрат', 'M'], ['дядя2', 'M'], ['жена дяди2', 'F'], ['двоюродная2', 'F'],
      ['я', 'M'], ['сестра', 'F'], ['жена', 'F'], ['сын', 'M']],
    [['прадед', 'прабабка', ['дед', 'брат деда']], ['брат деда', 'его жена', ['его сын']], ['дед', 'бабка', ['отец', 'тётя']], ['отчим отца', 'бабка', ['полудядя']],
      ['муж тёти', 'тётя', ['двоюродный']], ['дед2', 'бабка2', ['мать', 'дядя2']], ['первый муж', 'мать', ['полубрат']], ['дядя2', 'жена дяди2', ['двоюродная2']],
      ['отец', 'мать', ['я', 'сестра']], ['я', 'жена', ['сын']]],
  ));
}
const sorted = (a) => [...a].sort();

test('родня: линии по отцу, по матери, по деду и бабушке — только кровные с мужьями и жёнами', () => {
  const idx = kinFamily();
  // линия деда — есть его родители; у бабушек и деда по матери родителей нет — их линий нет
  assert.deepEqual(kinLines(idx, 'я').map((l) => [l.key, l.via, l.min, l.up, l.max]), [['father', 'отец', 1, 2, 3], ['ff', 'дед', 2, 3, 3], ['mother', 'мать', 1, 2, 2]]);

  // по отцу: от деда и бабушки — и сын бабушки от второго мужа; родни матери и её сына от первого брака нет
  let k = kinOf(idx, 'я', 'father');
  assert.equal(k.up, 2);
  assert.deepEqual(sorted(k.blood), sorted(['дед', 'бабка', 'отец', 'тётя', 'полудядя', 'двоюродный', 'я', 'сестра', 'сын']));
  assert.deepEqual(sorted(k.ids), sorted([...k.blood, 'мать', 'отчим отца', 'муж тёти', 'жена']));
  let L = layoutTree(idx, 'я', { mode: 'kin', line: 'father' });
  const { at } = check(idx, L, k.ids);
  assert.deepEqual(L.nodes.filter((n) => n.root).map((n) => n.id), ['я']);
  assert.equal(L.kin.key, 'father');
  assert.ok(adjacent(at, 'отец', 'мать'), 'мать рядом с отцом');
  assert.ok(at.get('дед').y < at.get('отец').y && at.get('отец').y < at.get('я').y, 'сверху — дед, ниже отец, ещё ниже я');

  // поколений вверх: 1 — только отец и его дети, 3 — ещё прадеды с братом деда и его сыном; больше нельзя
  assert.deepEqual(sorted(kinOf(idx, 'я', 'father', 1).blood), sorted(['отец', 'я', 'сестра', 'сын']));
  k = kinOf(idx, 'я', 'father', 3);
  assert.ok(['прадед', 'прабабка', 'брат деда', 'его сын'].every((id) => k.blood.has(id)));
  assert.equal(kinOf(idx, 'я', 'father', 99).up, 3);
  assert.equal(kinOf(idx, 'я', 'father', 0).up, 1);

  // по деду: родня деда — брат деда и его сын; сын бабушки от второго мужа деду не родня, бабушка — жена деда
  k = kinOf(idx, 'я', 'ff');
  assert.ok(k.blood.has('брат деда') && k.blood.has('его сын') && k.blood.has('тётя'));
  assert.ok(!k.blood.has('полудядя') && !k.blood.has('бабка') && k.ids.includes('бабка'));
  check(idx, layoutTree(idx, 'я', { mode: 'kin', line: 'ff' }), k.ids);

  // по матери: брат матери, его дочь и сын матери от первого брака; тёти по отцу нет
  k = kinOf(idx, 'я', 'mother');
  assert.deepEqual(sorted(k.blood), sorted(['дед2', 'бабка2', 'мать', 'дядя2', 'двоюродная2', 'полубрат', 'я', 'сестра', 'сын']));
  assert.ok(k.ids.includes('отец') && k.ids.includes('первый муж') && !k.ids.includes('тётя'));
  check(idx, layoutTree(idx, 'я', { mode: 'kin', line: 'mother' }), k.ids);

  // нет такой линии — первая из тех, что есть; родители не указаны — родни нет, на дереве только сам человек
  assert.equal(kinOf(idx, 'я', 'mm').key, 'father');
  assert.equal(kinOf(idx, 'жена', 'father'), null);
  L = layoutTree(idx, 'жена', { mode: 'kin', line: 'father' });
  assert.equal(L.kin, null);
  assert.deepEqual(L.nodes.map((n) => n.id), ['жена']);
});

test('родня в больших деревьях: у каждого по всем линиям — без наложений и быстро', () => {
  const data = clans();
  let idx = buildIndex(data);
  let lines = 0;
  for (const p of data.persons) {
    for (const l of kinLines(idx, p.id)) {
      for (const up of [l.min, l.up, l.max]) {
        const L = layoutTree(idx, p.id, { mode: 'kin', line: l.key, up });
        check(idx, L, L.kin.ids);
        assert.ok(L.kin.blood.has(p.id) && L.kin.blood.has(l.via));
        lines++;
      }
    }
  }
  assert.ok(lines > 300, `проверено раскладок: ${lines}`);
  idx = buildIndex(randomTree(4000, 4000));
  const some = [...idx.persons.keys()].filter((id) => kinLines(idx, id).length > 2).slice(0, 30);
  assert.ok(some.length >= 10);
  for (const id of some) {
    for (const l of kinLines(idx, id)) {
      const t = performance.now();
      const L = layoutTree(idx, id, { mode: 'kin', line: l.key, up: l.max });
      assert.ok(performance.now() - t < 500, `${L.kin.ids.length} человек`);
      check(idx, L, L.kin.ids);
    }
  }
});

test('печать родни: линия из адреса, заголовок «Родня … по отцу», если свой не задан', async () => {
  assert.equal(parsePrintOptions({ mode: 'kin', line: 'mf' }).line, 'mf');
  assert.equal(parsePrintOptions({ mode: 'kin', line: 'чужая' }).line, 'father');
  const data = clans();
  const idx = buildIndex(data);
  const root = data.persons.find((p) => kinLines(idx, p.id).length === 6).id;
  for (const [title, expect] of [['', `Родня ${shortGenitive(idx.persons.get(root))} по деду — отцу матери`], ['Наша родня', 'Наша родня']]) {
    const o = { ...parsePrintOptions({ mode: 'kin', line: 'mf', root, title }), kinTitle: !title };
    if (!o.title) o.title = 'Семейное древо';
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => out.on('end', r));
    const plan = renderPdf(out, data, o);
    await done;
    assert.equal(o.title, expect);
    assert.equal((Buffer.concat(chunks).toString('latin1').match(/\/Type \/Page\b/g) || []).length, plan.cols * plan.rows);
  }
});
