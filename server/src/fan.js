// Веерная схема предков в PDF: рисует готовую раскладку shared/fan.js (та же, что на экране) в единицах раскладки.
import { sectorPath } from '../../shared/fan.js';
import { THEMES } from './routes/print.js';

export function drawFan(doc, fan, o) {
  const t = THEMES[o.theme] || THEMES.classic;
  const s = fan.plan.s;
  const text = (l, color) => {
    doc.font(l.bold ? t.bold : t.font).fontSize(l.size).fillColor(color);
    const w = doc.widthOfString(l.text);
    doc.save().translate(l.x, l.y).rotate(l.rot);
    doc.text(l.text, -w / 2, -doc.currentLineHeight() / 2, { lineBreak: false });
    doc.restore();
  };
  // Секторы: известные — цветом и рамкой, неизвестные — пустые с тонкой рамкой, чтобы вписать от руки.
  for (const sec of fan.sectors) {
    doc.path(sectorPath(sec)).lineWidth((sec.id ? 0.9 : 0.4) / s).lineJoin('round');
    if (sec.id) doc.fillAndStroke(sec.fill, fan.line);
    else doc.stroke(fan.line);
  }
  for (const sec of fan.sectors) for (const l of sec.lines || []) text(l, '#1d1d1d');

  // Середина.
  const c = fan.center;
  const half = fan.shape === 180;
  doc.path(half ? `M${-c.r1},0A${c.r1},${c.r1} 0 0 1 ${c.r1},0Z` : `M${-c.r1},0A${c.r1},${c.r1} 0 1 1 ${c.r1},0A${c.r1},${c.r1} 0 1 1 ${-c.r1},0Z`)
    .lineWidth(1.4 / s).fillAndStroke(c.fill, fan.line);
  if (c.photo && c.file) {
    const b = c.photo;
    try {
      doc.save().roundedRect(b.x, b.y, b.w, b.h, b.w * 0.08).clip();
      doc.image(c.file, b.x, b.y, { cover: [b.w, b.h], align: 'center', valign: 'center' });
      doc.restore();
      doc.roundedRect(b.x, b.y, b.w, b.h, b.w * 0.08).lineWidth(0.6 / s).stroke(fan.line);
    } catch { doc.restore(); }
  }
  for (const l of c.lines) text(l, l.bold ? t.title : '#1d1d1d');
}
