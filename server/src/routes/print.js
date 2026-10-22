import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { q } from '../db.js';
import { ownerPerson } from '../tree.js';
import { need } from '../auth.js';
import { mediaPath } from './media.js';
import { buildIndex, fullName, isPrivate, lifespan, shortName } from '../../../shared/names.js';
import { guestTree, isGuest } from '../privacy.js';
import { layoutTree, homePerson, BOX } from '../../../shared/layout.js';
import { PAPER, planPages } from '../../../shared/printplan.js';
import { layoutFan, parseFanOptions } from '../../../shared/fan.js';
import { drawFan } from '../fan.js';
import { disposition } from '../pdf.js';
import { renderInWorker, sendPdf } from '../pdfpool.js';

const require = createRequire(import.meta.url);
const fontDir = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
export const FONTS = {
  regular: path.join(fontDir, 'DejaVuSans.ttf'),
  bold: path.join(fontDir, 'DejaVuSans-Bold.ttf'),
  serif: path.join(fontDir, 'DejaVuSerif.ttf'),
  serifBold: path.join(fontDir, 'DejaVuSerif-Bold.ttf'),
};

export const THEMES = {
  classic: { font: 'serif', bold: 'serifBold', M: ['#eef3fa', '#5b7db1'], F: ['#fbeef2', '#b15b7d'], U: ['#f2f2f2', '#888888'], line: '#6b5a45', title: '#4a3826' },
  modern: { font: 'regular', bold: 'bold', M: ['#e3f0ff', '#2f6fd6'], F: ['#ffe6ef', '#d63f78'], U: ['#eeeeee', '#777777'], line: '#555555', title: '#222222' },
  bw: { font: 'regular', bold: 'bold', M: ['#ffffff', '#000000'], F: ['#ffffff', '#000000'], U: ['#ffffff', '#000000'], line: '#000000', title: '#000000' },
};

export function parsePrintOptions(qs) {
  const num = (v, d, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d));
  return {
    root: qs.root,
    mode: ['all', 'ancestors', 'descendants', 'hourglass', 'fan'].includes(qs.mode) ? qs.mode : 'hourglass',
    up: num(qs.up, 4, 0, 12),
    down: num(qs.down, 3, 0, 12),
    paper: PAPER[qs.paper] ? qs.paper : 'A4',
    orient: ['portrait', 'landscape', 'auto'].includes(qs.orient) ? qs.orient : 'auto',
    fit: qs.fit === 'tiles' ? 'tiles' : 'page',
    scale: num(qs.scale, 100, 20, 400),
    photos: qs.photos !== '0',
    hideLiving: qs.hideLiving === '1',
    theme: THEMES[qs.theme] ? qs.theme : 'classic',
    title: String(qs.title ?? '').slice(0, 120),
    ...parseFanOptions(qs),
  };
}

function drawTree(doc, idx, layout, o, theme) {
  const t = THEMES[theme];
  doc.lineWidth(1.6).strokeColor(t.line);
  for (const e of layout.edges) {
    if (e.dashed) continue;
    doc.moveTo(...e.points[0]);
    for (const p of e.points.slice(1)) doc.lineTo(...p);
    doc.stroke();
  }
  for (const n of layout.nodes) {
    if (!n.id) continue;
    const p = idx.persons.get(n.id);
    if (!p) continue;
    const [fill, stroke] = t[p.sex] || t.U;
    // Рамка в своих координатах: pdfkit сам начинает новую страницу, если текст ниже края листа
    // в координатах до сдвига, — у высокого дерева (всё дерево, 7 рядов и больше) это тысячи пустых листов.
    doc.save().translate(n.x, n.y);
    doc.lineWidth(n.root ? 3 : 1.4).roundedRect(0, 0, BOX.w, BOX.h, 9).fillAndStroke(fill, stroke);
    let tx = 8;
    const hidden = o.hideLiving && isPrivate(p);
    if (o.photos && p.photo_id && !hidden && p._photo) {
      try {
        doc.save().roundedRect(6, 6, BOX.h - 12, BOX.h - 12, 6).clip();
        doc.image(p._photo, 6, 6, { cover: [BOX.h - 12, BOX.h - 12], align: 'center', valign: 'center' });
        doc.restore();
        tx = BOX.h;
      } catch { doc.restore(); }
    }
    const w = BOX.w - 6 - tx;
    const nm = shortName(p);
    doc.fillColor('#1d1d1d').font(t.bold).fontSize(12.5).text(nm.last || nm.first, tx, 9, { width: w, lineBreak: false, ellipsis: true });
    if (nm.last) doc.font(t.font).fontSize(11).text(nm.first, tx, 27, { width: w, lineBreak: false, ellipsis: true });
    const life = hidden ? '' : lifespan(p);
    if (life) doc.fillColor('#555555').fontSize(10).text(life, tx, 50, { width: w, lineBreak: false, ellipsis: true });
    doc.restore();
  }
}

export function renderPdf(stream, data, o) {
  const idx = buildIndex(data);
  for (const p of idx.persons.values()) {
    // Миниатюра (400 px) — с запасом для рамки на листе; без неё PDF с сотнями фото весит гигабайт и не помещается в память.
    const m = p.photo_id && data.photos?.[p.photo_id];
    p._photo = m ? [m.thumb && mediaPath(m.id, true), mediaPath(m.id)].find((f) => f && fs.existsSync(f)) : null;
  }
  // Кто в центре: выбранный, иначе сам вошедший или человек владельца (o.home), иначе — из самой большой части дерева.
  const root = homePerson(idx, o.root, o.home);
  if (o.mode === 'fan' && root) {
    // В середине фото крупное: лучше оригинал, чем миниатюра. Нет файла — нет и места под фото.
    const m = data.photos?.[idx.persons.get(root).photo_id];
    const file = m ? [mediaPath(m.id), m.thumb && mediaPath(m.id, true)].find((f) => f && fs.existsSync(f)) : null;
    const fan = layoutFan(idx, root, { ...o, photos: o.photos && Boolean(file) });
    fan.center.file = file;
    return sheets(stream, fan.plan, fan.bounds, o, (doc) => drawFan(doc, fan, o));
  }
  const layout = layoutTree(idx, root, { mode: o.mode, up: o.up, down: o.down, anchor: homePerson(idx, o.home) });
  return sheets(stream, planPages(layout, o), layout.bounds, o, (doc) => drawTree(doc, idx, layout, o, o.theme));
}

// Листы печати: один лист или плакат из склеиваемых листов с метками; draw рисует всю схему в её единицах.
function sheets(stream, plan, bounds, o, draw) {
  const t = THEMES[o.theme];
  const doc = new PDFDocument({ autoFirstPage: false, size: [plan.pw, plan.ph], margin: 0, info: { Title: o.title || 'Семейное древо', Creator: 'Древо' } });
  for (const [k, f] of Object.entries(FONTS)) doc.registerFont(k, f);
  doc.pipe(stream);
  const total = plan.cols * plan.rows;
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  for (let r = 0; r < plan.rows; r++) {
    for (let c = 0; c < plan.cols; c++) {
      doc.addPage({ size: [plan.pw, plan.ph], margin: 0 });
      const aw = plan.pw - 2 * plan.margin;
      const ah = plan.ph - 2 * plan.margin - plan.head;
      const ax = plan.margin;
      const ay = plan.margin + plan.head;
      // заголовок
      doc.font(t.bold).fontSize(total === 1 ? 16 : 11).fillColor(t.title)
        .text(o.title || 'Семейное древо', ax, plan.margin, { width: aw * 0.7, lineBreak: false, ellipsis: true });
      doc.font(t.font).fontSize(8).fillColor('#777777')
        .text(total > 1 ? `Лист ${r * plan.cols + c + 1} из ${total} · ряд ${r + 1}, колонка ${c + 1}` : `Составлено ${date}`, ax + aw * 0.6, plan.margin + 3, { width: aw * 0.4, align: 'right', lineBreak: false });
      // содержимое листа
      doc.save();
      doc.rect(ax, ay, aw, ah).clip();
      let ox = ax;
      let oy = ay;
      if (total === 1) {
        ox += (aw - plan.cw * plan.s) / 2;
        oy += (ah - plan.ch * plan.s) / 2;
      } else {
        ox -= c * (aw - plan.overlap);
        oy -= r * (ah - plan.overlap);
      }
      doc.translate(ox, oy).scale(plan.s).translate(plan.pad - bounds.x, plan.pad - bounds.y);
      draw(doc);
      doc.restore();
      // метки склейки
      if (total > 1) {
        doc.lineWidth(0.5).strokeColor('#999999').dash(3, { space: 3 });
        if (c < plan.cols - 1) doc.moveTo(ax + aw - plan.overlap, ay).lineTo(ax + aw - plan.overlap, ay + ah).stroke();
        if (r < plan.rows - 1) doc.moveTo(ax, ay + ah - plan.overlap).lineTo(ax + aw, ay + ah - plan.overlap).stroke();
        doc.undash();
        doc.lineWidth(0.5).strokeColor('#cccccc').rect(ax, ay, aw, ah).stroke();
      }
    }
  }
  doc.end();
  return plan;
}

// hide — как для гостя: и у владельца с галочкой «скрыть живых» (без главных фото, которые гостю не показываются).
export async function loadTreeData(user, hide = isGuest(user)) {
  const [persons, families, children, media, settings] = await Promise.all([
    q('select * from persons where deleted_at is null'),
    q('select * from families'),
    q('select * from family_children'),
    q("select id, mime, thumb from media where mime in ('image/jpeg', 'image/png')"),
    q("select value from settings where key = 'title'"),
  ]);
  const data = { persons, families, children, photos: Object.fromEntries(media.map((m) => [m.id, m])), title: settings[0]?.value };
  return hide ? guestTree(data) : data;
}

export default async function printRoutes(app) {
  app.get('/api/print.pdf', { preHandler: need('viewer') }, async (req, reply) => {
    const o = parsePrintOptions(req.query);
    if (isGuest(req.user)) o.hideLiving = true;
    const data = await loadTreeData(req.user, o.hideLiving);
    if (!o.title) o.title = data.title || 'Семейное древо';
    o.home = req.user.person_id || await ownerPerson({ q });
    const center = o.mode === 'fan' && data.persons.find((p) => p.id === (o.root || o.home));
    // Собирается в отдельном потоке (pdfpool.js): большое дерево не задерживает остальные запросы.
    return sendPdf(reply, renderInWorker('tree', data, o), center ? disposition(req.query.download === '1', `Веер предков — ${fullName(center)}`)
      : `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="drevo.pdf"`);
  });
}
