// Источники сведений: документ по шаблону (метрическая книга, «Память народа», семейное предание…) и его страницы,
// общие для многих людей; привязки страниц к сведениям человека или семьи с уточнением и отметка достоверности каждого сведения.
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { HttpError } from '../tree.js';
import { FACTS } from '../../../shared/sources.js';
import {
  createSource, updateSource, deleteSource, cite, uncite, updateCitation, setQuality,
  createDocument, updateDocument, deleteDocument, mergeDocuments, liveDocument,
} from '../sources.js';
import { isGuest, guestSources, guestMedia, guestEvents, privateIds } from '../privacy.js';
import { visibleEvents } from './timeline.js';

// Поля документа и страницы. Поля документа у страницы — когда документ не выбран (старый телефон, загрузка из файла).
const DOC_LIMITS = { kind: 20, title: 300, archive: 200, fond: 50, opis: 50, delo: 100, note: 5000 };
const LIMITS = { ...DOC_LIMITS, sheet: 50, record: 50, url: 1000, note: 5000 };

// Люди, к сведениям которых привязан источник: сам человек, супруги или участники события; удалённые не в счёт.
const PERSONS = `array(select distinct p.id from citations c
    left join families f on c.subject = 'family' and f.id = c.subject_id
    left join life_events e on c.subject = 'event' and e.id = c.subject_id and e.deleted_at is null
    left join event_persons ep on ep.event_id = e.id
    join persons p on ((c.subject = 'person' and p.id = c.subject_id) or p.id in (f.partner1, f.partner2) or p.id = ep.person_id)
      and p.deleted_at is null
    where c.source_id = s.id order by p.id) as persons`;

// Страница вместе с полями своего документа: так её показывают везде — название, шифр дела, лист. Скан — только пока он есть в альбоме.
const LIST = `select s.id, s.document_id, d.kind, d.title, d.archive, d.fond, d.opis, d.delo, d.note as doc_note,
    s.sheet, s.verso, s.record, s.url, s.note,
    m.id as media_id, m.kind as media_kind, m.thumb as media_thumb, s.created_by, u.name as user_name, s.created_at, ${PERSONS}
  from sources s join documents d on d.id = s.document_id
  left join media m on m.id = s.media_id and m.deleted_at is null left join users u on u.id = s.created_by`;

// Документы — для выбора: сколько у каждого страниц и людей, недавние — первыми.
const DOCS = `select d.id, d.kind, d.title, d.archive, d.fond, d.opis, d.delo, d.note, d.created_at,
    (select count(*)::int from sources s where s.document_id = d.id and s.deleted_at is null) as pages,
    (select max(s.created_at) from sources s where s.document_id = d.id and s.deleted_at is null) as used_at
  from documents d`;

// Привязки к сведениям, которые есть в дереве: человек не удалён, семья на месте, событие не удалено.
const CITATIONS = `select c.id, c.source_id, c.subject, c.subject_id, c.fact, c.page,
    case when c.subject = 'person' then array[c.subject_id]
      when c.subject = 'event' then array(select person_id from event_persons where event_id = e.id order by person_id)
      else array_remove(array[f.partner1, f.partner2], null) end as persons, e.kind as event_kind, e.title as event_title
  from citations c join sources s on s.id = c.source_id and s.deleted_at is null
  left join persons p on c.subject = 'person' and p.id = c.subject_id
  left join families f on c.subject = 'family' and f.id = c.subject_id
  left join life_events e on c.subject = 'event' and e.id = c.subject_id
  where (p.id is not null and p.deleted_at is null or f.id is not null or e.id is not null and e.deleted_at is null)`;

// Поля из запроса: только присланные. media_id null или '' — убрать скан.
function clean(body, limits = LIMITS) {
  const out = {};
  for (const [k, n] of Object.entries(limits)) if (body?.[k] !== undefined) out[k] = String(body[k] ?? '').trim().slice(0, n);
  if (limits !== LIMITS) return out;
  if (body?.verso !== undefined) out.verso = Boolean(body.verso);
  if (body?.media_id !== undefined) out.media_id = body.media_id ? String(body.media_id) : null;
  if (body?.document_id !== undefined) out.document_id = String(body.document_id || '');
  if (out.url && !/^https?:\/\//i.test(out.url)) out.url = `https://${out.url}`;
  return out;
}
const cleanDoc = (body) => clean(body, DOC_LIMITS);

// Сведение из запроса: { subject, subject_id, fact }.
function fact(body) {
  const subject = String(body?.subject || 'person');
  const f = String(body?.fact || '');
  if (!FACTS[subject]?.[f]) throw new HttpError(400, 'Непонятно, к какому сведению это относится');
  return { subject, subject_id: String(body?.subject_id || ''), fact: f };
}
const page = (v) => String(v ?? '').trim().slice(0, 300);

// Гостю — только источники без живых; скан — если он виден гостю по правилу файлов.
async function visible(req, rows) {
  if (!isGuest(req.user)) return rows;
  const ok = await guestSources(rows.map((r) => r.id));
  const scans = await guestMedia(rows.filter((r) => ok.has(r.id) && r.media_id).map((r) => r.media_id));
  return rows.filter((r) => ok.has(r.id)).map((r) => (r.media_id && !scans.has(r.media_id) ? { ...r, media_id: null, media_kind: null } : r));
}

const one = async (id) => (await q(`${LIST} where s.id = $1 and s.deleted_at is null`, [id]))[0];

// Источники, привязки и достоверность для выгрузки GEDCOM; гостю — по тем же правилам, что и в карточке.
export async function sourceData(user) {
  const [sources, citations, quality] = await Promise.all([
    q(`${LIST} where s.deleted_at is null order by s.created_at, s.id`),
    q(`${CITATIONS} order by c.created_at, c.id`),
    q('select subject, subject_id, fact, quality from fact_quality'),
  ]);
  if (!isGuest(user)) return { sources, citations, quality };
  const shown = new Set((await visible({ user }, sources)).map((s) => s.id));
  const hidden = new Set(await privateIds());
  const families = await q('select id, partner1, partner2 from families');
  const hiddenFam = new Set(families.filter((f) => hidden.has(f.partner1) || hidden.has(f.partner2)).map((f) => f.id));
  const events = await guestEvents(quality.filter((x) => x.subject === 'event').map((x) => x.subject_id));
  return {
    sources: sources.filter((s) => shown.has(s.id)),
    citations: citations.filter((c) => shown.has(c.source_id)),
    quality: quality.filter((x) => (x.subject === 'event' ? events.has(x.subject_id) : !(x.subject === 'person' ? hidden : hiddenFam).has(x.subject_id))),
  };
}

// Источники и достоверность сведений человека, его браков и событий его ленты жизни; гостю — по правилам карточки.
export async function personSources(user, id) {
  const hidden = new Set(isGuest(user) ? await privateIds() : []);
  if (hidden.has(id)) return { quality: [], citations: [], sources: [] };
  const fams = (await q('select id, partner1, partner2 from families where partner1 = $1 or partner2 = $1', [id]))
    .filter((f) => !hidden.has(f.partner1) && !hidden.has(f.partner2)).map((f) => f.id);
  const events = (await visibleEvents(user, await q(
    'select e.id from life_events e join event_persons ep on ep.event_id = e.id where ep.person_id = $1 and e.deleted_at is null', [id],
  ))).map((e) => e.id);
  const whose = (t) => `((${t}.subject = 'person' and ${t}.subject_id = $1) or (${t}.subject = 'family' and ${t}.subject_id = any($2::uuid[]))
    or (${t}.subject = 'event' and ${t}.subject_id = any($3::uuid[])))`;
  const [citations, quality] = await Promise.all([
    q(`${CITATIONS} and ${whose('c')} order by c.created_at, c.id`, [id, fams, events]),
    q(`select subject, subject_id, fact, quality from fact_quality x where ${whose('x')}`, [id, fams, events]),
  ]);
  const sources = await visible({ user }, await q(`${LIST} where s.id = any($1::uuid[]) and s.deleted_at is null order by s.created_at, s.id`,
    [[...new Set(citations.map((c) => c.source_id))]]));
  const shown = new Set(sources.map((s) => s.id));
  return { quality, citations: citations.filter((c) => shown.has(c.source_id)), sources };
}

export default async function sourceRoutes(app) {
  // Все источники — чтобы выбрать уже записанный.
  app.get('/api/sources', { preHandler: need('viewer') }, async (req) => visible(req,
    await q(`${LIST} where s.deleted_at is null order by s.created_at desc, s.id`)));

  // Источник и все сведения, к которым он привязан.
  app.get('/api/sources/:id', { preHandler: need('viewer') }, async (req) => {
    const s = await one(req.params.id);
    const [shown] = s ? await visible(req, [s]) : [];
    if (!shown) throw new HttpError(404, 'Источник не найден');
    return { ...shown, citations: await q(`${CITATIONS} and c.source_id = $1 order by c.created_at, c.id`, [s.id]) };
  });

  app.get('/api/persons/:id/sources', { preHandler: need('viewer') }, async (req) => personSources(req.user, req.params.id));

  // Новая страница: document_id — записанного документа, document — новый документ вместе с ней; cite — сразу привязать
  // к сведению. Всё — одно действие в журнале.
  app.post('/api/sources', { preHandler: need('editor') }, async (req) => {
    const data = clean(req.body);
    const doc = req.body?.document && cleanDoc(req.body.document);
    if (!data.document_id && !doc && !data.kind) throw new HttpError(400, 'Выберите, что это за источник');
    const to = req.body?.cite && { ...fact(req.body.cite), page: page(req.body.cite.page) };
    const s = await tx(async (db) => {
      if (doc) data.document_id = (await createDocument(db, req.user.id, doc)).id;
      const created = await createSource(db, req.user.id, data);
      if (to) await cite(db, req.user.id, { ...to, source_id: created.id });
      return created;
    });
    return one(s.id);
  });

  app.patch('/api/sources/:id', { preHandler: need('editor') }, async (req) => {
    await tx((db) => updateSource(db, req.user.id, req.params.id, clean(req.body)));
    const s = await one(req.params.id);
    if (!s) throw new HttpError(404, 'Источник не найден');
    return s;
  });

  // Документы. Список — для выбора при указании источника и подписи скана; гостю он не нужен.
  app.get('/api/documents', { preHandler: need('editor') }, async () => q(`${DOCS} where d.deleted_at is null
    order by coalesce((select max(s.created_at) from sources s where s.document_id = d.id and s.deleted_at is null), d.created_at) desc, d.id`));

  // Документ и его страницы с людьми и сведениями; гостю — только страницы, которые ему видны.
  app.get('/api/documents/:id', { preHandler: need('viewer') }, async (req) => {
    const d = (await q(`${DOCS} where d.id = $1 and d.deleted_at is null`, [req.params.id]))[0];
    if (!d) throw new HttpError(404, 'Документ не найден');
    const pages = await visible(req, await q(`${LIST} where s.document_id = $1 and s.deleted_at is null
      order by nullif(regexp_replace(s.sheet, '\\D.*', ''), '')::int nulls last, s.sheet, s.verso, s.created_at, s.id`, [d.id]));
    if (isGuest(req.user) && !pages.length) throw new HttpError(404, 'Документ не найден');
    const citations = await q(`${CITATIONS} and c.source_id = any($1::uuid[]) order by c.created_at, c.id`, [pages.map((p) => p.id)]);
    return { ...d, pages, citations };
  });

  app.post('/api/documents', { preHandler: need('editor') }, async (req) => {
    const d = await tx((db) => createDocument(db, req.user.id, cleanDoc(req.body)));
    return (await q(`${DOCS} where d.id = $1`, [d.id]))[0];
  });

  // Правка документа — у всех его страниц сразу.
  app.patch('/api/documents/:id', { preHandler: need('editor') }, async (req) => {
    await tx((db) => updateDocument(db, req.user.id, req.params.id, cleanDoc(req.body)));
    const d = (await q(`${DOCS} where d.id = $1 and d.deleted_at is null`, [req.params.id]))[0];
    if (!d) throw new HttpError(404, 'Документ не найден');
    return d;
  });

  app.delete('/api/documents/:id', { preHandler: need('editor') }, async (req) => {
    const changeId = await tx((db) => deleteDocument(db, req.user.id, req.params.id));
    return { ok: true, changeId };
  });

  // Объединить два одинаковых документа: страницы from переходят сюда.
  app.post('/api/documents/:id/merge', { preHandler: need('editor') }, async (req) => {
    const from = String(req.body?.from || '');
    const changeId = await tx(async (db) => {
      await liveDocument(db, from);
      return mergeDocuments(db, req.user.id, req.params.id, from);
    });
    return { ok: true, changeId };
  });

  app.delete('/api/sources/:id', { preHandler: need('editor') }, async (req) => {
    const changeId = await tx((db) => deleteSource(db, req.user.id, req.params.id));
    return { ok: true, changeId };
  });

  // Указать источник у сведения.
  app.post('/api/citations', { preHandler: need('editor') }, async (req) => {
    const to = { ...fact(req.body), source_id: String(req.body?.source_id || ''), page: page(req.body?.page) };
    const c = await tx((db) => cite(db, req.user.id, to));
    if (!c) throw new HttpError(409, 'Этот источник уже указан у этого сведения');
    const { changeId, ...row } = c;
    return row;
  });

  // Уточнение: номер записи, страница.
  app.patch('/api/citations/:id', { preHandler: need('editor') }, async (req) => {
    await tx((db) => updateCitation(db, req.user.id, req.params.id, page(req.body?.page)));
    const c = (await q('select id, source_id, subject, subject_id, fact, page from citations where id = $1', [req.params.id]))[0];
    if (!c) throw new HttpError(404, 'Источник у этого сведения уже убран');
    return c;
  });

  app.delete('/api/citations/:id', { preHandler: need('editor') }, async (req) => {
    const changeId = await tx((db) => uncite(db, req.user.id, req.params.id));
    if (!changeId) throw new HttpError(404, 'Источник у этого сведения уже убран');
    return { ok: true, changeId };
  });

  // Достоверность сведения; quality пустая — снять отметку.
  app.put('/api/quality', { preHandler: need('editor') }, async (req) => {
    const f = fact(req.body);
    const quality = req.body?.quality ? String(req.body.quality) : null;
    await tx((db) => setQuality(db, req.user.id, f, quality));
    return { ...f, quality };
  });
}
