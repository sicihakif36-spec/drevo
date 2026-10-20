// Разбивка печати на листы: общая для предпросмотра и PDF.

export const MM = 72 / 25.4;
export const PAPER = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };
// Сколько листов получится — для подсказки в интерфейсе.

export function planPages(layout, o) {
  const margin = 10 * MM;
  const head = 14 * MM;
  const overlap = 10 * MM;
  const [pw0, ph0] = PAPER[o.paper].map((v) => v * MM);
  const b = layout.bounds;
  const pad = 20;
  const cw = b.w + pad * 2;
  const ch = b.h + pad * 2;
  const sizes = (orient) => (orient === 'landscape' ? [Math.max(pw0, ph0), Math.min(pw0, ph0)] : [Math.min(pw0, ph0), Math.max(pw0, ph0)]);
  if (o.fit === 'page') {
    const opts = (o.orient === 'auto' ? ['portrait', 'landscape'] : [o.orient]).map((orient) => {
      const [pw, ph] = sizes(orient);
      const s = Math.min((pw - 2 * margin) / cw, (ph - 2 * margin - head) / ch);
      return { orient, pw, ph, s };
    });
    const best = opts.sort((x, y) => y.s - x.s)[0];
    return { ...best, cols: 1, rows: 1, margin, head, overlap: 0, cw, ch, pad };
  }
  const s = (o.scale / 100) * 0.25 * MM; // 100 % — карточка шириной около 42 мм
  const opts = (o.orient === 'auto' ? ['portrait', 'landscape'] : [o.orient]).map((orient) => {
    const [pw, ph] = sizes(orient);
    const aw = pw - 2 * margin;
    const ah = ph - 2 * margin - head;
    const cols = Math.max(1, Math.ceil((cw * s - overlap) / (aw - overlap)));
    const rows = Math.max(1, Math.ceil((ch * s - overlap) / (ah - overlap)));
    return { orient, pw, ph, s, cols, rows };
  });
  const best = opts.sort((x, y) => x.cols * x.rows - y.cols * y.rows)[0];
  return { ...best, margin, head, overlap, cw, ch, pad };
}

