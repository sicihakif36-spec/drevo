// Источники и достоверность сведений. Каждое изменение пишется в журнал так, чтобы его можно было отменить (см. revert.js).
// Источник — документ (метрическая книга за год, ревизская сказка: название и шифр дела) и его страницы (лист, номер записи,
// скан) — их и указывают у сведений. Записи журнала: entity 'document' — add, update, delete, restore; 'source' (страница) —
// add, update, delete, restore; 'citation' (привязка страницы к сведению) — add, update (уточнение), remove;
// 'quality' (достоверность сведения, entity_id — человек или семья) — set.
// Сведение — subject ('person', 'family' или 'event' — событие ленты жизни), его id и fact (см. FACTS в shared/sources.js).
import { logChange } from './changes.js';
import { HttpError, alive } from './tree.js';
import { liveEvent, participants } from './timeline.js';
import { SOURCE_FIELDS, DOC_FIELDS, KINDS, FACTS, QUALITY, sourceTitle, pageText, docKey } from '../../shared/sources.js';

// Что пишется в журнал о документе и странице: по этому снимку строится подпись в ленте.
export const docSnapshot = (d) => ({ kind: d.kind, title: sourceTitle(d) });
export const snapshot = (s, d = s) => ({ kind: d.kind, title: sourceTitle(d), part: pageText(s) });

// Кого касается сведение: сам человек, супруги или участники события.
export async function subjectPersons(db, subject, id) {
  if (subject === 'person') return [id];
  if (subject === 'event') return participants(db, id);
  const f = (await db.q('select partner1, partner2 from families where id = $1', [id]))[0];
  return f ? [f.partner1, f.partner2].filter(Boolean) : [];
}

// Кого касаются страницы ids: люди всех их привязок.
async function pagesPersons(db, ids) {
  const rows = await db.q(
    `select c.subject_id as id from citations c where c.source_id = any($1::uuid[]) and c.subject = 'person'
     union select unnest(array[f.partner1, f.partner2]) from citations c join families f on c.subject = 'family' and f.id = c.subject_id
       where c.source_id = any($1::uuid[])
     union select ep.person_id from citations c join event_persons ep on c.subject = 'event' and ep.event_id = c.subject_id
       where c.source_id = any($1::uuid[])`, [ids]);
  return rows.map((r) => r.id).filter(Boolean).sort();
}
export const sourcePersons = (db, sourceId) => pagesPersons(db, [sourceId]);
async function documentPersons(db, docId) {
  return pagesPersons(db, (await db.q('select id from sources where document_id = $1', [docId])).map((r) => r.id));
}

// Сведение есть в дереве: человек не удалён, семья на месте.
export async function checkFact(db, subject, id, fact) {
  if (!FACTS[subject]?.[fact]) throw new HttpError(400, 'Непонятно, к какому сведению это относится');
  if (subject === 'person' && !(await alive(db, id))) throw new HttpError(404, 'Человек не найден');
  if (subject === 'family' && !(await db.q('select 1 from families where id = $1', [id]))[0]) throw new HttpError(404, 'Семья не найдена');
  if (subject === 'event') await liveEvent(db, id);
}

export async function liveDocument(db, id) {
  const d = (await db.q('select * from documents where id = $1 and deleted_at is null for update', [id]))[0];
  if (!d) throw new HttpError(404, 'Документ не найден');
  return d;
}

export async function liveSource(db, id) {
  const s = (await db.q('select * from sources where id = $1 and deleted_at is null for update', [id]))[0];
  if (!s) throw new HttpError(404, 'Источник не найден');
  return s;
}

// --- Документ ---

export async function createDocument(db, userId, data) {
  if (!KINDS[data.kind]) throw new HttpError(400, data.kind ? 'Неизвестный вид источника' : 'Выберите, что это за источник');
  const cols = DOC_FIELDS.filter((c) => c in data);
  const d = (await db.q(
    `insert into documents (${[...cols, 'created_by'].join(', ')}) values (${[...cols, 'u'].map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    [...cols.map((c) => data[c]), userId],
  ))[0];
  await logChange(db, userId, 'document', d.id, 'add', null, docSnapshot(d), []);
  return d;
}

// Такой же документ уже записан — он и есть (загрузка из файла, источник без выбора документа); иначе — новый.
export async function findOrCreateDocument(db, userId, data) {
  const doc = { kind: 'other', ...data };
  const key = docKey(doc);
  const same = (await db.q('select * from documents where deleted_at is null and kind = $1 order by created_at, id', [doc.kind]))
    .find((d) => docKey(d) === key);
  return same || createDocument(db, userId, doc);
}

// data — только изменённые поля. null — ничего не изменилось.
export async function updateDocument(db, userId, id, data) {
  const d = await liveDocument(db, id);
  if ('kind' in data && !KINDS[data.kind]) throw new HttpError(400, 'Неизвестный вид источника');
  const cols = DOC_FIELDS.filter((c) => c in data && data[c] !== d[c]);
  if (!cols.length) return null;
  await db.q(`update documents set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [id, ...cols.map((c) => data[c])]);
  return logChange(db, userId, 'document', id, 'update',
    Object.fromEntries(cols.map((c) => [c, d[c]])), { ...docSnapshot(d), ...Object.fromEntries(cols.map((c) => [c, data[c]])) },
    await documentPersons(db, id));
}

// Удаляется вместе со страницами; привязки страниц остаются в базе — возврат вернёт и их.
export async function deleteDocument(db, userId, id) {
  const d = await liveDocument(db, id);
  for (const s of await db.q('select id from sources where document_id = $1 and deleted_at is null order by created_at, id', [id])) {
    await deleteSource(db, userId, s.id);
  }
  await db.q('update documents set deleted_at = now() where id = $1', [id]);
  return logChange(db, userId, 'document', id, 'delete', docSnapshot(d), null, await documentPersons(db, id));
}

export async function restoreDocument(db, userId, id) {
  const d = (await db.q('update documents set deleted_at = null where id = $1 and deleted_at is not null returning *', [id]))[0];
  if (!d) throw new HttpError(409, 'Этот документ уже на месте');
  return logChange(db, userId, 'document', id, 'restore', null, docSnapshot(d), await documentPersons(db, id));
}

// Объединить: страницы документа from переходят к into, сам from удаляется. Одно действие в журнале — отменяется целиком.
export async function mergeDocuments(db, userId, into, from) {
  if (into === from) throw new HttpError(400, 'Это один и тот же документ');
  await liveDocument(db, into);
  await liveDocument(db, from);
  for (const s of await db.q('select id from sources where document_id = $1 and deleted_at is null order by created_at, id', [from])) {
    await updateSource(db, userId, s.id, { document_id: into });
  }
  return deleteDocument(db, userId, from);
}

// --- Страница документа ---

// Проверка полей перед записью: документ на месте, скан — фото или документ из альбома.
async function check(db, data) {
  if (data.document_id) await liveDocument(db, data.document_id);
  if (data.media_id && !(await db.q("select 1 from media where id = $1 and deleted_at is null and kind <> 'audio'", [data.media_id]))[0]) {
    throw new HttpError(400, 'Скан не найден в альбоме');
  }
}

// Поля документа среди полей страницы: прислали вид или название — значит, страница без выбранного документа
// (загрузка из файла, старый телефон).
const docPart = (data) => Object.fromEntries(DOC_FIELDS.filter((c) => c !== 'note' && c in data).map((c) => [c, data[c]]));

// Новая страница: document_id — к записанному документу; без него — к такому же документу или новому по полям data.
export async function createSource(db, userId, data) {
  const docId = data.document_id || (await findOrCreateDocument(db, userId, docPart(data))).id;
  const page = { ...data, document_id: docId };
  await check(db, page);
  const d = await liveDocument(db, docId);
  const cols = SOURCE_FIELDS.filter((c) => c in page);
  const s = (await db.q(
    `insert into sources (${[...cols, 'created_by'].join(', ')}) values (${[...cols, 'u'].map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    [...cols.map((c) => page[c]), userId],
  ))[0];
  await logChange(db, userId, 'source', s.id, 'add', null, { ...snapshot(s, d), document_id: docId }, []);
  return { ...d, ...s, document_id: docId };
}

// data — только изменённые поля страницы. Поля документа (вид, название, шифр дела) меняются у документа — у всех его страниц.
// Возвращает номер последней записи журнала; null — ничего не изменилось.
export async function updateSource(db, userId, id, data) {
  const s = await liveSource(db, id);
  const docId = await (Object.keys(docPart(data)).length ? updateDocument(db, userId, s.document_id, docPart(data)) : null);
  const cols = SOURCE_FIELDS.filter((c) => c in data && data[c] !== s[c]);
  if (!cols.length) return docId;
  await check(db, data);
  await db.q(`update sources set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [id, ...cols.map((c) => data[c])]);
  const d = (await db.q('select * from documents where id = $1', [data.document_id || s.document_id]))[0];
  // Вид, название и лист — для подписи в журнале, даже если они не менялись.
  return logChange(db, userId, 'source', id, 'update',
    Object.fromEntries(cols.map((c) => [c, s[c]])), { ...snapshot({ ...s, ...data }, d), ...Object.fromEntries(cols.map((c) => [c, data[c]])) },
    await sourcePersons(db, id));
}

const docOf = async (db, s) => (await db.q('select * from documents where id = $1', [s.document_id]))[0];

// Привязки удалённой страницы остаются в базе: возврат страницы возвращает и их.
export async function deleteSource(db, userId, id) {
  const s = await liveSource(db, id);
  await db.q('update sources set deleted_at = now() where id = $1', [id]);
  return logChange(db, userId, 'source', id, 'delete', snapshot(s, await docOf(db, s)), null, await sourcePersons(db, id));
}

// Документ страницы удалён — возвращается вместе с ней.
export async function restoreSource(db, userId, id) {
  const s = (await db.q('select * from sources where id = $1 and deleted_at is not null for update', [id]))[0];
  if (!s) throw new HttpError(409, 'Этот источник уже на месте');
  const d = await docOf(db, s);
  if (d.deleted_at) await restoreDocument(db, userId, d.id);
  await db.q('update sources set deleted_at = null where id = $1', [id]);
  return logChange(db, userId, 'source', id, 'restore', null, snapshot(s, d), await sourcePersons(db, id));
}

// Что пишется в журнал о привязке: сама строка (по ней откат вернёт привязку с тем же id) и источник — для подписи.
const citeSnap = (c, s) => ({ ...snapshot(s.page, s.doc), id: c.id, source_id: c.source_id, subject: c.subject, subject_id: c.subject_id, fact: c.fact, page: c.page });
// Страница и её документ — для подписи в журнале.
async function livePage(db, id) {
  const page = await liveSource(db, id);
  return { page, doc: await docOf(db, page) };
}

// Привязать источник к сведению. id — при откате удаления привязки. Возвращает привязку и номер записи журнала (changeId);
// null — источник уже указан у этого сведения.
export async function cite(db, userId, { source_id: sourceId, subject, subject_id: subjectId, fact, page = '' }, id = null) {
  const s = await livePage(db, sourceId);
  await checkFact(db, subject, subjectId, fact);
  const c = (await db.q(
    `insert into citations (id, source_id, subject, subject_id, fact, page, created_by)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7) on conflict do nothing returning *`,
    [id, sourceId, subject, subjectId, fact, page, userId],
  ))[0];
  if (!c) return null;
  const changeId = await logChange(db, userId, 'citation', c.id, 'add', null, citeSnap(c, s), await subjectPersons(db, subject, subjectId));
  return { ...c, changeId };
}

async function liveCitation(db, id) {
  const c = (await db.q('select * from citations where id = $1 for update', [id]))[0];
  if (!c) return null;
  return { c, s: await livePage(db, c.source_id) };
}

// Уточнение: номер записи, страница. null — привязки нет или ничего не изменилось.
export async function updateCitation(db, userId, id, page) {
  const x = await liveCitation(db, id);
  if (!x || x.c.page === page) return null;
  await db.q('update citations set page = $1 where id = $2', [page, id]);
  return logChange(db, userId, 'citation', id, 'update', { page: x.c.page }, citeSnap({ ...x.c, page }, x.s),
    await subjectPersons(db, x.c.subject, x.c.subject_id));
}

// null — такой привязки нет.
export async function uncite(db, userId, id) {
  const x = await liveCitation(db, id);
  if (!x) return null;
  await db.q('delete from citations where id = $1', [id]);
  return logChange(db, userId, 'citation', id, 'remove', citeSnap(x.c, x.s), null, await subjectPersons(db, x.c.subject, x.c.subject_id));
}

// Достоверность сведения; quality null — снять отметку. null — ничего не изменилось.
export async function setQuality(db, userId, { subject, subject_id: subjectId, fact }, quality) {
  if (quality !== null && !QUALITY[quality]) throw new HttpError(400, 'Непонятная отметка достоверности');
  await checkFact(db, subject, subjectId, fact);
  const cur = (await db.q('select quality from fact_quality where subject = $1 and subject_id = $2 and fact = $3 for update',
    [subject, subjectId, fact]))[0]?.quality ?? null;
  if (cur === quality) return null;
  if (quality) {
    await db.q(`insert into fact_quality (subject, subject_id, fact, quality) values ($1, $2, $3, $4)
      on conflict (subject, subject_id, fact) do update set quality = excluded.quality`, [subject, subjectId, fact, quality]);
  } else await db.q('delete from fact_quality where subject = $1 and subject_id = $2 and fact = $3', [subject, subjectId, fact]);
  return logChange(db, userId, 'quality', subjectId, 'set', { subject, fact, quality: cur }, { subject, fact, quality },
    await subjectPersons(db, subject, subjectId));
}
