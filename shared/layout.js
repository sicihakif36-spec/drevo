// Раскладка дерева: одна и та же для экрана телефона и для печати.
import { parentsOf, spousesOf } from './names.js';
import { layoutWhole } from './wholetree.js';

export const BOX = { w: 168, h: 76, hgap: 22, vgap: 64 };

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
  u.rowWidth = boxes * BOX.w + (boxes - 1) * BOX.hgap;
  const kids = u.families.flatMap((f) => f.children);
  u.childWidth = kids.reduce((s, k) => s + measureDesc(k), 0) + Math.max(0, kids.length - 1) * BOX.hgap;
  return (u.width = Math.max(u.rowWidth, u.childWidth));
}

function placeDesc(u, left, depth, out) {
  const y = depth * rowStep();
  const rowLeft = left + (u.width - u.rowWidth) / 2;
  const px = rowLeft + u.left.length * (BOX.w + BOX.hgap);
  const pcx = px + BOX.w / 2;
  out.nodes.push({ id: u.id, x: px, y, root: depth === 0 });
  const spouseX = new Map();
  u.left.forEach((f, i) => spouseX.set(f, rowLeft + i * (BOX.w + BOX.hgap)));
  u.right.forEach((f, i) => spouseX.set(f, px + (i + 1) * (BOX.w + BOX.hgap)));
  const midY = y + BOX.h / 2;
  for (const [f, sx] of spouseX) {
    out.nodes.push({ id: f.spouseId, x: sx, y, spouse: true });
    const a = Math.min(sx, px) + BOX.w;
    const b = Math.max(sx, px);
    out.edges.push({ points: [[a, midY], [b, midY]], couple: true });
  }
  let cur = left + (u.width - u.childWidth) / 2;
  const barY = y + BOX.h + BOX.vgap / 2;
  for (const f of u.families) {
    if (!f.children.length) continue;
    const sx = spouseX.get(f);
    const dropX = sx === undefined ? pcx : (Math.min(sx, px) + BOX.w + Math.max(sx, px)) / 2;
    const dropY = sx === undefined ? y + BOX.h : midY;
    const centers = [];
    for (const k of f.children) {
      centers.push(placeDesc(k, cur, depth + 1, out));
      cur += k.width + BOX.hgap;
    }
    const lo = Math.min(dropX, ...centers);
    const hi = Math.max(dropX, ...centers);
    out.edges.push({ points: [[dropX, dropY], [dropX, barY]] });
    if (hi > lo) out.edges.push({ points: [[lo, barY], [hi, barY]] });
    for (const c of centers) out.edges.push({ points: [[c, barY], [c, barY + BOX.vgap / 2]] });
  }
  return pcx;
}

// ---------- Общая точка входа ----------

/**
 * mode: 'all' (всё дерево, shared/wholetree.js) | 'ancestors' | 'descendants' | 'hourglass' (прямая линия: предки и потомки)
 * Возвращает узлы (x, y — левый верхний угол), линии и границы.
 */
export function layoutTree(idx, rootId, { mode = 'hourglass', up = 4, down = 3, placeholders = false, anchor } = {}) {
  const out = { nodes: [], edges: [] };
  if (!rootId || !idx.persons.has(rootId)) return { ...out, bounds: { x: 0, y: 0, w: 0, h: 0 } };
  if (mode === 'all') return layoutWhole(idx, rootId, { anchor });

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
