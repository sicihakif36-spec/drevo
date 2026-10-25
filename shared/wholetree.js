// «Всё дерево»: все, кто связан с выбранным человеком родством и браками, — каждый ровно один раз.
// Поколения рядами (старшие сверху), супруги рядом, дети под своей парой. Общая для экрана и печати.
//
// Как устроено:
// 1. Супруги со всеми своими браками — одна «семья» в ряду (мужчина с двумя жёнами: жена, муж, жена).
// 2. Ряды: от предков вниз по самому длинному пути, потом каждую семью — вплотную над её детьми.
//    Если линия родства проходит через ряд (браки разных поколений), в этом ряду под неё оставляется место.
// 3. Основа — лес по кровным линиям: у каждой семьи одна «своя» родительская семья, дети — под ней по старшинству.
//    Родня пришедших в семью супругов — отдельные деревья, их подвешиваем рядом с местом, куда ведёт связь.
// 4. Места по горизонтали: поддеревья сдвигаются вплотную по контурам (как в обычном родословном дереве),
//    родители — над серединой своих детей; рамки не налезают друг на друга.
// 5. Линии к детям — «гребёнкой» на своей высоте, чтобы гребёнки разных семей не сливались.
import { BOX } from './layout.js';
import { parentsOf, childrenOf, spousesOf } from './names.js';

const DUMMY = 12; // место под проходящую через ряд линию
const TRACK = 11; // расстояние между гребёнками в одном промежутке

// ---------- Связные части дерева ----------

const partsCache = new WeakMap();
// Люди по связным частям, самая большая — первой. partOf: id -> номер части.
export function treeParts(idx) {
  if (partsCache.has(idx)) return partsCache.get(idx);
  const up = new Map();
  for (const id of idx.persons.keys()) up.set(id, id);
  const find = (a) => {
    let r = a;
    while (up.get(r) !== r) r = up.get(r);
    while (up.get(a) !== r) { const n = up.get(a); up.set(a, r); a = n; }
    return r;
  };
  for (const f of idx.families.values()) {
    const ids = [f.partner1, f.partner2, ...f.children].filter((id) => id && up.has(id));
    for (let i = 1; i < ids.length; i++) up.set(find(ids[i]), find(ids[0]));
  }
  const byRoot = new Map();
  for (const id of idx.persons.keys()) {
    const r = find(id);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(id);
  }
  const list = [...byRoot.values()].sort((a, b) => b.length - a.length);
  const partOf = new Map();
  list.forEach((ids, i) => { for (const id of ids) partOf.set(id, i); });
  const res = { list, partOf };
  partsCache.set(idx, res);
  return res;
}

// Самый «семейный» человек части: больше всего родителей, детей и супругов рядом.
export function centralPerson(idx, ids) {
  let best = null;
  let bestN = -1;
  for (const id of ids) {
    const n = parentsOf(idx, id).length + childrenOf(idx, id).length + spousesOf(idx, id).filter((s) => s.spouseId).length;
    if (n > bestN) { best = id; bestN = n; }
  }
  return best;
}

// С кого начинать дерево: первый из кандидатов, кто есть в дереве (сам вошедший, человек владельца),
// иначе — человек из самой большой связной части. Никогда не «первый по алфавиту».
export function homePerson(idx, ...candidates) {
  for (const id of candidates) if (id && idx?.persons.has(id)) return id;
  const { list } = idx ? treeParts(idx) : { list: [] };
  return list.length ? centralPerson(idx, list[0]) : null;
}

// ---------- Раскладка ----------

const layoutCache = new WeakMap();

/**
 * Раскладка связной части, в которой rootId. anchor — от чьих предков начинать обход (кто окажется слева);
 * пока anchor в той же части, раскладка не меняется при выборе другого человека, только выделение.
 * Возвращает узлы (x, y — левый верхний угол), линии, границы и others — сколько людей в других частях.
 */
export function layoutWhole(idx, rootId, { anchor } = {}) {
  const { list, partOf } = treeParts(idx);
  const part = partOf.get(rootId);
  const start = anchor && partOf.get(anchor) === part ? anchor : rootId;
  if (!layoutCache.has(idx)) layoutCache.set(idx, new Map());
  const cache = layoutCache.get(idx);
  if (!cache.has(start)) cache.set(start, compute(idx, list[part], start));
  const res = cache.get(start);
  return { ...res, nodes: res.nodes.map((n) => (n.id === rootId ? { ...n, root: true } : n)), others: idx.persons.size - list[part].length };
}

// Раскладка выбранных людей тем же способом — например, родни по одной линии (shared/kin.js).
// Люди должны быть связаны между собой; start — чья линия главная (кто окажется слева).
export function layoutPeople(idx, ids, start) {
  return compute(idx, ids, start);
}

function compute(idx, ids, start) {
  const inPart = new Set(ids);

  // 1. Семьи в ряду: супруги со всеми их браками.
  const up = new Map(ids.map((id) => [id, id]));
  const find = (a) => { while (up.get(a) !== a) { up.set(a, up.get(up.get(a))); a = up.get(a); } return a; };
  const fams = [];
  const seenF = new Set();
  for (const id of ids) {
    for (const fid of [...(idx.spouseFamilies.get(id) || []), ...(idx.parentFamilies.get(id) || [])]) {
      if (seenF.has(fid)) continue;
      seenF.add(fid);
      const f = idx.families.get(fid);
      const p = [f.partner1, f.partner2].filter((x) => x && inPart.has(x));
      if (!p.length) continue; // семья без родителей: детей связать не с кем
      if (p.length === 2) up.set(find(p[0]), find(p[1]));
      fams.push({ f, partners: p });
    }
  }
  const groupOf = new Map();
  const groups = [];
  for (const id of ids) {
    const r = find(id);
    if (!groupOf.has(r)) { groupOf.set(r, groups.length); groups.push({ members: [], fams: [], succ: [] }); }
    groupOf.set(id, groupOf.get(r));
    groups[groupOf.get(r)].members.push(id);
  }
  const G = groups.length;
  for (const fam of fams) groups[groupOf.get(fam.partners[0])].fams.push(fam);

  // Связи «семья -> ребёнок» между семьями в рядах.
  const rel = [];
  for (let g = 0; g < G; g++) {
    for (const fam of groups[g].fams) {
      for (const c of fam.f.children) {
        if (!inPart.has(c)) continue;
        const h = groupOf.get(c);
        if (h === g) continue; // брак с собственным ребёнком — линию не рисуем
        rel.push({ g, h, fam, c });
        groups[g].succ.push(h);
      }
    }
  }

  // 2. Ряды. Обход в глубину без возвратов; обратные рёбра (брак с потомком) не учитываем.
  const state = new Uint8Array(G); // 0 — не были, 1 — в пути, 2 — готово
  const post = [];
  const back = new Set();
  for (let s = 0; s < G; s++) {
    if (state[s]) continue;
    const stack = [[s, 0]];
    state[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const succ = groups[top[0]].succ;
      if (top[1] < succ.length) {
        const h = succ[top[1]++];
        if (state[h] === 1) back.add(`${top[0]}>${h}`);
        else if (!state[h]) { state[h] = 1; stack.push([h, 0]); }
      } else {
        state[top[0]] = 2;
        post.push(top[0]);
        stack.pop();
      }
    }
  }
  const topo = post.reverse();
  const ok = (g, h) => !back.has(`${g}>${h}`);
  const gen = new Array(G).fill(0);
  for (const g of topo) for (const h of groups[g].succ) if (ok(g, h)) gen[h] = Math.max(gen[h], gen[g] + 1);
  // Каждую семью с детьми — вплотную над ближайшим ребёнком: пришедший в семью супруг без предков не улетает вверх.
  for (let i = topo.length - 1; i >= 0; i--) {
    const g = topo[i];
    let m = Infinity;
    for (const h of groups[g].succ) if (ok(g, h)) m = Math.min(m, gen[h] - 1);
    if (m < Infinity) gen[g] = m;
  }
  const minGen = Math.min(...gen);
  const R = Math.max(...gen) - minGen + 1;

  // Семьи в рядах.
  const items = groups.map((gr, g) => {
    const it = { g, row: gen[g] - minGen, members: linearize(idx, gr), fams: gr.fams, up: [], down: [], kids: [], guests: [], x: 0 };
    it.w = it.members.length * BOX.w + (it.members.length - 1) * BOX.hgap;
    reindex(it);
    return it;
  });
  // Связи «семья родителей -> ребёнок»: a — семья родителей, b — семья ребёнка.
  const links = [];
  for (const r of rel) {
    if (!ok(r.g, r.h) || gen[r.h] <= gen[r.g]) continue;
    const l = { a: items[r.g], fam: r.fam, b: items[r.h], c: r.c };
    l.a.down.push(l);
    l.b.up.push(l);
    links.push(l);
  }

  // 3. Основа — лес: у каждой семьи одна «своя» родительская семья (кровная линия), дети — под ней.
  // Свой ребёнок — тот, что из этой семьи по крови: сам выбранный человек, иначе по отцовской линии, иначе первый.
  const male = (id) => idx.persons.get(id)?.sex === 'M';
  for (const it of items) {
    if (!it.up.length) continue;
    const near = it.up.filter((l) => l.a.row === it.row - 1);
    const pool = near.length ? near : it.up;
    it.tree = pool.find((l) => l.c === start) || pool.find((l) => male(l.c)) || pool[0];
    it.tree.a.kids.push(it);
  }
  const rootOf = (it) => { while (it.tree) it = it.tree.a; return it; };
  // Кровный член семьи — левее, пришедший в семью — правее, к своей родне.
  for (const it of items) {
    if (it.members.length === 2 && it.tree && it.members[1] === it.tree.c) { it.members.reverse(); reindex(it); }
  }
  // Дети по порядку браков (как стоят родители), внутри брака — по старшинству.
  for (const it of items) {
    const famOrder = new Map(it.fams.map((fam) => [fam, famPort(it, fam).x]));
    const birth = new Map(it.fams.flatMap((fam) => fam.f.children.map((c, i) => [c, i])));
    it.kids.sort((p, q) => famOrder.get(p.tree.fam) - famOrder.get(q.tree.fam) || birth.get(p.tree.c) - birth.get(q.tree.c));
  }

  // Остальные деревья (родня супругов) подвешиваем рядом с тем местом, куда ведёт их связь:
  // к ближайшему предку по кровной линии не ниже их корня, сразу за его веткой; иначе — отдельным деревом справа.
  const main = rootOf(items[groupOf.get(start)]);
  const forest = [main];
  const placed = new Set([main]);
  const queue = [main];
  const treeNodes = (root) => {
    const out = [];
    const st = [root];
    while (st.length) {
      const it = st.pop();
      out.push(it);
      for (const k of it.kids) st.push(k);
    }
    return out;
  };
  while (queue.length) {
    const host = queue.shift();
    for (const u of treeNodes(host)) {
      for (const l of [...u.up, ...u.down]) {
        if (l === u.tree || (l.b.tree === l)) continue;
        const other = l.a === u ? l.b : l.a;
        const X = rootOf(other);
        if (placed.has(X)) continue;
        placed.add(X);
        let A = u;
        let below = null;
        while (A && A.row > X.row) { below = A; A = A.tree?.a; }
        if (A) A.guests.push({ root: X, after: below });
        else {
          const i = forest.indexOf(host);
          forest.splice(i < 0 ? forest.length : i + 1, 0, X);
        }
        queue.push(X);
      }
    }
  }
  for (const it of items) if (!it.tree && !placed.has(it)) { placed.add(it); forest.push(it); }

  // 4. Места: каждое поддерево — контур (левый и правый край по рядам); соседние поддеревья сдвигаются вплотную,
  // родители — над серединой своих детей (как в обычном родословном дереве).
  const SEP = 2 * BOX.hgap;
  const pack = (entries) => {
    const acc = new Map();
    let last = 0;
    for (const e of entries) {
      let off = -Infinity;
      for (const [row, [l]] of e.contour) if (acc.has(row)) off = Math.max(off, acc.get(row)[1] + SEP - l);
      if (off === -Infinity) off = last;
      e.off = off;
      last = off;
      for (const [row, [l, r]] of e.contour) {
        const cur = acc.get(row);
        acc.set(row, cur ? [Math.min(cur[0], l + off), Math.max(cur[1], r + off)] : [l + off, r + off]);
      }
    }
    return acc;
  };
  // Возвращает контур поддерева относительно левого края семьи; it.rel — сдвиги детей и подвешенных деревьев.
  const lay = (it) => {
    const entries = [];
    for (const k of it.kids) {
      const contour = lay(k);
      // длинная связь (через ряд): место под линию в промежуточных рядах
      const cx = memberX(k, k.tree.c);
      for (let row = it.row + 1; row < k.row; row++) contour.set(row, [cx - DUMMY / 2, cx + DUMMY / 2]);
      entries.push({ it: k, contour, kid: true });
      for (const gst of it.guests) if (gst.after === k) entries.push({ it: gst.root, contour: lay(gst.root) });
    }
    for (const gst of it.guests) if (!gst.after || !it.kids.includes(gst.after)) entries.push({ it: gst.root, contour: lay(gst.root) });
    pack(entries);
    // родители над детьми: середина портов семей — над серединой крайних детей
    let px = 0;
    const kids = entries.filter((e) => e.kid);
    if (kids.length) {
      const xs = kids.map((e) => e.off + memberX(e.it, e.it.tree.c));
      const ports = [...new Set(kids.map((e) => famPort(it, e.it.tree.fam).x))];
      px = (Math.min(...xs) + Math.max(...xs)) / 2 - (Math.min(...ports) + Math.max(...ports)) / 2;
    }
    // подвешенное дерево на ряду самой семьи (или выше) не должно налезать на её рамки: раздвигаем в стороны
    const mid = px + it.w / 2;
    const side = (e) => { const c = e.contour.get(it.row); return c && (c[0] + c[1] + 2 * e.off > 2 * mid ? 1 : -1); };
    for (let i = 0, shift = 0; i < entries.length; i++) {
      const e = entries[i];
      e.off += shift;
      if (side(e) !== 1) continue;
      const d = Math.max(0, px + it.w + SEP - (e.contour.get(it.row)[0] + e.off));
      e.off += d;
      shift += d;
    }
    for (let i = entries.length - 1, shift = 0; i >= 0; i--) {
      const e = entries[i];
      e.off -= shift;
      if (side(e) !== -1) continue;
      const d = Math.max(0, e.contour.get(it.row)[1] + e.off + SEP - px);
      e.off -= d;
      shift += d;
    }
    it.rel = entries.map((e) => ({ it: e.it, dx: e.off - px }));
    const out = new Map([[it.row, [0, it.w]]]);
    for (const e of entries) {
      for (const [row, [l, r]] of e.contour) {
        const cur = out.get(row);
        out.set(row, cur ? [Math.min(cur[0], l + e.off - px), Math.max(cur[1], r + e.off - px)] : [l + e.off - px, r + e.off - px]);
      }
    }
    return out;
  };
  const top = forest.map((root) => ({ it: root, contour: lay(root) }));
  pack(top);
  const setX = (it, x) => {
    it.x = x;
    for (const e of it.rel) setX(e.it, x + e.dx);
  };
  for (const e of top) setX(e.it, e.off);
  const rows = Array.from({ length: R }, () => []);
  for (const it of items) rows[it.row].push(it);

  // 5. Линии. Промежуток между рядами: гребёнки семей на разной высоте.
  const nodes = [];
  const edges = [];
  const buses = Array.from({ length: Math.max(0, R - 1) }, () => new Map());
  // Связь через несколько рядов идёт по свободному от рамок месту в промежуточных рядах.
  const spans = rows.map((row) => row.map((it) => [it.x - BOX.hgap / 2, it.x + it.w + BOX.hgap / 2]).sort((p, q) => p[0] - q[0]));
  const blocker = (x, r0, r1) => {
    for (let r = r0; r < r1; r++) {
      const sp = spans[r];
      let lo = 0, hi = sp.length - 1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (sp[m][1] <= x) lo = m + 1;
        else if (sp[m][0] >= x) hi = m - 1;
        else return sp[m];
      }
    }
    return null;
  };
  const freeX = (x, r0, r1) => {
    const tried = new Set();
    const cand = [x];
    while (cand.length && tried.size < 200) {
      cand.sort((p, q) => Math.abs(p - x) - Math.abs(q - x));
      const c = cand.shift();
      if (tried.has(c)) continue;
      tried.add(c);
      const b = blocker(c, r0, r1);
      if (!b) return c;
      cand.push(b[0], b[1]);
    }
    return x;
  };
  for (const l of links) {
    const bs = buses[l.a.row];
    if (!bs.has(l.fam)) bs.set(l.fam, { a: l.a, fam: l.fam, x: l.a.x + famPort(l.a, l.fam).x, kids: [] });
    const x = l.b.x + memberX(l.b, l.c);
    bs.get(l.fam).kids.push([x, l.b.row, l.b.row > l.a.row + 1 ? freeX(x, l.a.row + 1, l.b.row) : x]);
  }
  const gapH = [];
  for (const bs of buses) {
    const list = [...bs.values()].map((b) => ({ ...b, lo: Math.min(b.x, ...b.kids.map((k) => k[2])), hi: Math.max(b.x, ...b.kids.map((k) => k[2])) }));
    list.sort((p, q) => p.lo - q.lo);
    const ends = [];
    for (const b of list) {
      let t = ends.findIndex((e) => e < b.lo - 8);
      if (t < 0) { t = ends.length; ends.push(0); }
      ends[t] = b.hi;
      b.track = t;
    }
    const n = Math.max(1, ends.length);
    gapH.push(Math.max(BOX.vgap, 44 + (n - 1) * TRACK));
    bs.list = list;
    bs.n = n;
  }
  const rowY = [0];
  for (let r = 1; r < R; r++) rowY.push(rowY[r - 1] + BOX.h + gapH[r - 1]);

  for (const row of rows) {
    for (const it of row) {
      const y = rowY[it.row];
      it.members.forEach((id, i) => nodes.push({ id, x: it.x + i * (BOX.w + BOX.hgap), y }));
      for (const fam of it.fams) {
        if (fam.partners.length < 2) continue;
        const [i, j] = fam.partners.map((id) => it.pos.get(id)).sort((p, q) => p - q);
        const xi = it.x + i * (BOX.w + BOX.hgap);
        const xj = it.x + j * (BOX.w + BOX.hgap);
        if (j - i === 1) edges.push({ points: [[xi + BOX.w, y + BOX.h / 2], [xj, y + BOX.h / 2]], couple: true });
        else {
          // супруги не рядом (третий брак): скобка под рамками
          const by = y + BOX.h + 8;
          edges.push({ points: [[xi + BOX.w / 2, y + BOX.h], [xi + BOX.w / 2, by], [xj + BOX.w / 2, by], [xj + BOX.w / 2, y + BOX.h]], couple: true });
        }
      }
    }
  }
  buses.forEach((bs, r) => {
    const y0 = rowY[r] + BOX.h;
    const first = y0 + (gapH[r] - (bs.n - 1) * TRACK) / 2;
    for (const b of bs.list) {
      const ty = first + b.track * TRACK;
      edges.push({ points: [[b.x, rowY[r] + famPort(b.a, b.fam).y], [b.x, ty]] });
      if (b.hi > b.lo) edges.push({ points: [[b.lo, ty], [b.hi, ty]] });
      for (const [x, row, via] of b.kids) {
        if (via === x) edges.push({ points: [[x, ty], [x, rowY[row]]] });
        else edges.push({ points: [[via, ty], [via, rowY[row] - 12], [x, rowY[row] - 12], [x, rowY[row]]] });
      }
    }
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + BOX.w); maxY = Math.max(maxY, n.y + BOX.h);
  }
  return { nodes, edges, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

// Порядок людей в семье ряда: супруги рядом. Цепочка браков (вдова вышла снова) — по цепочке;
// у кого несколько браков — первый супруг справа, второй слева, остальные дальше справа.
function linearize(idx, gr) {
  if (gr.members.length === 1) return gr.members.slice();
  const adj = new Map(gr.members.map((id) => [id, []]));
  for (const { partners } of gr.fams) {
    if (partners.length < 2) continue;
    const [a, b] = partners;
    if (!adj.get(a).includes(b)) { adj.get(a).push(b); adj.get(b).push(a); }
  }
  const male = (id) => idx.persons.get(id)?.sex !== 'F';
  const deg = (id) => adj.get(id).length;
  if (gr.members.every((id) => deg(id) <= 2)) {
    const ends = gr.members.filter((id) => deg(id) === 1);
    if (ends.length === 2) {
      // мужчина слева, если цепочка из двоих
      let cur = ends.length === 2 && gr.members.length === 2 && !male(ends[0]) ? ends[1] : ends[0];
      const out = [cur];
      let prev = null;
      while (out.length < gr.members.length) {
        const n = adj.get(cur).find((x) => x !== prev);
        prev = cur;
        cur = n;
        out.push(cur);
      }
      return out;
    }
  }
  // Звезда и запутанные случаи: самый «женатый» в середине, его супруги по сторонам, остальные — рядом со своим супругом.
  const center = gr.members.reduce((p, q) => (deg(q) > deg(p) ? q : p));
  const left = [];
  const right = [];
  adj.get(center).forEach((s, i) => (i === 1 ? left : right).push(s));
  const placed = new Set([center, ...left, ...right]);
  const out = [...left.reverse(), center, ...right];
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      for (const s of adj.get(out[i])) {
        if (placed.has(s)) continue;
        placed.add(s);
        changed = true;
        if (i < out.indexOf(center)) out.splice(i, 0, s);
        else out.splice(i + 1, 0, s);
      }
    }
  }
  for (const id of gr.members) if (!placed.has(id)) out.push(id);
  return out;
}

function reindex(it) {
  it.pos = new Map(it.members.map((id, i) => [id, i]));
  it.ports = new Map(it.fams.map((fam) => [fam, portOf(it, fam)]));
}
const memberX = (it, id) => it.pos.get(id) * (BOX.w + BOX.hgap) + BOX.w / 2;
// Откуда идёт линия к детям семьи: середина между супругами (рядом), середина скобки, или низ одинокого родителя.
function portOf(it, fam) {
  if (fam.partners.length < 2) return { x: memberX(it, fam.partners[0]), y: BOX.h };
  const [i, j] = fam.partners.map((id) => it.pos.get(id)).sort((p, q) => p - q);
  if (j - i === 1) return { x: i * (BOX.w + BOX.hgap) + BOX.w + BOX.hgap / 2, y: BOX.h / 2 };
  return { x: ((i + j) / 2) * (BOX.w + BOX.hgap) + BOX.w / 2, y: BOX.h + 8 };
}
const famPort = (it, fam) => it.ports.get(fam);

