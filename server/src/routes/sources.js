// Источники сведений: запись по шаблону (метрическая книга, «Память народа», семейное предание…), общая для многих людей;
// привязки источников к сведениям человека или семьи с уточнением и отметка достоверности каждого сведения.
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { HttpError } from '../tree.js';
import { SOURCE_FIELDS, FACTS } from '../../../shared/sources.js';
import { createSource, updateSource, deleteSource, cite, uncite, updateCitation, setQuality } from '../sources.js';
import { isGuest, guestSources, guestMedia, privateIds } from '../privacy.js';

const LIMITS = { kind: 20, title: 300, archive: 200, fond: 50, opis: 50, delo: 100, sheet: 50, url: 1000, note: 5000 };

// Люди, к сведениям которых привязан источник: сам человек или супруги; удалённые не в счёт.
const PERSONS = `array(select distinct p.id from citations c
    left join families f on c.subject = 'family' and f.id = c.subject_id
    join persons p on ((c.subject = 'person' and p.id = c.subject_id) or p.id in (f.partner1, f.partner2)) and p.deleted_at is null
    where c.source_id = s.id order by p.id) as persons`;

// Скан — только пока он есть в альбоме.
const LIST = `select s.id, s.kind, s.title, s.archive, s.fond, s.opis, s.delo, s.sheet, s.verso, s.url, s.note,
    m.id as media_id, m.kind as media_kind, m.thumb as media_thumb, s.created_by, u.name as user_name, s.created_at, ${PERSONS}
  from sources s left join media m on m.id = s.media_id and m.deleted_at is null left join users u on u.id = s.created_by`;

// Привязки к сведениям, которые есть в дереве: человек не удалён, семья на месте.
const CITATIONS = `select c.id, c.source_id, c.subject, c.subject_id, c.fact, c.page,
    case when c.subject = 'person' then array[c.subject_id] else array_remove(array[f.partner1, f.partner2], null) end as persons
  from citations c join sources s on s.id = c.source_id and s.deleted_at is null
  left join persons p on c.subject = 'person' and p.id = c.subject_id
  left join families f on c.subject = 'family' and f.id = c.subject_id
  where (p.id is not null and p.deleted_at is null or f.id is not null)`;

// Поля из запроса: только присланные. media_id null или '' — убрать скан.
function clean(body) {
  const out = {};
  for (const [k, n] of Object.entries(LIMITS)) if (body?.[k] !== undefined) out[k] = String(body[k] ?? '').trim().slice(0, n);
  if (body?.verso !== undefined) out.verso = Boolean(body.verso);
  if (body?.media_id !== undefined) out.media_id = body.media_id ? String(body.media_id) : null;
  if (out.url && !/^https?:\/\//i.test(out.url)) out.url = `https://${out.url}`;
  return out;
}

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
  return {
    sources: sources.filter((s) => shown.has(s.id)),
    citations: citations.filter((c) => shown.has(c.source_id)),
    quality: quality.filter((x) => !(x.subject === 'person' ? hidden : hiddenFam).has(x.subject_id)),
  };
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

  // Источники и достоверность сведений человека и его браков.
  app.get('/api/persons/:id/sources', { preHandler: need('viewer') }, async (req) => {
    const id = req.params.id;
    const guest = isGuest(req.user);
    const hidden = new Set(guest ? await privateIds() : []);
    if (hidden.has(id)) return { quality: [], citations: [], sources: [] };
    const fams = (await q('select id, partner1, partner2 from families where partner1 = $1 or partner2 = $1', [id]))
      .filter((f) => !hidden.has(f.partner1) && !hidden.has(f.partner2)).map((f) => f.id);
    const whose = (t) => `((${t}.subject = 'person' and ${t}.subject_id = $1) or (${t}.subject = 'family' and ${t}.subject_id = any($2::uuid[])))`;
    const [citations, quality] = await Promise.all([
      q(`${CITATIONS} and ${whose('c')} order by c.created_at, c.id`, [id, fams]),
      q(`select subject, subject_id, fact, quality from fact_quality x where ${whose('x')}`, [id, fams]),
    ]);
    const sources = await visible(req, await q(`${LIST} where s.id = any($1::uuid[]) and s.deleted_at is null order by s.created_at, s.id`,
      [[...new Set(citations.map((c) => c.source_id))]]));
    const shown = new Set(sources.map((s) => s.id));
    return { quality, citations: citations.filter((c) => shown.has(c.source_id)), sources };
  });

  // Новый источник; cite — сразу привязать к сведению (одно действие в журнале).
  app.post('/api/sources', { preHandler: need('editor') }, async (req) => {
    const data = clean(req.body);
    if (!data.kind) throw new HttpError(400, 'Выберите, что это за источник');
    const to = req.body?.cite && { ...fact(req.body.cite), page: page(req.body.cite.page) };
    const s = await tx(async (db) => {
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
