// Раскладка дерева: одна и та же для экрана телефона и для печати.
import { parentsOf, spousesOf } from './names.js';
import { layoutWhole } from './wholetree.js';
import { layoutKin } from './kin.js';

// mgap — промежуток между супругами, когда у кого-то из них несколько браков: в нём точка брака, от неё — линия к детям.
export const BOX = { w: 168, h: 76, hgap: 22, vgap: 64, mgap: 48 };

// Несколько браков у человека: у каждого брака свой цвет (номер 1–4, по кругу) — связка супругов, точка брака,
// линия к детям; у каждого брака своя высота линии к детям, чтобы линии разных браков не сливались в одну.
export const MARRIAGE_COLORS = 4;
export const TRACK = 11; // расстояние между линиями к детям разных браков в одном промежутке
// Высоты линий к детям: интервалы [lo, hi] — пересекающиеся на разной высоте. Возвращает номер высоты у каждого и сколько высот.
export function tracks(list) {
  const order = list.map((b, i) => i).sort((i, j) => list[i].lo - list[j].lo);
  const ends = [];
  const out = new Array(list.length);
  for (const i of order) {
    let t = ends.findIndex((e) => e < list[i].lo - 8);
    if (t < 0) { t = ends.length; ends.push(0); }
    ends[t] = list[i].hi;
    out[i] = t;
  }
  return { of: out, n: Math.max(1, ends.length) };
}

const rowStep = () => BOX.h + BOX.vgap;

export function fatherMother(idx, id) {
  const fid = (idx.parentFamilies.get(id) || [])[0];
  if (!fid) return [null, null];
  const f = idx.families.get(fid);
  const a = f.partner1 ? idx.persons.get(f.partner1) : null;
  const b = f.partner2 ? idx.persons.get(f.partner2) : null;
  if (a?.sex === 'F' || b?.sex === 'M') return [b?.id || null, a?.id || null];
  return [a?.id || null, b?.id || null];
}

// ---------- Предки ----------

function ancestorNode(idx, id, gen, maxGen, opts, seen) {
  seen.add(id);
  const node = { id, parents: [] };
  if (gen >= maxGen) return node;
  const [father, mother] = fatherMother(idx, id);
  for (const [pid, rel] of [[father, 'father'], [mother, 'mother']]) {
    if (pid && !seen.has(pid)) node.parents.push(ancestorNode(idx, pid, gen + 1, maxGen, opts, seen));
    else if (!pid && opts.placeholders) node.parents.push({ placeholder: { of: id, relation: rel }, parents: [] });
  }
  return node;
}

function measureAnc(n) {
  const own = BOX.w;
  if (!n.parents.length) return (n.width = own);
  const sum = n.parents.reduce((s, p) => s + measureAnc(p), 0) + BOX.hgap * (n.parents.length - 1);
  return (n.width = Math.max(own, sum));
}

function placeAnc(n, left, depth, out) {
  const y = -depth * rowStep();
  let cx;
  if (n.parents.length) {
    const sum = n.parents.reduce((s, p) => s + p.width, 0) + BOX.hgap * (n.parents.length - 1);
    let cur = left + (n.width - sum) / 2;
    const centers = [];
    for (const p of n.parents) {
      centers.push(placeAnc(p, cur, depth + 1, out));
      cur += p.width + BOX.hgap;
    }
    cx = (centers[0] + centers[centers.length - 1]) / 2;
    const py = y - rowStep() + BOX.h / 2;
    const dashed = n.parents.some((p) => p.placeholder);
    if (centers.length === 2) out.edges.push({ points: [[centers[0] + BOX.w / 2, py], [centers[1] - BOX.w / 2, py]], dashed, couple: true });
    const topY = centers.length === 2 ? py : y - BOX.vgap;
    out.edges.push({ points: [[cx, topY], [cx, y]], dashed });
  } else {
    cx = left + n.width / 2;
  }
  n.cx = cx;
  if (depth > 0 || !out.skipRoot) out.nodes.push(n.placeholder ? { placeholder: n.placeholder, x: cx - BOX.w / 2, y } : { id: n.id, x: cx - BOX.w / 2, y, root: depth === 0 });
  return cx;
}

// ---------- Потомки ----------

function descendantNode(idx, id, gen, maxGen, seen) {
  seen.add(id);
  const unit = { id, families: [] };
  for (const s of spousesOf(idx, id)) {
    const fam = idx.families.get(s.familyId);
    const spouseId = s.spouseId && !seen.has(s.spouseId) ? s.spouseId : null;
    if (spouseId) seen.add(spouseId);
    const kids = [];
    if (gen < maxGen) for (const c of fam.children) if (!seen.has(c)) kids.push(descendantNode(idx, c, gen + 1, maxGen, seen));
    if (spouseId || kids.length) unit.families.push({ familyId: fam.id, spouseId, children: kids });
  }
  // супруги: первый справа, второй слева, остальные справа
  const withSpouse = unit.families.filter((f) => f.spouseId);
  unit.left = withSpouse.length > 1 ? [withSpouse[1]] : [];
  unit.right = withSpouse.filter((f) => !unit.left.includes(f));
  const order = [...unit.left, ...unit.families.filter((f) => !f.spouseId), ...unit.right];
  unit.families = order;
  return unit;
}

function measureDesc(u) {
  const boxes = 1 + u.left.length + u.right.length;
  // супругов больше одного — промежутки шире: в них точки браков
  u.gap = boxes > 2 ? BOX.mgap : BOX.hgap;
  u.rowWidth = boxes * BOX.w + (boxes - 1) * u.gap;
  const kids = u.families.flatMap((f) => f.children);
  u.childWidth = kids.reduce((s, k) => s + measureDesc(k), 0) + Math.max(0, kids.length - 1) * BOX.hgap;
  return (u.width = Math.max(u.rowWidth, u.childWidth));
}

function placeDesc(u, left, depth, out) {
  const y = depth * rowStep();
  const step = BOX.w + u.gap;
  const rowLeft = left + (u.width - u.rowWidth) / 2;
  const px = rowLeft + u.left.length * step;
  const pcx = px + BOX.w / 2;
  out.nodes.push({ id: u.id, x: px, y, root: depth === 0 });
  const spouseX = new Map();
  u.left.forEach((f, i) => spouseX.set(f, rowLeft + i * step));
  u.right.forEach((f, i) => spouseX.set(f, px + (i + 1) * step));
  // несколько браков — у каждого свой цвет, слева направо
  const color = new Map(u.families.length > 1 ? u.families.map((f, i) => [f, (i % MARRIAGE_COLORS) + 1]) : []);
  const tint = (f) => (color.has(f) ? { color: color.get(f) } : {});
  const midY = y + BOX.h / 2;
  for (const [f, sx] of spouseX) {
    out.nodes.push({ id: f.spouseId, x: sx, y, spouse: true });
    const a = Math.min(sx, px) + BOX.w;
    const b = Math.max(sx, px);
    out.edges.push({ points: [[a, midY], [b, midY]], couple: true, ...tint(f) });
  }
  let cur = left + (u.width - u.childWidth) / 2;
  const buses = [];
  for (const f of u.families) {
    if (!f.children.length) {
      // брак без детей: точка брака всё равно видна, чтобы было понятно, где какой
      const sx = spouseX.get(f);
      if (color.has(f) && sx !== undefined) out.marks.push({ x: (Math.min(sx, px) + BOX.w + Math.max(sx, px)) / 2, y: midY, color: color.get(f) });
      continue;
    }
    const sx = spouseX.get(f);
    const dropX = sx === undefined ? pcx : (Math.min(sx, px) + BOX.w + Math.max(sx, px)) / 2;
    const dropY = sx === undefined ? y + BOX.h : midY;
    const centers = [];
    for (const k of f.children) {
      centers.push(placeDesc(k, cur, depth + 1, out));
      cur += k.width + BOX.hgap;
    }
    buses.push({ f, dropX, dropY, centers, lo: Math.min(dropX, ...centers), hi: Math.max(dropX, ...centers) });
  }
  // линии к детям разных браков — на разной высоте, если иначе они слились бы
  const { of, n } = tracks(buses);
  const gap = Math.min(TRACK, (BOX.vgap - 24) / Math.max(1, n - 1));
  const first = y + BOX.h + BOX.vgap / 2 - ((n - 1) * gap) / 2;
  buses.forEach((b, i) => {
    const barY = first + of[i] * gap;
    const c = tint(b.f);
    out.edges.push({ points: [[b.dropX, b.dropY], [b.dropX, barY]], ...c });
    if (b.hi > b.lo) out.edges.push({ points: [[b.lo, barY], [b.hi, barY]], ...c });
    for (const x of b.centers) out.edges.push({ points: [[x, barY], [x, y + rowStep()]], ...c });
    if (c.color) out.marks.push({ x: b.dropX, y: b.dropY, color: c.color });
  });
  return pcx;
}

// ---------- Общая точка входа ----------

/**
 * mode: 'all' (всё дерево, shared/wholetree.js) | 'kin' (родня по линии line, shared/kin.js)
 *   | 'ancestors' | 'descendants' | 'hourglass' (прямая линия: предки и потомки)
 * Возвращает узлы (x, y — левый верхний угол), линии и границы.
 */
export function layoutTree(idx, rootId, opts = {}) {
  const { mode = 'hourglass', up = 4, down = 3, placeholders = false, anchor, line } = opts;
  const out = { nodes: [], edges: [], marks: [] };
  if (!rootId || !idx.persons.has(rootId)) return { ...out, bounds: { x: 0, y: 0, w: 0, h: 0 } };
  if (mode === 'all') return layoutWhole(idx, rootId, { anchor });
  // у родни своё число поколений по умолчанию: от родителей отца (деда)
  if (mode === 'kin') return layoutKin(idx, rootId, { line, up: opts.up });

  let rootCx = 0;
  if (mode !== 'ancestors') {
    const d = descendantNode(idx, rootId, 0, mode === 'descendants' ? Math.max(down, up) : down, new Set());
    measureDesc(d);
    rootCx = placeDesc(d, 0, 0, out);
  }
  if (mode !== 'descendants') {
    const a = ancestorNode(idx, rootId, 0, up, { placeholders }, new Set());
    measureAnc(a);
    const anc = { nodes: [], edges: [], skipRoot: mode !== 'ancestors' };
    const cx = placeAnc(a, 0, 0, anc);
    const shift = mode === 'ancestors' ? 0 : rootCx - cx;
    for (const n of anc.nodes) out.nodes.push({ ...n, x: n.x + shift });
    for (const e of anc.edges) out.edges.push({ ...e, points: e.points.map(([x, y]) => [x + shift, y]) });
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of out.nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + BOX.w); maxY = Math.max(maxY, n.y + BOX.h);
  }
  out.bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  return out;
}

export { parentsOf };
export { treeParts, homePerson } from './wholetree.js';
