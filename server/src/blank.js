// Бумажный бланк анкеты: те же шаги, роли и поля, что у анкеты по ссылке (shared/survey.js), с линиями для письма от руки
// и квадратиками для галочек. Ничего из дерева на бланке нет — только имя того, кого опрашиваем, если его указали.
import { FIELDS, ROLES, STEPS } from '../../shared/survey.js';
import { MARGIN, WIDTH, bottom, colors, ensure, footer, newDoc } from './pdf.js';

const L = MARGIN.left;
const LABEL = 11.5;
const WRITE = 23; // высота строки для письма
const CELL = LABEL + 4 + WRITE;
const GAP = 16;

// Сколько пустых мест у роли: у «много» — paper, у остальных одно.
export const placesFor = (role) => (ROLES[role].many ? ROLES[role].paper || 1 : 1);

// Поля человека на бумаге — по тем же правилам, что на телефоне: пол не спрашиваем, если он ясен из роли (отец, бабушка),
// у самого опрашиваемого — ни «жив или умер», ни даты и места смерти.
export function paperFields(role) {
  const out = FIELDS.filter((f) => !(f.kind === 'sex' && ROLES[role].sex) && !((f.kind === 'living' || f.dead) && role === 'self'));
  // Ребёнок при нескольких браках: от какого брака (рядом с родом занятий).
  if (role === 'child' && placesFor('spouse') > 1) {
    out.splice(out.findIndex((f) => f.key === 'occupation') + 1, 0, { key: 'parent2', label: 'Второй родитель', hint: 'если браков несколько' });
  }
  return out;
}

// Доля ширины строки: имена — по три в строке, дата — уже места, галочкам — место под две подписи, длинные поля — на всю строку.
const SHARE = { birth_surname: 0.4, occupation: 0.5, parent2: 0.5 };
const share = (f) => (f.kind === 'text' ? 1 : f.kind === 'place' ? 0.65 : f.kind === 'sex' ? 0.25 : ['date', 'living'].includes(f.kind) ? 0.35 : SHARE[f.key] || 1 / 3);
// Поля по строкам: кладём подряд, пока помещаются; в строке поля растягиваются на всю ширину.
export function paperRows(fields) {
  const rows = [];
  let used = 1;
  for (const f of fields) {
    if (used + share(f) > 1.001) {
      rows.push([]);
      used = 0;
    }
    rows.at(-1).push(f);
    used += share(f);
  }
  return rows;
}
const rowHeight = (row) => (row.length === 1 && row[0].paperLines ? LABEL + 4 + WRITE * row[0].paperLines : CELL);
const blockHeight = (role) => 24 + paperRows(paperFields(role)).reduce((a, row) => a + rowHeight(row) + 5, 0);

export const HOW = '1. В приложении «Главная → Анкеты» создайте анкету для этого человека.\n'
  + '2. Откройте ссылку анкеты сами, заполните её по этому бланку и нажмите «Отправить».\n'
  + '3. Откройте анкету в списке «Отправленные», проверьте и нажмите «Загрузить в дерево».';

export function renderBlank(stream, { name = '' } = {}) {
  const c = colors('bw');
  const doc = newDoc('Анкета о семье');
  doc.pipe(stream);
  const line = (x, y, w) => doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.7).strokeColor('#8a8a8a').stroke();
  // Подпись поля и подсказка серым рядом, если подсказка помещается в строку.
  const label = (f, x, y, w) => {
    doc.font(c.bold).fontSize(LABEL).fillColor(c.text).text(f.label, x, y, { lineBreak: false });
    const lw = doc.widthOfString(f.label) + 8;
    const hint = f.hint || f.placeholder;
    doc.font(c.font).fontSize(LABEL - 2);
    if (hint && lw + doc.widthOfString(hint) <= w) doc.fillColor(c.muted).text(hint, x + lw, y + 2, { lineBreak: false });
  };
  // Квадратик для галочки с подписью; возвращает, где начать следующий.
  const box = (x, y, text) => {
    doc.rect(x, y, 14, 14).lineWidth(1).strokeColor(c.text).stroke();
    doc.font(c.font).fontSize(12).fillColor(c.text).text(text, x + 19, y + 1, { lineBreak: false });
    return x + 19 + doc.widthOfString(text) + 12;
  };
  const cell = (f, x, y, w, her) => {
    label(f, x, y, w);
    const wy = y + LABEL + 4;
    if (f.kind === 'sex') {
      box(box(x, wy + 4, 'М'), wy + 4, 'Ж');
    } else if (f.kind === 'living') {
      box(box(x, wy + 4, her === false ? 'Жив' : her ? 'Жива' : 'Жив(а)'), wy + 4, her === false ? 'Умер' : her ? 'Умерла' : 'Умер(ла)');
    } else {
      for (let i = 1; i <= (f.paperLines || 1); i++) line(x, wy + WRITE * i - 2, w);
    }
  };
  const personBlock = (role, n) => {
    const r = ROLES[role];
    const rows = paperRows(paperFields(role));
    const title = `${r.paperLabel || r.label}${r.many ? ` — ${n}` : ''}`;
    const h = blockHeight(role);
    ensure(doc, h);
    const top = doc.y;
    doc.font(c.bold).fontSize(15).fillColor(c.title).text(title, L, top, { width: WIDTH });
    let y = top + 24;
    const her = r.sex ? r.sex === 'F' : undefined;
    for (const row of rows) {
      let x = L;
      const free = WIDTH - GAP * (row.length - 1);
      const total = row.reduce((a, f) => a + share(f), 0);
      for (const f of row) {
        const w = row.length === 1 ? WIDTH : (free * share(f)) / total;
        cell(f, x, y, w, her);
        x += w + GAP;
      }
      y += rowHeight(row) + 5;
    }
    doc.y = top + h + 10;
    doc.x = L;
  };
  const stepHead = (s, i, next = 60) => {
    ensure(doc, 60 + next);
    doc.font(c.bold).fontSize(19).fillColor(c.title).text(`${i}. ${s.title}`, L, doc.y, { width: WIDTH });
    const hint = s.paperHint || s.hint;
    if (hint) doc.font(c.font).fontSize(12.5).fillColor(c.muted).text(hint, L, doc.y + 2, { width: WIDTH, lineGap: 1 });
    doc.moveDown(0.6);
  };

  // Шапка.
  doc.font(c.bold).fontSize(26).fillColor(c.title).text('Анкета о семье', L, doc.y, { width: WIDTH });
  doc.moveDown(0.4);
  const headLine = (text, value) => {
    const y = doc.y + 6;
    doc.font(c.bold).fontSize(14).fillColor(c.text).text(text, L, y, { lineBreak: false });
    const x = L + doc.widthOfString(text) + 8;
    if (value) doc.font(c.font).fontSize(15).fillColor(c.text).text(value, x + 4, y - 1, { width: L + WIDTH - x - 4, lineBreak: false, ellipsis: true });
    line(x, y + 17, L + WIDTH - x);
    doc.y = y + 30;
    doc.x = L;
  };
  headLine('Кого опрашиваем:', name);
  headLine('Кто записал, когда:', '');
  doc.moveDown(0.3);
  doc.font(c.font).fontSize(12.5).fillColor(c.text).text('Спрашивайте по порядку и записывайте, что человек помнит. Чего не знает — оставьте пустым. '
    + 'Годы можно писать примерно: «около 1930». В квадратиках ставьте галочку.', L, doc.y, { width: WIDTH, lineGap: 2 });
  doc.moveDown(1);

  // Шаги: люди, потом фото; рассказ — последней страницей.
  const steps = [...STEPS.filter((s) => !s.story), ...STEPS.filter((s) => s.story)];
  steps.forEach((s, i) => {
    if (s.story) {
      // Рассказу — страница с линиями: новая, если на этой меньше двух третей места.
      if (bottom(doc) - doc.y < (bottom(doc) - MARGIN.top) * 0.66) doc.addPage();
      stepHead(s, i + 1, 0);
      // Внизу — как перенести ответы; линии — до неё.
      doc.font(c.font).fontSize(11.5);
      const help = 26 + doc.heightOfString(HOW, { width: WIDTH, lineGap: 2 });
      let y = doc.y + WRITE - 4;
      while (y < bottom(doc) - help - 6) {
        line(L, y, WIDTH);
        y += WRITE;
      }
      doc.y = bottom(doc) - help + 6;
      doc.font(c.bold).fontSize(13).fillColor(c.text).text('Как перенести ответы в дерево', L, doc.y, { width: WIDTH });
      doc.font(c.font).fontSize(11.5).fillColor(c.text).text(HOW, L, doc.y + 3, { width: WIDTH, lineGap: 2 });
      return;
    }
    if (s.photos) {
      stepHead(s, i + 1, WRITE * (s.paperLines || 3));
      for (let k = 1; k <= (s.paperLines || 3); k++) line(L, doc.y + WRITE * k - 4, WIDTH);
      doc.y += WRITE * (s.paperLines || 3) + 16;
      return;
    }
    stepHead(s, i + 1, blockHeight(s.roles[0]));
    for (const role of s.roles) for (let n = 1; n <= placesFor(role); n++) personBlock(role, n);
  });

  footer(doc, c, 'Анкета о семье');
  doc.end();
  return doc;
}
