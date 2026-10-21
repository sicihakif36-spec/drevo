// Альбом: фото и документы, отметки людей на них, главное фото. Каждое изменение пишется в журнал
// так, чтобы его можно было отменить (см. revert.js). Записи журнала: entity 'media', действия
// add, delete, restore, update (подпись и дата), tag и untag (отметка человека); главное фото — person 'photo'.
import { logChange } from './changes.js';
import { HttpError } from './tree.js';

export const MEDIA_FIELDS = ['caption', 'date'];

// Что пишется в журнал о файле: по этому снимку строится подпись в ленте.
export const snapshot = (m) => ({ kind: m.kind, name: m.name, caption: m.caption, date: m.date });

export async function tagged(db, mediaId) {
  return (await db.q('select person_id from media_persons where media_id = $1 order by person_id', [mediaId])).map((r) => r.person_id);
}

export async function liveMedia(db, id) {
  const m = (await db.q('select * from media where id = $1 and deleted_at is null for update', [id]))[0];
  if (!m) throw new HttpError(404, 'Файл не найден');
  return m;
}

// Главное фото человека; null — без главного фото. Возвращает id записи журнала или null, если ничего не изменилось.
export async function setMain(db, userId, personId, mediaId) {
  const p = (await db.q('select photo_id from persons where id = $1 for update', [personId]))[0];
  if (!p || (p.photo_id ?? null) === mediaId) return null;
  await db.q('update persons set photo_id = $1, version = version + 1, updated_at = now() where id = $2', [mediaId, personId]);
  return logChange(db, userId, 'person', personId, 'photo', { photo_id: p.photo_id }, { photo_id: mediaId });
}

export async function deleteMedia(db, userId, id) {
  const m = await liveMedia(db, id);
  // Удалённый файл не может оставаться главным фото. Снимаем до удаления: откат идёт с конца и вернёт сначала файл.
  for (const p of await db.q('select id from persons where photo_id = $1', [id])) await setMain(db, userId, p.id, null);
  await db.q('update media set deleted_at = now() where id = $1', [id]);
  return logChange(db, userId, 'media', id, 'delete', snapshot(m), null, await tagged(db, id));
}

export async function restoreMedia(db, userId, id) {
  const m = (await db.q('update media set deleted_at = null where id = $1 and deleted_at is not null returning *', [id]))[0];
  if (!m) throw new HttpError(409, 'Этот файл уже на месте');
  return logChange(db, userId, 'media', id, 'restore', null, snapshot(m), await tagged(db, id));
}

// null — человек уже отмечен.
export async function tag(db, userId, mediaId, personId) {
  const m = await liveMedia(db, mediaId);
  const ok = (await db.q('insert into media_persons (media_id, person_id) values ($1, $2) on conflict do nothing returning 1', [mediaId, personId]))[0];
  if (!ok) return null;
  return logChange(db, userId, 'media', mediaId, 'tag', null, { person_id: personId, kind: m.kind }, await tagged(db, mediaId));
}

// null — человек не отмечен.
export async function untag(db, userId, mediaId, personId) {
  const m = await liveMedia(db, mediaId);
  const persons = await tagged(db, mediaId);
  if (!persons.includes(personId)) return null;
  if (persons.length === 1) throw new HttpError(409, 'На файле должен остаться хотя бы один человек. Чтобы убрать файл совсем, удалите его.');
  await db.q('delete from media_persons where media_id = $1 and person_id = $2', [mediaId, personId]);
  const changeId = await logChange(db, userId, 'media', mediaId, 'untag', { person_id: personId, kind: m.kind }, null, persons);
  // Фото, где человека больше нет, не может быть его главным.
  const p = (await db.q('select photo_id from persons where id = $1', [personId]))[0];
  if (p?.photo_id === mediaId) await setMain(db, userId, personId, null);
  return changeId;
}

// Подпись и дата; data — только изменённые поля.
export async function updateMedia(db, userId, id, data) {
  const m = await liveMedia(db, id);
  const cols = MEDIA_FIELDS.filter((c) => c in data && data[c] !== m[c]);
  if (!cols.length) return null;
  await db.q(`update media set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [id, ...cols.map((c) => data[c])]);
  return logChange(db, userId, 'media', id, 'update',
    Object.fromEntries(cols.map((c) => [c, m[c]])), Object.fromEntries(cols.map((c) => [c, data[c]])), await tagged(db, id));
}
