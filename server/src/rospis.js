// Поколенная роспись в PDF: та же сборка, что на экране (shared/rospis.js), крупно и шрифтом с засечками, как в старых
// родословных книгах. Запись человека по возможности не рвётся между страницами, заголовок колена не остаётся внизу.
// Номера — ссылки внутри PDF: нажатие на «№ 12» ведёт к записи № 12.
import { buildIndex } from '../../shared/names.js';
import { buildRospis, partsText } from '../../shared/rospis.js';
import { eventData } from './routes/timeline.js';
import { sourceData } from './routes/sources.js';
import { A4, MARGIN, WIDTH, bottom, colors, ensure, footer, newDoc, place, today } from './pdf.js';

// События и источники для росписи — по правилам приватности: гостю и со «скрыть живых» — как гостю.
export async function rospisExtras(user, hide, o) {
  const as = hide ? { ...user, role: 'viewer' } : user;
  const [ev, src] = await Promise.all([
    o.events ? eventData(as) : { events: [] },
    o.sources ? sourceData(as) : { sources: [], citations: [] },
  ]);
  return { events: ev.events, sources: src.sources, citations: src.citations };
}

const SIZE = { title: 26, sub: 16, gen: 19, head: 13.5, text: 13, small: 11.5, index: 12 };
const GAP = 2; // межстрочный запас
const INDENT = 22; // всё, что после имени, — с отступом

export function renderRospis(stream, data, o) {
  const r = buildRospis(buildIndex(data), o.root, o, data);
  const c = colors(o.theme);
  // Текст — DejaVu Serif во всех оформлениях; в «современном» заголовки без засечек.
  const F = { text: 'serif', bold: 'serifBold', head: o.theme === 'modern' ? 'bold' : 'serifBold' };
  const doc = newDoc(r.title);
  doc.pipe(stream);
  // Где что легло — для проверок: колено и его первая запись на одной странице, короткая запись не рвётся.
  const page = () => doc.bufferedPageRange().count;
  doc.marks = [];
  const L = MARGIN.left;

  const size = (kind) => (kind === 'head' ? SIZE.head : kind === 'note' || kind === 'source' ? SIZE.small : SIZE.text);
  const indent = (kind) => (kind === 'head' ? 0 : INDENT);
  const measure = (p) => {
    doc.font(p.kind === 'head' ? F.bold : F.text).fontSize(size(p.kind));
    return doc.heightOfString(partsText(p.parts), { width: WIDTH - indent(p.kind), lineGap: GAP });
  };
  const lineH = (kind) => {
    doc.font(F.text).fontSize(size(kind));
    return doc.currentLineHeight(true) + GAP;
  };
  // Абзац из кусочков: жирное, ссылки на номера — цветом и переходом к записи.
  const write = (p, color = c.text) => {
    const width = WIDTH - indent(p.kind);
    doc.fontSize(size(p.kind));
    p.parts.forEach((x, i) => {
      doc.font(x.b ? F.bold : F.text).fillColor(x.ref ? c.accent : p.kind === 'note' || p.kind === 'source' ? c.muted : color);
      const opts = { width, lineGap: GAP, continued: i < p.parts.length - 1, goTo: x.ref ? `n${x.ref}` : undefined };
      if (i === 0) doc.text(x.t, L + indent(p.kind), doc.y, opts);
      else doc.text(x.t, opts);
    });
    doc.x = L;
  };
  const mark = (n) => doc.addNamedDestination(`n${n}`, 'XYZ', null, doc.page.height - doc.y + 6, null);

  // Шапка и вступление.
  doc.moveDown(2);
  doc.font(F.head).fontSize(SIZE.title).fillColor(c.title).text(r.title, L, doc.y, { width: WIDTH, align: 'center' });
  doc.font(F.text).fontSize(SIZE.sub).fillColor(c.muted).text(r.subtitle, L, doc.y + 4, { width: WIDTH, align: 'center' });
  const ly = doc.y + 14;
  doc.moveTo(L + WIDTH * 0.3, ly).lineTo(L + WIDTH * 0.7, ly).lineWidth(1).strokeColor(c.line).stroke();
  doc.y = ly + 18;
  for (const parts of r.intro) {
    const p = { kind: 'intro', parts };
    place(doc, measure(p), lineH('intro'));
    write({ ...p, kind: 'facts' });
    doc.moveDown(0.35);
  }

  const bodyH = A4.h - MARGIN.top - MARGIN.bottom;
  for (const g of r.gens) {
    // Заголовок колена — не внизу страницы: с ним хотя бы начало первой записи.
    // Короткая первая запись — целиком, длинная — хотя бы имя и первый абзац.
    const hs0 = g.entries[0] ? g.entries[0].paras.map(measure) : [];
    const all0 = hs0.reduce((s, h) => s + h + 4, 0);
    const firstH = all0 <= bodyH / 2 ? all0 : Math.min(hs0[0] + (hs0[1] || 0), bodyH / 3);
    doc.moveDown(1.2);
    ensure(doc, 44 + firstH);
    doc.marks.push({ gen: g.n, page: page() });
    doc.font(F.head).fontSize(SIZE.gen).fillColor(c.accent).text(g.title, L, doc.y, { width: WIDTH, align: 'center' });
    const y = doc.y + 3;
    doc.moveTo(L + WIDTH * 0.38, y).lineTo(L + WIDTH * 0.62, y).lineWidth(0.8).strokeColor(c.line).stroke();
    doc.y = y + 12;

    for (const e of g.entries) {
      const hs = e.paras.map(measure);
      const total = hs.reduce((s, h) => s + h, 0) + 4 * (hs.length - 1);
      // Запись целиком — на эту страницу или, если она не длиннее полстраницы, на следующую; длинная — по абзацам.
      if (total > bottom(doc) - doc.y) {
        if (total <= bodyH / 2) doc.addPage();
        else ensure(doc, hs[0] + Math.min(hs[1] || 0, 3 * lineH('facts')));
      }
      const mark0 = { num: e.num, page: page(), h: total };
      e.paras.forEach((p, i) => {
        if (i) {
          doc.y += 4;
          place(doc, hs[i], lineH(p.kind));
        }
        if (i === 0) mark(e.num);
        write(p, i === 0 ? c.title : c.text);
      });
      doc.marks.push({ ...mark0, end: page() });
      doc.moveDown(0.8);
    }
  }

  // Указатель имён: по буквам, номера — ссылки. Буква не остаётся одна внизу страницы. В одну колонку:
  // в две при крупном шрифте почти каждое имя с годами переносится на вторую строку.
  if (r.index.length) {
    doc.addPage();
    doc.font(F.head).fontSize(SIZE.gen).fillColor(c.accent).text('Указатель имён', L, doc.y, { width: WIDTH, align: 'center' });
    doc.font(F.text).fontSize(SIZE.small).fillColor(c.muted)
      .text('Номер — запись в росписи; жирным — где человек описан сам, остальные — где он упомянут мужем или женой.', L, doc.y + 6, { width: WIDTH, align: 'center' });
    doc.moveDown(0.6);
    const hang = 16; // вторая строка длинного имени — с отступом
    let letter = '';
    for (const x of r.index) {
      doc.font(F.text).fontSize(SIZE.index);
      const h = doc.heightOfString(partsText(x.parts), { width: WIDTH - hang, lineGap: GAP });
      if (x.letter !== letter) {
        letter = x.letter;
        doc.moveDown(0.5);
        ensure(doc, 26 + h);
        doc.font(F.head).fontSize(SIZE.text + 1).fillColor(c.accent).text(letter, L, doc.y, { width: WIDTH });
        doc.y += 2;
      } else place(doc, h, doc.currentLineHeight(true) + GAP);
      doc.fontSize(SIZE.index);
      x.parts.forEach((y, i) => {
        doc.font(y.b ? F.bold : F.text).fillColor(y.ref ? c.accent : c.text);
        const opts = { width: WIDTH - hang, lineGap: GAP, continued: i < x.parts.length - 1, goTo: y.ref ? `n${y.ref}` : undefined };
        if (i === 0) doc.text(y.t, L + hang, doc.y, { ...opts, indent: -hang });
        else doc.text(y.t, opts);
      });
      doc.x = L;
    }
  }

  footer(doc, c, `${r.title} · составлено ${today()}`);
  doc.end();
  doc.rospis = r;
  return doc;
}
