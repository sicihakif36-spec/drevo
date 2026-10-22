// Веерная схема предков: человек в центре, вокруг полукольцами (или кольцами) родители, бабушки и дедушки, прадеды…
// Раскладка одна для экрана и PDF: секторы, цвета и строки текста с размерами и поворотом уже рассчитаны здесь.
// Единицы — как у раскладки дерева (100 % при склейке — 0,25 мм), размеры шрифта подбираются уже под бумагу.
import { isPrivate, lifespan } from './names.js';
import { fatherMother } from './layout.js';
import { planPages } from './printplan.js';

export const FAN = {
  gens: [3, 8],
  shapes: [180, 270, 360],
  center: 170, // радиус середины
  rings: [150, 140, 135, 150, 175, 190, 200, 200], // ширина колец по поколениям
  pad: 5, // поля в середине
  padPt: 1.2, // поля подписи в секторе, пунктов на бумаге
  minPt: 6, // мельче на бумаге не читается: такой текст сокращается
  maxPt: [20, 16, 14, 12, 11, 10, 10, 10, 10], // по поколениям, 0 — середина
};

const LH = 1.2; // шаг строк от размера шрифта
const LEAD = 0.1; // над и под буквами строки — пустое место, его можно пустить на поля

// Ширина букв DejaVu (обычный и полужирный, большее из Sans и Serif) в сотых долях кегля: текст на экране и в PDF
// меряется одинаково, без шрифтов браузера.
const CHARS = ' !"\'()*+,-./0123456789:;?~–—«»№ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const table = (s) => {
  const w = s.split(',').map(Number);
  return new Map([...CHARS].map((c, i) => [c, w[i] / 100]));
};
const WIDTH = {
  regular: table('32,41,46,28,40,40,50,84,32,37,32,34,64,64,64,64,64,64,64,64,64,64,34,34,54,84,50,100,62,62,105,73,74,77,81,73,70,80,88,40,41,75,67,103,88,82,68,82,76,69,67,85,73,103,72,67,70,62,65,57,65,62,38,65,65,32,32,61,32,98,65,62,65,65,48,53,41,65,60,86,60,60,53,76,74,74,67,82,73,73,113,65,88,88,78,84,103,88,82,88,68,77,67,73,87,72,88,78,115,115,84,99,69,77,120,81,62,62,59,53,70,62,62,92,55,67,67,63,64,78,67,62,67,65,57,59,60,86,60,69,67,93,95,71,80,59,57,88,64'),
  bold: table('35,46,53,31,48,48,53,84,38,42,38,37,70,70,70,70,70,70,70,70,70,70,40,40,59,84,50,100,65,65,121,78,85,80,87,77,71,86,95,47,48,87,71,111,92,88,76,88,84,73,75,88,78,113,78,73,73,68,72,61,72,68,44,72,73,38,37,70,38,106,73,69,72,72,53,60,48,73,66,93,65,66,59,82,86,85,70,90,77,77,132,73,95,95,91,89,111,95,88,95,76,80,75,82,100,78,97,92,127,133,96,121,83,80,129,89,68,70,70,62,81,68,68,101,64,75,75,73,74,87,74,69,74,72,61,62,66,100,65,75,74,108,111,77,101,68,61,103,74'),
};
export function textWidth(s, bold) {
  const t = bold ? WIDTH.bold : WIDTH.regular;
  let w = 0;
  for (const c of String(s)) w += t.get(c) ?? 0.75;
  return w;
}

// Цвета секторов: по ветвям (отцовская и материнская линии) или по поколениям; дальние кольца светлее.
const PALETTE = {
  classic: { father: '#d9e3cc', mother: '#f0d9cb', gens: ['#eadcbc', '#dbe5cb', '#d6e2ec', '#efd9e1', '#e6e0c8', '#d5eae2', '#e6dbef', '#f1e5cf'], center: '#fbf6ec', line: '#6b5a45' },
  modern: { father: '#cfe2fb', mother: '#fbd5e3', gens: ['#ffe2a8', '#c9ecd2', '#cfe2fb', '#fbd5e3', '#e2d6fb', '#c9eceb', '#fbe0c9', '#e5f2c4'], center: '#ffffff', line: '#555555' },
  bw: { father: '#ffffff', mother: '#ebebeb', gens: ['#ffffff', '#ebebeb'], center: '#ffffff', line: '#000000' },
};
const mix = (hex, k) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k) + 255 * k).toString(16).padStart(2, '0')).join('')}`;

export function fanColors(theme) {
  return PALETTE[theme] || PALETTE.classic;
}

function sectorFill(pal, colors, s) {
  if (!s.id) return '#ffffff';
  if (colors === 'gens') return pal.gens[(s.gen - 1) % pal.gens.length];
  return mix(pal[s.side], pal === PALETTE.bw ? 0 : (s.gen - 1) * 0.07);
}

const rad = (a) => (a * Math.PI) / 180;
const pt = (r, a) => [r * Math.cos(rad(a)), r * Math.sin(rad(a))];

// Контур сектора для SVG и pdfkit (doc.path).
export function sectorPath(s) {
  const f = (v) => Math.round(v * 100) / 100;
  const [a, b] = [pt(s.r0, s.a0), pt(s.r1, s.a0)];
  const [c, d] = [pt(s.r1, s.a1), pt(s.r0, s.a1)];
  const big = s.a1 - s.a0 > 180 ? 1 : 0;
  const inner = `L${f(d[0])},${f(d[1])}A${f(s.r0)},${f(s.r0)} 0 ${big} 0 ${f(a[0])},${f(a[1])}`;
  return `M${f(a[0])},${f(a[1])}L${f(b[0])},${f(b[1])}A${f(s.r1)},${f(s.r1)} 0 ${big} 1 ${f(c[0])},${f(c[1])}${inner}Z`;
}

export function parseFanOptions(qs) {
  const gens = Math.round(Number(qs.gens));
  return {
    gens: Number.isFinite(gens) ? Math.min(FAN.gens[1], Math.max(FAN.gens[0], gens)) : 5,
    shape: FAN.shapes.includes(Number(qs.shape)) ? Number(qs.shape) : 180,
    colors: qs.colors === 'gens' ? 'gens' : 'branch',
    empty: qs.empty !== '0',
  };
}

// ---------- Подписи ----------

const L = (text, k = 1, bold = false) => ({ text, k, bold });

// Варианты подписи от полного к короткому: имя и фамилия, годы; дальше — инициалы, без лет, только фамилия.
// Женщина — с фамилией при рождении в скобках: «Смирнова (Орлова)».
export function nameVariants(p, years) {
  const S = p.surname || '';
  const B = p.birth_surname && p.birth_surname !== S ? p.birth_surname : '';
  const SB = B ? (S ? `${S} (${B})` : B) : S;
  const gp = [p.given, p.patronymic].filter(Boolean);
  const ini = gp.map((x) => `${[...x][0]}.`).join(' ');
  const Y = years ? [{ ...L(years, 0.85), years: true }] : [];
  const out = [];
  if (SB) {
    if (B && S && gp.length) out.push([L(S, 1, true), L(`(${B})`, 0.85), L(gp.join(' ')), ...Y]);
    if (gp.length) out.push([L(SB, 1, true), L(gp.join(' ')), ...Y]);
    if (gp.length > 1) out.push([L(SB, 1, true), L(p.given), ...Y]);
    if (gp.length) out.push([L(SB, 1, true), L(ini), ...Y]);
    if (B && S && gp.length) out.push([L(S, 1, true), L(`(${B}) ${ini}`, 0.85), ...Y]);
    out.push([L(`${SB} ${ini}`.trim(), 1, true), ...Y]);
    if (B && S) out.push([L(`${S} ${ini}`.trim(), 1, true), ...Y]);
    out.push([L(`${S || B} ${ini}`.trim(), 1, true)]);
    if (ini) out.push([L(S || B, 1, true)]);
    out.push([L([S || B, ...gp].map((x) => `${[...x][0]}.`).join(' '), 1, true)]);
  } else {
    const G = gp.join(' ') || 'Без имени';
    out.push([L(G, 1, true), ...Y]);
    if (gp.length > 1) out.push([L(p.given, 1, true), ...Y], [L(p.given, 1, true)]);
    out.push([L(G, 1, true)]);
    out.push([L(gp.length ? ini : 'Б. и.', 1, true)]);
  }
  // Двойная фамилия переносится по дефису: «Воронцова-» / «Дашкова».
  const split = out.flatMap((v) => {
    const i = v[0].text.indexOf('-');
    if (i < 1) return [v];
    return [v, [{ ...v[0], text: v[0].text.slice(0, i + 1) }, { ...v[0], text: v[0].text.slice(i + 1) }, ...v.slice(1)]];
  });
  const seen = new Set();
  return split.filter((v) => {
    const key = JSON.stringify(v);
    return !seen.has(key) && seen.add(key);
  });
}

// Строки с размером f: высота каждой и ширина.
const measure = (lines, f) => lines.map((l) => ({ ...l, h: l.k * f * LH, w: textWidth(l.text, l.bold) * l.k * f }));

// Поперёк луча (по дуге): строки стопкой от внешнего края к внутреннему. Возвращает строки с радиусами или null.
function tangential(s, lines, f, pad) {
  const m = measure(lines, f);
  const T = m.reduce((a, l) => a + l.h, 0);
  if (T - 2 * LEAD * f > s.r1 - s.r0 - 2 * pad) return null;
  const half = rad(s.a1 - s.a0) / 2;
  const rm = (s.r0 + s.r1) / 2;
  const flip = Math.sin(rad((s.a0 + s.a1) / 2)) > 0.01; // нижняя половина — читаем снизу
  let off = -T / 2;
  for (const l of m) {
    const rc = flip ? rm + off + l.h / 2 : rm - off - l.h / 2;
    off += l.h;
    const lo = rc - l.h / 2 + LEAD * l.k * f;
    const hi = rc + l.h / 2 - LEAD * l.k * f;
    if (half < Math.PI / 2 && l.w / 2 > lo * Math.tan(half) - pad) return null;
    if (Math.hypot(hi, l.w / 2) > s.r1 - pad) return null;
    l.rc = rc;
  }
  return { m, flip };
}

// Вдоль луча: строки рядом, каждая — по центру кольца.
function radial(s, lines, f, pad) {
  const m = measure(lines, f);
  const T = m.reduce((a, l) => a + l.h, 0);
  const half = rad(s.a1 - s.a0) / 2;
  const rm = (s.r0 + s.r1) / 2;
  let off = -T / 2;
  for (const l of m) {
    const d = Math.max(Math.abs(off), Math.abs(off + l.h)) - LEAD * l.k * f;
    off += l.h;
    const inner = rm - l.w / 2;
    const outer = rm + l.w / 2;
    if (inner < s.r0 + pad) return null;
    if (half < Math.PI / 2 && d > inner * Math.tan(half) - pad) return null;
    if (Math.hypot(outer, d) > s.r1 - pad) return null;
  }
  return { m };
}

// Самый крупный размер в [lo, hi], при котором fit удаётся.
function largest(fit, lo, hi) {
  if (!fit(lo)) return null;
  if (fit(hi)) return hi;
  let [a, b] = [lo, hi];
  for (let i = 0; i < 14; i++) {
    const c = (a + b) / 2;
    if (fit(c)) a = c; else b = c;
  }
  return a;
}

// Для каждого варианта подписи — самый крупный размер, при котором он помещается, и как лучше лечь: по дуге или вдоль луча.
function fitsFor(s, variants, lo, hi, pad) {
  return variants.map((lines) => {
    const opts = [];
    const min = lo / Math.min(...lines.map((l) => l.k)); // и годы не мельче читаемого
    for (const [kind, fn] of [['tangential', tangential], ['radial', radial]]) {
      const f = largest((x) => fn(s, lines, x, pad), min, Math.max(min, hi));
      if (f) opts.push({ kind, f, min, lines, dated: lines.some((l) => l.years) });
    }
    return opts.sort((x, y) => y.f - x.f)[0] || null;
  });
}

// Вариант для сектора: в кольце один размер (cap), чтобы соседи не были вразнобой. Самый полный вариант, который
// помещается этим размером; если ни один — чуть мельче, но не меньше читаемого. Годы оставляем, пока помещаются.
function choose(fits, cap, lo) {
  for (const k of [1, 0.85, 0.7, 0.55, 0.4]) {
    const need = Math.max(lo, cap * k);
    const ok = fits.find((x) => x && x.dated && x.f >= need) || fits.find((x) => x && x.f >= need);
    if (ok) return { ...ok, f: Math.max(ok.min, Math.min(ok.f, cap)) };
  }
  return fits.find(Boolean) || null;
}

// Строки на месте: центр, поворот, размер (в единицах раскладки).
function placeLines(s, best, pad) {
  if (!best) return { orient: null, lines: [] };
  const mid = (s.a0 + s.a1) / 2;
  if (best.kind === 'tangential') {
    const r = tangential(s, best.lines, best.f, pad);
    const rot = r.flip ? mid - 90 : mid + 90;
    return {
      orient: 'tangential',
      lines: r.m.map((l) => {
        const [x, y] = pt(l.rc, mid);
        return { text: l.text, bold: l.bold, size: l.k * best.f, x, y, rot };
      }),
    };
  }
  // вдоль луча: справа читается от середины наружу, слева — снаружи к середине
  const m = measure(best.lines, best.f);
  const left = Math.cos(rad(mid)) < -0.01;
  const rot = left ? mid + 180 : mid;
  const [cx, cy] = pt((s.r0 + s.r1) / 2, mid);
  const ny = [-Math.sin(rad(rot)), Math.cos(rad(rot))]; // «вниз» для повёрнутого текста
  let off = -m.reduce((a, l) => a + l.h, 0) / 2;
  return {
    orient: 'radial',
    lines: m.map((l) => {
      const o = off + l.h / 2;
      off += l.h;
      return { text: l.text, bold: l.bold, size: l.k * best.f, x: cx + ny[0] * o, y: cy + ny[1] * o, rot };
    }),
  };
}

// Середина: фото (по желанию), ФИО, годы — по горизонтали, в круге или полукруге.
function placeCenter(c, p, years, lo, hi, photo, half) {
  const R = c.r1;
  const pad = FAN.pad * 2;
  const S = p.surname || '';
  const B = p.birth_surname && p.birth_surname !== S ? p.birth_surname : '';
  const gp = [p.given, p.patronymic].filter(Boolean).join(' ');
  const Y = years ? [L(years, 0.85)] : [];
  const variants = [
    ...(S ? [[L(S, 1.1, true), ...(B ? [L(`(${B})`, 0.85)] : []), ...(gp ? [L(gp)] : []), ...Y]] : []),
    ...nameVariants(p, years),
  ];
  // Ширина строки на высоте y в круге радиуса R.
  const span = (y) => (Math.abs(y) >= R ? 0 : 2 * Math.sqrt(R * R - y * y) - 2 * pad);
  const tryFit = (lines, f, ph) => {
    const m = measure(lines, f);
    const T = m.reduce((a, l) => a + l.h, 0) + (ph ? ph + f * 0.4 : 0);
    let top;
    if (half) {
      top = -pad - T;
      if (top < -R + pad) return null;
    } else {
      top = -T / 2;
      if (T > 2 * (R - pad)) return null;
    }
    let y = top;
    let box = null;
    if (ph) {
      if (span(y) < ph || span(y + ph) < ph) return null;
      box = { x: -ph / 2, y, w: ph, h: ph };
      y += ph + f * 0.4;
    }
    for (const l of m) {
      if (l.w > span(y) || l.w > span(y + l.h)) return null;
      l.y = y + l.h / 2;
      y += l.h;
    }
    return { m, box };
  };
  for (const ph of photo ? [R * (half ? 0.42 : 0.55), R * 0.3, 0] : [0]) {
    for (const lines of variants) {
      const f = largest((x) => tryFit(lines, x, ph), lo / Math.min(...lines.map((l) => l.k)), hi);
      if (!f) continue;
      const r = tryFit(lines, f, ph);
      return { photo: r.box, lines: r.m.map((l) => ({ text: l.text, bold: l.bold, size: l.k * f, x: 0, y: l.y, rot: 0 })) };
    }
  }
  return { photo: null, lines: [] };
}

// ---------- Раскладка ----------

// Предки по поколениям, как в росписи по Аненталю: у номера k отец — 2k, мать — 2k + 1.
// Один и тот же предок по двум линиям попадает в оба места; человек не может оказаться собственным предком.
function ancestors(idx, root, gens) {
  const out = new Map([[1, root]]);
  const walk = (k, path) => {
    if (Math.floor(Math.log2(k)) >= gens) return;
    const [father, mother] = fatherMother(idx, out.get(k));
    for (const [n, id] of [[2 * k, father], [2 * k + 1, mother]]) {
      if (!id || path.has(id)) continue;
      out.set(n, id);
      walk(n, new Set([...path, id]));
    }
  };
  walk(1, new Set([root]));
  return out;
}

export function fanGeometry(idx, root, opts) {
  const { gens, shape } = opts;
  const anc = ancestors(idx, root, gens);
  const radii = [FAN.center];
  for (let g = 1; g <= gens; g++) radii.push(radii[g - 1] + FAN.rings[g - 1]);
  const start = 270 - shape / 2;
  const sectors = [];
  for (let g = 1; g <= gens; g++) {
    const n = 2 ** g;
    for (let i = 0; i < n; i++) {
      const k = n + i;
      const id = anc.get(k) || null;
      // Неизвестный предок у известного человека — пустое место всегда; дальше — по галочке «пустые места».
      if (!id && !anc.get(k >> 1) && !opts.empty) continue;
      sectors.push({
        k, gen: g, id, side: i < n / 2 ? 'father' : 'mother',
        a0: start + (shape * i) / n, a1: start + (shape * (i + 1)) / n, r0: radii[g - 1], r1: radii[g],
      });
    }
  }
  // Рамка: внешняя дуга, середина и угол у центра.
  const R = radii[gens];
  const xs = [0];
  const ys = [0];
  const add = ([x, y]) => { xs.push(x); ys.push(y); };
  add(pt(R, start));
  add(pt(R, start + shape));
  for (let a = Math.ceil(start / 90) * 90; a <= start + shape; a += 90) add(pt(R, a));
  if (shape > 180) for (let a = 0; a < 360; a += 90) add(pt(FAN.center, a));
  ys.push(FAN.pad * 2);
  const bounds = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  return { root, gens, shape, sectors, center: { r0: 0, r1: FAN.center }, bounds, people: new Set(anc.values()).size };
}

// Полная раскладка под бумагу: секторы с цветами, подписи с подобранным размером, листы.
// o — настройки печати (бумага, крупность, оформление, скрыть живых, фото) и веера (gens, shape, colors, empty).
export function layoutFan(idx, root, o) {
  const geo = fanGeometry(idx, root, o);
  const plan = planPages(geo, o);
  const s = plan.s; // пунктов на единицу
  const pal = fanColors(o.theme);
  const years = (p) => (p.hidden || (o.hideLiving && isPrivate(p)) ? '' : lifespan(p));
  const size = (g) => [FAN.minPt / s, Math.max(FAN.minPt, FAN.maxPt[Math.min(g, FAN.maxPt.length - 1)]) / s];
  const pad = FAN.padPt / s;
  let crowded = 0;
  const known = geo.sectors.filter((sec) => sec.id);
  for (const sec of geo.sectors) {
    sec.fill = sectorFill(pal, o.colors, sec);
    sec.lines = [];
  }
  for (const sec of known) {
    const p = idx.persons.get(sec.id);
    sec.fits = fitsFor(sec, nameVariants(p, years(p)), ...size(sec.gen), pad);
  }
  // Размер кольца: такой, чтобы полная подпись поместилась у большинства (у остальных — сокращение).
  for (let g = 1; g <= geo.gens; g++) {
    const ring = known.filter((sec) => sec.gen === g);
    const [lo] = size(g);
    const full = ring.map((sec) => sec.fits[0]?.f || lo).sort((x, y) => x - y);
    const cap = full[Math.floor(full.length * 0.3)];
    for (const sec of ring) {
      Object.assign(sec, placeLines(sec, choose(sec.fits, cap, lo), pad));
      delete sec.fits;
      if (!sec.lines.length) crowded++;
    }
  }
  const p = idx.persons.get(root);
  const photo = Boolean(o.photos && p.photo_id && !p.hidden && !(o.hideLiving && isPrivate(p)));
  const [lo, hi] = size(0);
  Object.assign(geo.center, { id: root, fill: pal.center }, placeCenter(geo.center, p, years(p), lo, hi, photo, geo.shape === 180));
  return { ...geo, plan, line: pal.line, crowded };
}
