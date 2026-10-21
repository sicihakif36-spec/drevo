// Карточка человека в PDF: шапка с главным фото, факты, лента жизни, семья; по выбору — истории, фото из альбома,
// документы и источники. Кто может открыть карточку, тот может её и напечатать: гость видит то же, что в карточке
// (те же правила privacy.js), удалённое не попадает.
import fs from 'node:fs';
import { q } from './db.js';
import { HttpError } from './tree.js';
import { isGuest, guestMedia, guestStories } from './privacy.js';
import { loadTreeData, THEMES } from './routes/print.js';
import { mediaPath } from './routes/media.js';
import { LIST as EVENT_LIST, visibleEvents } from './routes/timeline.js';
import { personSources } from './routes/sources.js';
import { buildIndex, childrenOf, dateText, fullName, lifespan, parentsOf, siblingsOf, spousesOf } from '../../shared/names.js';
import { lifeItems } from '../../shared/life.js';
import { eventTitle } from '../../shared/events.js';
import { citeText, factLabel, kindNote, sourceTitle } from '../../shared/sources.js';
import { MARGIN, WIDTH, colors, ensure, footer, newDoc, place, today } from './pdf.js';

export const CARD_PARTS = ['stories', 'photos', 'docs', 'sources'];
export const MAX_PHOTOS = 12; // «несколько миниатюр»: остальные — строкой «и ещё …»

export function parseCardOptions(qs) {
  return {
    theme: THEMES[qs.theme] ? qs.theme : 'classic',
    ...Object.fromEntries(CARD_PARTS.map((k) => [k, qs[k] !== '0'])),
  };
}

// Картинка, которую pdfkit умеет вставить: JPEG или PNG. WebP — только через миниатюру (она всегда JPEG), иначе без картинки.
function imageFile(m, prefer = 'thumb') {
  if (!m) return null;
  const orig = ['image/jpeg', 'image/png'].includes(m.mime) ? mediaPath(m.id) : null;
  const thumb = m.thumb ? mediaPath(m.id, true) : null;
  return (prefer === 'orig' ? [orig, thumb] : [thumb, orig]).find((f) => f && fs.existsSync(f)) || null;
}

// Всё, что попадёт на лист, — уже с учётом прав и приватности.
export async function cardData(user, id) {
  const guest = isGuest(user);
  const [tree, settings] = await Promise.all([loadTreeData(user), q("select value from settings where key = 'title'")]);
  const idx = buildIndex(tree);
  const p = idx.persons.get(id);
  if (!p) throw new HttpError(404, 'Человек не найден');
  const get = (ids) => ids.map((x) => idx.persons.get(x)).filter(Boolean);
  const marriages = spousesOf(idx, id).map((s) => ({ fam: idx.families.get(s.familyId), spouse: s.spouseId && idx.persons.get(s.spouseId) }))
    .filter((m) => m.spouse);
  const family = { parents: get(parentsOf(idx, id)), marriages, children: get(childrenOf(idx, id)), siblings: get(siblingsOf(idx, id)) };
  const out = { title: settings[0]?.value || 'Семейное древо', person: p, family, photo: null, events: [], stories: [], photos: [], docs: [], sources: [], citations: [] };
  // Живой для гостя: только имя и родные — как в карточке.
  if (p.hidden) return out;

  const [media, events, stories, src] = await Promise.all([
    q(`select m.id, m.kind, m.mime, m.name, m.caption, m.date, m.thumb from media m
       join media_persons t on t.media_id = m.id and t.person_id = $1
       where m.deleted_at is null and m.kind in ('photo', 'doc') order by m.created_at, m.id`, [id]),
    q(`${EVENT_LIST} join event_persons t on t.event_id = e.id and t.person_id = $1 where e.deleted_at is null order by e.created_at, e.id`, [id]),
    q(`select s.id, s.title, s.date, s.body, u.name as user_name, a.id as audio_id from stories s
       join story_persons t on t.story_id = s.id and t.person_id = $1
       left join users u on u.id = s.created_by left join media a on a.id = s.audio_id and a.deleted_at is null
       where s.deleted_at is null order by s.created_at, s.id`, [id]),
    personSources(user, id),
  ]);
  const okMedia = guest ? await guestMedia(media.map((m) => m.id)) : null;
  const okStories = guest ? await guestStories(stories.map((s) => s.id)) : null;
  const shown = media.filter((m) => !okMedia || okMedia.has(m.id));
  // Главное фото — оригинал: на листе оно крупное. guestTree уже убрал его, если гостю оно не видно.
  if (p.photo_id) {
    const m = (await q('select id, mime, thumb from media where id = $1 and deleted_at is null', [p.photo_id]))[0];
    out.photo = imageFile(m, 'orig');
  }
  out.events = lifeItems(p, idx, await visibleEvents(user, events)).filter((x) => x.event);
  out.stories = stories.filter((s) => !okStories || okStories.has(s.id));
  out.photos = shown.filter((m) => m.kind === 'photo');
  out.docs = shown.filter((m) => m.kind === 'doc');
  out.sources = src.sources;
  out.citations = src.citations;
  return out;
}

const she = (p) => p.sex === 'F';
const withYears = (x) => `${fullName(x)}${lifespan(x) ? ` (${lifespan(x)})` : ''}`;
const join = (...a) => a.filter(Boolean).join(', ');

// Брак для раздела «Семья»: «брак 1945, с. Горки; развод 1962».
function bond(f) {
  const start = f.start_date || f.place ? `${f.kind === 'partners' ? 'вместе с' : 'брак'} ${join(dateText(f.start_date), f.place)}` : '';
  return [start, f.ended === 'divorce' && `развод${f.end_date ? ` ${dateText(f.end_date)}` : ''}`].filter(Boolean).join('; ');
}

// Источник одной строкой: «По документу: Метрическая книга…, ГАТО, ф. 160… — дата рождения, брак».
function sourceLine(s, citations) {
  const mine = citations.filter((c) => c.source_id === s.id);
  const facts = [...new Set(mine.map((c) => (c.subject === 'event' ? eventTitle({ kind: c.event_kind, title: c.event_title }) : factLabel(c.subject, c.fact)).toLowerCase()))];
  const pages = [...new Set(mine.map((c) => c.page).filter(Boolean))];
  const what = join(sourceTitle(s), kindNote(s), citeText(s), ...pages);
  return `${s.kind === 'legend' ? 'Со слов' : 'По документу'}: ${what}${facts.length ? ` — ${facts.join(', ')}` : ''}`;
}

const SIZE = { name: 24, sub: 15, head: 17, text: 13, small: 11.5 };

export function renderCard(stream, data, o) {
  const c = colors(o.theme);
  const p = data.person;
  const doc = newDoc(fullName(p));
  doc.pipe(stream);
  const L = MARGIN.left;
  // Абзац; перед ним — проверка места (place), если её не сделали раньше (placed).
  const para = (s, opts = {}) => {
    const width = WIDTH - (opts.indent || 0);
    doc.font(opts.bold ? c.bold : c.font).fontSize(opts.size || SIZE.text).fillColor(opts.color || c.text);
    if (!opts.placed) place(doc, doc.heightOfString(s, { width, lineGap: 2 }), doc.currentLineHeight(true) + 2);
    doc.text(s, L + (opts.indent || 0), doc.y, { width, lineGap: 2, ...opts.text });
  };
  // Заголовок не остаётся один внизу страницы: с ним хотя бы пара строк (next — сколько места нужно первому пункту).
  const heading = (s, next = 40) => {
    doc.moveDown(0.8);
    ensure(doc, 34 + next);
    doc.font(c.bold).fontSize(SIZE.head).fillColor(c.accent).text(s, L, doc.y, { width: WIDTH });
    doc.moveTo(L, doc.y + 2).lineTo(L + WIDTH, doc.y + 2).lineWidth(1).strokeColor(c.line).stroke();
    doc.moveDown(0.5);
  };
  // Строка «подпись: значение»; переносится целиком, подпись не отрывается от значения.
  const fact = (label, value) => {
    if (!value) return;
    doc.font(c.font).fontSize(SIZE.text);
    place(doc, doc.heightOfString(`${label}: ${value}`, { width: WIDTH, lineGap: 2 }), doc.currentLineHeight(true) + 2);
    doc.font(c.bold).fillColor(c.muted).text(`${label}: `, L, doc.y, { width: WIDTH, continued: true, lineGap: 2 })
      .font(c.font).fillColor(c.text).text(value, { lineGap: 2 });
    doc.moveDown(0.25);
  };
  // Пункт списка: переносы строк — под текстом, а не под точкой.
  const bullet = (s, opts = {}) => {
    doc.font(c.font).fontSize(opts.size || SIZE.text);
    place(doc, doc.heightOfString(s, { width: WIDTH - 18, lineGap: 2 }), doc.currentLineHeight(true) + 2);
    const y = doc.y;
    doc.fillColor(c.accent).text('•', L + 2, y, { lineBreak: false });
    doc.y = y;
    para(s, { ...opts, indent: 18, placed: true });
    doc.moveDown(0.15);
  };

  // Шапка: фото слева, имя и годы справа.
  const top = doc.y;
  let tx = L;
  let photoBottom = 0;
  if (data.photo) {
    try {
      const img = doc.openImage(data.photo);
      const box = [150, 190];
      const k = Math.min(box[0] / img.width, box[1] / img.height);
      const [w, h] = [img.width * k, img.height * k];
      doc.image(img, L, top, { width: w, height: h });
      doc.rect(L, top, w, h).lineWidth(0.8).strokeColor(c.line).stroke();
      tx = L + w + 20;
      photoBottom = top + h;
    } catch { /* файл повреждён — без фото */ }
  }
  const tw = L + WIDTH - tx;
  doc.font(c.bold).fontSize(SIZE.name).fillColor(c.title).text(fullName(p), tx, top + 4, { width: tw });
  if (p.birth_surname && p.birth_surname !== p.surname) {
    doc.font(c.font).fontSize(SIZE.sub).fillColor(c.muted).text(`${she(p) ? 'урождённая' : 'при рождении'} ${p.birth_surname}`, tx, doc.y + 2, { width: tw });
  }
  if (lifespan(p)) doc.font(c.font).fontSize(SIZE.sub + 2).fillColor(c.text).text(lifespan(p).replace(/^р\. /, 'род. '), tx, doc.y + 6, { width: tw });
  doc.y = Math.max(doc.y, photoBottom) + 10;
  doc.x = L;

  // Факты.
  if (p.hidden) {
    doc.moveDown(0.5);
    para('Даты, места и фото живых родственников видны только участникам дерева.', { color: c.muted });
  } else {
    const born = join(dateText(p.birth_date), p.birth_place);
    const died = join(dateText(p.death_date), p.death_place);
    if (born || died || p.burial_place || p.occupation || p.notes) heading('Основное');
    fact(she(p) ? 'Родилась' : 'Родился', born);
    if (!p.living) fact(she(p) ? 'Умерла' : 'Умер', died);
    if (!p.living) fact(she(p) ? 'Похоронена' : 'Похоронен', p.burial_place);
    fact('Род занятий', p.occupation);
    if (p.notes) {
      doc.moveDown(0.3);
      para(p.notes);
    }
  }

  // Лента жизни: свои события по порядку.
  if (data.events.length) {
    heading('Жизнь');
    for (const x of data.events) {
      const when = x.date ? dateText(x.date) : '';
      doc.font(c.bold).fontSize(SIZE.text);
      ensure(doc, doc.currentLineHeight(true) * 2 + 6);
      para([when, x.title].filter(Boolean).join(' — '), { bold: true });
      const more = [x.note, x.place, x.age].filter(Boolean).join(' · ');
      if (more) para(more, { color: c.muted, size: SIZE.small + 0.5 });
      if (x.event.body) para(x.event.body, { size: SIZE.small + 0.5 });
      doc.moveDown(0.4);
    }
  }

  // Семья.
  const f = data.family;
  if (f.parents.length || f.marriages.length || f.children.length || f.siblings.length) {
    heading('Семья');
    const group = (label, list) => {
      if (!list.length) return;
      doc.font(c.bold).fontSize(SIZE.text);
      ensure(doc, doc.currentLineHeight(true) * 2 + 6);
      para(label, { bold: true, color: c.muted });
      for (const x of list) bullet(x);
      doc.moveDown(0.3);
    };
    group('Родители', f.parents.map(withYears));
    group(f.marriages.length > 1 ? 'Супруги' : she(p) ? 'Муж' : p.sex === 'M' ? 'Жена' : 'Супруг(а)',
      f.marriages.map((m) => `${withYears(m.spouse)}${bond(m.fam) ? ` — ${bond(m.fam)}` : ''}`));
    group('Дети', f.children.map((x) => `${withYears(x)}${x.sex === 'F' ? ', дочь' : x.sex === 'M' ? ', сын' : ''}`));
    group('Братья и сёстры', f.siblings.map(withYears));
  }

  // Истории.
  if (o.stories && data.stories.length) {
    heading('Истории');
    for (const s of data.stories) {
      doc.font(c.bold).fontSize(SIZE.text + 1);
      ensure(doc, doc.currentLineHeight(true) * 3 + 6);
      para(s.title || 'История', { bold: true, size: SIZE.text + 1 });
      const meta = [s.date && dateText(s.date), s.user_name && `записал(а) ${s.user_name}`].filter(Boolean).join(' · ');
      if (meta) para(meta, { color: c.muted, size: SIZE.small });
      if (s.audio_id) para('Есть запись голоса — послушать её можно в приложении.', { color: c.accent, size: SIZE.small });
      if (s.body) {
        doc.moveDown(0.2);
        para(s.body);
      }
      doc.moveDown(0.6);
    }
  }

  // Фото из альбома: сетка по три, подписи целиком; ряд, который не помещается, — на следующую страницу.
  const pics = o.photos ? data.photos.map((m) => ({ ...m, file: imageFile(m) })).filter((m) => m.file).slice(0, MAX_PHOTOS) : [];
  if (pics.length) {
    heading('Фотографии', 160);
    const gap = 14;
    const cw = (WIDTH - 2 * gap) / 3;
    const ih = 130;
    for (let i = 0; i < pics.length; i += 3) {
      const row = pics.slice(i, i + 3).map((m) => {
        try { return { m, img: doc.openImage(m.file), cap: join(m.caption, m.date && dateText(m.date)) }; } catch { return null; }
      }).filter(Boolean);
      if (!row.length) continue;
      doc.font(c.font).fontSize(SIZE.small);
      const capH = Math.max(0, ...row.map((r) => (r.cap ? doc.heightOfString(r.cap, { width: cw }) + 4 : 0)));
      ensure(doc, ih + capH + 10);
      const y = doc.y;
      row.forEach((r, j) => {
        const x = L + j * (cw + gap);
        const k = Math.min(cw / r.img.width, ih / r.img.height);
        const [w, h] = [r.img.width * k, r.img.height * k];
        doc.image(r.img, x + (cw - w) / 2, y + (ih - h), { width: w, height: h });
        if (r.cap) doc.font(c.font).fontSize(SIZE.small).fillColor(c.muted).text(r.cap, x, y + ih + 4, { width: cw, align: 'center' });
      });
      doc.y = y + ih + capH + 12;
      doc.x = L;
    }
    const rest = data.photos.length - pics.length;
    if (rest > 0 && data.photos.length > MAX_PHOTOS) para(`И ещё ${rest} фото — в альбоме в приложении.`, { color: c.muted, size: SIZE.small });
  }

  if (o.docs && data.docs.length) {
    heading('Документы');
    for (const d of data.docs) bullet(join(d.caption || d.name.replace(/\.[a-z0-9]{1,5}$/i, '') || 'Документ', d.date && dateText(d.date)));
  }

  if (o.sources && data.sources.length) {
    heading('Источники');
    for (const s of data.sources) bullet(sourceLine(s, data.citations), { size: SIZE.small + 0.5 });
  }

  footer(doc, c, `${data.title} · напечатано ${today()}`);
  doc.end();
  return doc;
}

