// Общее для печатных листов A4 (карточка человека, бланк анкеты): шрифты DejaVu, поля, подвал на каждой странице,
// перенос блоков на следующую страницу. Весь напечатанный текст записывается в doc.printed — по нему проверяют тесты.
import PDFDocument from 'pdfkit';
import { FONTS, THEMES } from './routes/print.js';
import { todayText } from '../../shared/names.js';

export const A4 = { w: 595.28, h: 841.89 };
export const MARGIN = { top: 48, bottom: 64, left: 50, right: 50 };
export const WIDTH = A4.w - MARGIN.left - MARGIN.right;

// Цвета листа по оформлению печати дерева: заголовки, линии, подписи.
export function colors(theme) {
  const t = THEMES[theme] || THEMES.classic;
  return {
    font: t.font, bold: t.bold, title: t.title, line: t.line,
    accent: theme === 'modern' ? '#2f6fd6' : t.title,
    muted: theme === 'bw' ? '#333333' : '#666666',
    text: theme === 'bw' ? '#000000' : '#1d1d1d',
    soft: theme === 'bw' ? '#ffffff' : theme === 'modern' ? '#eef4fd' : '#f6f0e6',
  };
}

export function newDoc(title) {
  const doc = new PDFDocument({ size: 'A4', margins: MARGIN, bufferPages: true, info: { Title: title, Creator: 'Древо' } });
  for (const [k, f] of Object.entries(FONTS)) doc.registerFont(k, f);
  doc.printed = [];
  const text = doc.text.bind(doc);
  doc.text = (s, ...rest) => {
    if (s !== undefined && s !== null && String(s) !== '') doc.printed.push(String(s));
    return text(s, ...rest);
  };
  return doc;
}

export const bottom = (doc) => doc.page.height - doc.page.margins.bottom;

// Нужно h пунктов: не помещается — с новой страницы.
export function ensure(doc, h) {
  if (doc.y + h > bottom(doc)) doc.addPage();
  doc.x = doc.page.margins.left;
}

// Над подвалом есть запас: туда можно дописать последнюю строку-другую, чтобы она не ушла одна на новую страницу.
export const SLACK = 22;

// Перед абзацем высотой h (строки по lh): помещается — пишем тут; не хватает чуть-чуть — пишем в запас над подвалом;
// иначе абзац переносится так, чтобы ни внизу, ни вверху следующей страницы не осталось одной строки.
export function place(doc, h, lh) {
  const room = bottom(doc) - doc.y;
  if (h <= room + 0.5) return;
  if (!doc.page.stretched && h <= room + SLACK) {
    doc.page.margins.bottom -= SLACK;
    doc.page.stretched = true;
    return;
  }
  const n = Math.round(h / lh);
  const fit = Math.floor((room + 0.5) / lh);
  if (fit < 2 || n - fit < 2) doc.addPage();
  doc.x = doc.page.margins.left;
}

// «21 октября 2026 года» по Москве.
export const today = () => todayText();

// Подвал на всех страницах: слева — подпись, справа — номер страницы.
export function footer(doc, c, left) {
  const range = doc.bufferedPageRange();
  doc.pageCount = range.count;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 30;
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(MARGIN.left, y - 8).lineTo(A4.w - MARGIN.right, y - 8).lineWidth(0.5).strokeColor(c.line).stroke();
    doc.font(c.font).fontSize(10).fillColor(c.muted);
    doc.text(left, MARGIN.left, y, { width: WIDTH - 90, lineBreak: false, ellipsis: true });
    if (range.count > 1) doc.text(`стр. ${i + 1} из ${range.count}`, A4.w - MARGIN.right - 90, y, { width: 90, align: 'right', lineBreak: false });
    doc.page.margins.bottom = keep;
  }
}

// Имя файла для «Скачать»: латиница для старых браузеров и по-русски для остальных.
export function disposition(download, name) {
  const safe = String(name).replace(/[\u0000-\u001f"\\/:*?<>|]+/g, ' ').trim().slice(0, 80) || 'drevo';
  return `${download ? 'attachment' : 'inline'}; filename="drevo.pdf"; filename*=UTF-8''${encodeURIComponent(`${safe}.pdf`)}`;
}
