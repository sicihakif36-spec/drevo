// Разбивка печати на листы: общая для предпросмотра и PDF.
//
// Как печатать (o.fit):
//   page  — уместить на один лист выбранного формата (o.paper: A4…A0);
//   tiles — плакат из листов принтера (o.paper — лист, обычно A4), склеить с нахлёстом 1 см. Насколько крупно (o.size):
//     read   — «Читаемо»: самый мелкий текст не мельче READ_PT, листов — сколько понадобится;
//     A3…A0  — плакат размером с этот формат;
//     scale  — своя крупность o.scale в процентах (100 % — карточка шириной около 42 мм).

export const MM = 72 / 25.4;
export const PAPER = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };
export const SIZES = ['read', 'A3', 'A2', 'A1', 'A0', 'scale'];
export const SCALE100 = 0.25 * MM; // пунктов на единицу раскладки при 100 %
// Самый мелкий текст дерева — годы жизни (drawTree в server/src/routes/print.js), в единицах раскладки.
export const TREE_TEXT = 10;
// «Читаемо»: годы жизни 9 пт, имена — 11 пт, как в книге с крупным шрифтом.
export const READ_PT = 9;

const MARGIN = 10 * MM;
const HEAD = 14 * MM;
const OVERLAP = 10 * MM;

// Плакат крупнее листа: годятся только форматы больше листа принтера.
export const posters = (paper) => Object.keys(PAPER).filter((p) => PAPER[p][0] > PAPER[paper][0]);

const sizes = ([w, h], orient) => (orient === 'landscape' ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)]);
const orients = (o) => (o.orient === 'portrait' || o.orient === 'landscape' ? [o.orient] : ['portrait', 'landscape']);

// Уместить на один лист формата paper: самый крупный масштаб из двух положений листа.
function onePage(paper, o, cw, ch) {
  const opts = orients(o).map((orient) => {
    const [pw, ph] = sizes(PAPER[paper].map((v) => v * MM), orient);
    const s = Math.min((pw - 2 * MARGIN) / cw, (ph - 2 * MARGIN - HEAD) / ch);
    return { orient, pw, ph, s };
  });
  return opts.sort((x, y) => y.s - x.s)[0];
}

// Масштаб плаката из листов (пунктов на единицу); read — масштаб «Читаемо» (у веера свой, см. shared/fan.js).
export function tileScale(layout, o, read = READ_PT / TREE_TEXT) {
  const size = SIZES.includes(o.size) ? o.size : 'scale';
  if (size === 'read') return read;
  if (PAPER[size] && posters(o.paper).includes(size)) {
    const pad = 20;
    return onePage(size, { orient: 'auto' }, layout.bounds.w + pad * 2, layout.bounds.h + pad * 2).s;
  }
  return (o.scale / 100) * SCALE100;
}

// s — масштаб плаката, если уже известен (веер подбирает «Читаемо» сам).
export function planPages(layout, o, s = null) {
  const b = layout.bounds;
  const pad = 20;
  const cw = b.w + pad * 2;
  const ch = b.h + pad * 2;
  const base = { margin: MARGIN, head: HEAD, cw, ch, pad };
  if (o.fit === 'page') return { ...onePage(o.paper, o, cw, ch), cols: 1, rows: 1, overlap: 0, ...base };
  s ??= tileScale(layout, o);
  const opts = orients(o).map((orient) => {
    const [pw, ph] = sizes(PAPER[o.paper].map((v) => v * MM), orient);
    const aw = pw - 2 * MARGIN - OVERLAP;
    const ah = ph - 2 * MARGIN - HEAD - OVERLAP;
    const cols = Math.max(1, Math.ceil((cw * s - OVERLAP) / aw));
    const rows = Math.max(1, Math.ceil((ch * s - OVERLAP) / ah));
    // «Читаемо»: листов уже столько, сколько нужно, — пусть дерево займёт их целиком (но не больше чем на четверть крупнее).
    const fill = o.size === 'read' ? Math.min(1.25 * s, (cols * aw + OVERLAP) / cw, (rows * ah + OVERLAP) / ch) : s;
    return { orient, pw, ph, s: Math.max(s, fill), cols, rows };
  });
  const best = opts.sort((x, y) => x.cols * x.rows - y.cols * y.rows || y.s - x.s)[0];
  return { ...best, overlap: OVERLAP, ...base };
}

// Как читается самый мелкий текст (в пунктах на бумаге): для подсказки под предпросмотром.
export function legibility(pt) {
  if (pt < 4.5) return { level: 'bad', text: 'очень мелко — не прочитать' };
  if (pt < 6.5) return { level: 'warn', text: 'мелко — читается с трудом' };
  if (pt < 8.5) return { level: 'ok', text: 'читается' };
  return { level: 'good', text: 'крупно, читается легко' };
}
