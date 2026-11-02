// Рамка человека на печати дерева: что в ней написано, где и каким кеглем. Общая для PDF (server/src/routes/print.js)
// и предпросмотра на телефоне — на экране видно ровно то, что будет на бумаге. Единицы — как у раскладки (BOX).
import { BOX } from './layout.js';
import { isPrivate, lifespan, shortName } from './names.js';
import { textWidth } from './fan.js';

// Обрезать строку с многоточием, чтобы поместилась в ширину w при кегле size.
function clip(text, size, w, bold) {
  const s = String(text || '');
  if (textWidth(s, bold) * size <= w) return s;
  const chars = [...s];
  while (chars.length && (textWidth(chars.join(''), bold) + textWidth('…', bold)) * size > w) chars.pop();
  return chars.join('').trimEnd() + '…';
}

// p — человек, o — настройки печати (photos, hideLiving); hasPhoto — есть ли файл фото (на сервере — проверен диск).
// Строки: y — верх строки (как у pdfkit), size — кегль, bold, color.
export function treeCard(p, o, hasPhoto = Boolean(p.photo_id)) {
  const hidden = o.hideLiving && isPrivate(p);
  const photo = Boolean(o.photos && p.photo_id && hasPhoto && !hidden);
  const tx = photo ? BOX.h : 8;
  const w = BOX.w - 6 - tx;
  const nm = shortName(p);
  const life = hidden ? '' : lifespan(p);
  const lines = [{ text: clip(nm.last || nm.first, 12.5, w, true), size: 12.5, y: 9, bold: true, color: '#1d1d1d' }];
  if (nm.last) lines.push({ text: clip(nm.first, 11, w, false), size: 11, y: 27, bold: false, color: '#1d1d1d' });
  if (life) lines.push({ text: clip(life, 10, w, false), size: 10, y: 50, bold: false, color: '#555555' });
  return { photo, tx, w, lines: lines.filter((l) => l.text) };
}
