// Истории: общая летопись семьи, правятся как данные дерева. Каждое изменение пишется в журнал так,
// чтобы его можно было отменить (см. revert.js). Записи журнала: entity 'story', действия add, delete, restore,
// update (заголовок, дата, текст, запись голоса) и link, unlink (человек, о ком история).
import { logChange } from './changes.js';
import { HttpError } from './tree.js';

export const STORY_FIELDS = ['title', 'date', 'body', 'audio_id'];

// Что пишется в журнал об истории: по этому снимку строится подпись в ленте.
export const snapshot = (s) => ({ title: s.title, date: s.date, audio: Boolean(s.audio_id) });

export async function linked(db, storyId) {
  return (await db.q('select person_id from story_persons where story_id = $1 order by person_id', [storyId])).map((r) => r.person_id);
}

export async function liveStory(db, id) {
  const s = (await db.q('select * from stories where id = $1 and deleted_at is null for update', [id]))[0];
  if (!s) throw new HttpError(404, 'История не найдена');
  return s;
}

// Запись голоса: загруженный файл, ещё не приложенный к другой истории.
export async function checkAudio(db, audioId, storyId = null) {
  const m = (await db.q("select id from media where id = $1 and kind = 'audio'", [audioId]))[0];
  if (!m) throw new HttpError(400, 'Запись голоса не найдена. Запишите её ещё раз.');
  if ((await db.q('select 1 from stories where audio_id = $1 and id is distinct from $2', [audioId, storyId]))[0]) {
    throw new HttpError(409, 'Эта запись уже приложена к другой истории');
  }
}

export async function createStory(db, userId, personId, data) {
  if (data.audio_id) await checkAudio(db, data.audio_id);
  const s = (await db.q(
    'insert into stories (title, date, body, audio_id, created_by) values ($1, $2, $3, $4, $5) returning *',
    [data.title, data.date || '', data.body || '', data.audio_id || null, userId],
  ))[0];
  await db.q('insert into story_persons (story_id, person_id) values ($1, $2)', [s.id, personId]);
  await logChange(db, userId, 'story', s.id, 'add', null, snapshot(s), [personId]);
  return s;
}

// data — только изменённые поля.
export async function updateStory(db, userId, id, data) {
  const s = await liveStory(db, id);
  const cols = STORY_FIELDS.filter((c) => c in data && data[c] !== s[c]);
  if (!cols.length) return null;
  if (cols.includes('audio_id') && data.audio_id) await checkAudio(db, data.audio_id, id);
  if (cols.includes('title') && !data.title) throw new HttpError(400, 'Напишите заголовок');
  await db.q(`update stories set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [id, ...cols.map((c) => data[c])]);
  // Заголовок — для подписи в журнале, даже если он не менялся.
  return logChange(db, userId, 'story', id, 'update',
    Object.fromEntries(cols.map((c) => [c, s[c]])), { title: s.title, ...Object.fromEntries(cols.map((c) => [c, data[c]])) },
    await linked(db, id));
}

export async function deleteStory(db, userId, id) {
  const s = await liveStory(db, id);
  await db.q('update stories set deleted_at = now() where id = $1', [id]);
  return logChange(db, userId, 'story', id, 'delete', snapshot(s), null, await linked(db, id));
}

export async function restoreStory(db, userId, id) {
  const s = (await db.q('update stories set deleted_at = null where id = $1 and deleted_at is not null returning *', [id]))[0];
  if (!s) throw new HttpError(409, 'Эта история уже на месте');
  return logChange(db, userId, 'story', id, 'restore', null, snapshot(s), await linked(db, id));
}

// null — человек уже связан с историей.
export async function linkPerson(db, userId, storyId, personId) {
  const s = await liveStory(db, storyId);
  const ok = (await db.q('insert into story_persons (story_id, person_id) values ($1, $2) on conflict do nothing returning 1', [storyId, personId]))[0];
  if (!ok) return null;
  return logChange(db, userId, 'story', storyId, 'link', null, { person_id: personId, title: s.title }, await linked(db, storyId));
}

// null — человек не связан с историей.
export async function unlinkPerson(db, userId, storyId, personId) {
  const s = await liveStory(db, storyId);
  const persons = await linked(db, storyId);
  if (!persons.includes(personId)) return null;
  if (persons.length === 1) throw new HttpError(409, 'У истории должен остаться хотя бы один человек. Чтобы убрать историю совсем, удалите её.');
  await db.q('delete from story_persons where story_id = $1 and person_id = $2', [storyId, personId]);
  return logChange(db, userId, 'story', storyId, 'unlink', { person_id: personId, title: s.title }, null, persons);
}
