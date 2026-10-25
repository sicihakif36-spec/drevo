// «Родня» (расширенная ветка): кровные родственники человека по одной линии — по отцу, по матери,
// по одному из дедов или бабушек. Сверху — общие предки этой линии (по отцу — родители отца, по деду — родители деда),
// под ними — все их потомки: дяди и тёти, двоюродные и троюродные, их дети и внуки; у каждого — муж или жена.
// «Поколений вверх» поднимает общих предков выше: прадеды, прапрадеды — и родни становится больше.
// Раскладка — как у «Всего дерева» (shared/wholetree.js), только для этих людей. Общая для экрана и печати.
import { fatherMother } from './layout.js';
import { parentsOf, childrenOf, spousesOf } from './names.js';
import { layoutPeople } from './wholetree.js';

// Линии: путь от человека вверх (M — отец, F — мать).
export const KIN_LINES = [
  { key: 'father', path: 'M', title: 'По отцу', who: 'отец', text: 'по отцу' },
  { key: 'ff', path: 'MM', title: 'По деду', who: 'отец отца', text: 'по деду — отцу отца' },
  { key: 'fm', path: 'MF', title: 'По бабушке', who: 'мать отца', text: 'по бабушке — матери отца' },
  { key: 'mother', path: 'F', title: 'По матери', who: 'мать', text: 'по матери' },
  { key: 'mf', path: 'FM', title: 'По деду', who: 'отец матери', text: 'по деду — отцу матери' },
  { key: 'mm', path: 'FF', title: 'По бабушке', who: 'мать матери', text: 'по бабушке — матери матери' },
];

// Через кого идёт линия: отец, мать, дед или бабушка; null — такого в дереве нет.
function viaOf(idx, id, path) {
  let cur = id;
  for (const step of path) {
    const [father, mother] = fatherMother(idx, cur);
    cur = step === 'M' ? father : mother;
    if (!cur) return null;
  }
  return cur;
}

// Предки человека с номером поколения (сам — 0), не выше max.
function ancestorsOf(idx, id, max = Infinity) {
  const gen = new Map([[id, 0]]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    const g = gen.get(cur);
    if (g >= max) continue;
    for (const p of parentsOf(idx, cur)) if (!gen.has(p)) { gen.set(p, g + 1); queue.push(p); }
  }
  return gen;
}

/**
 * Какие линии родни есть у человека. Линия деда или бабушки — только если известны их родители:
 * иначе она почти та же, что «по отцу» («по матери»).
 * Поколений вверх до общих предков: min — сам отец (дед), up — по умолчанию (их родители), max — выше никого.
 */
export function kinLines(idx, id) {
  const out = [];
  if (!id || !idx?.persons.has(id)) return out;
  for (const line of KIN_LINES) {
    const via = viaOf(idx, id, line.path);
    if (!via) continue;
    let deepest = 0;
    for (const g of ancestorsOf(idx, via).values()) deepest = Math.max(deepest, g);
    if (line.path.length > 1 && !deepest) continue;
    const min = line.path.length;
    out.push({ ...line, via, min, up: min + Math.min(1, deepest), max: min + deepest });
  }
  return out;
}

/**
 * Кровная родня по линии: общие предки (до up поколений вверх от человека), все их потомки, их мужья и жёны.
 * Нет такой линии — первая из тех, что есть; нет никакой (родители не указаны) — null.
 * Возвращает линию, up, blood — кровные родственники (вместе с самим человеком), ids — все, кого рисовать.
 */
export function kinOf(idx, id, key, up) {
  const lines = kinLines(idx, id);
  const line = lines.find((l) => l.key === key) || lines[0];
  if (!line) return null;
  const k = Math.min(line.max, Math.max(line.min, Number.isFinite(up) ? up : line.up));
  const blood = new Set(ancestorsOf(idx, line.via, k - line.min).keys());
  const queue = [...blood];
  while (queue.length) for (const c of childrenOf(idx, queue.shift())) if (!blood.has(c)) { blood.add(c); queue.push(c); }
  const ids = new Set(blood);
  for (const b of blood) for (const s of spousesOf(idx, b)) if (s.spouseId) ids.add(s.spouseId);
  return { ...line, up: k, blood, ids: [...ids] };
}

// Раскладка родни: узлы, линии, границы и kin — что показано (null — показать не от кого, только сам человек).
export function layoutKin(idx, id, { line, up } = {}) {
  const kin = kinOf(idx, id, line, up);
  const L = layoutPeople(idx, kin ? kin.ids : [id], id);
  return { ...L, nodes: L.nodes.map((n) => (n.id === id ? { ...n, root: true } : n)), kin };
}
