// События ленты жизни: учёба, служба, переезд, награда… Правятся как данные дерева: каждое изменение пишется в журнал так,
// чтобы его можно было отменить (см. revert.js). Записи журнала: entity 'event', действия add, delete, restore,
// update (поля события) и link, unlink (участник). Сведения, которые уже есть в дереве (рождение, брак, смерть), сюда не пишутся.
import { logChange } from './changes.js';
import { HttpError, alive } from './tree.js';
import { EVENT_FIELDS, EVENT_KINDS } from '../../shared/events.js';

// Что пишется в журнал о событии: по этому снимку строится подпись в ленте.
export const snapshot = (ev) => ({ kind: ev.kind, title: ev.title, date: ev.date });

export async function participants(db, eventId) {
  return (await db.q('select person_id from event_persons where event_id = $1 order by person_id', [eventId])).map((r) => r.person_id);
}

export async function liveEvent(db, id) {
  const ev = (await db.q('select * from life_events where id = $1 and deleted_at is null for update', [id]))[0];
  if (!ev) throw new HttpError(404, 'Событие не найдено');
  return ev;
}

function check(data) {
  if ('kind' in data && !EVENT_KINDS[data.kind]) throw new HttpError(400, 'Неизвестный вид события');
}

// persons — участники, первый — тот, в чьей карточке событие добавили.
export async function createEvent(db, userId, persons, data) {
  check(data);
  for (const id of persons) if (!(await alive(db, id))) throw new HttpError(404, 'Человек не найден');
  const cols = EVENT_FIELDS.filter((c) => c in data);
  const ev = (await db.q(
    `insert into life_events (${[...cols, 'created_by'].join(', ')}) values (${[...cols, 'u'].map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    [...cols.map((c) => data[c]), userId],
  ))[0];
  for (const id of persons) await db.q('insert into event_persons (event_id, person_id) values ($1, $2) on conflict do nothing', [ev.id, id]);
  await logChange(db, userId, 'event', ev.id, 'add', null, snapshot(ev), persons);
  return ev;
}

// data — только изменённые поля. null — ничего не изменилось.
export async function updateEvent(db, userId, id, data) {
  const ev = await liveEvent(db, id);
  const cols = EVENT_FIELDS.filter((c) => c in data && data[c] !== ev[c]);
  if (!cols.length) return null;
  check(data);
  await db.q(`update life_events set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [id, ...cols.map((c) => data[c])]);
  // Вид и название — для подписи в журнале, даже если они не менялись.
  return logChange(db, userId, 'event', id, 'update',
    Object.fromEntries(cols.map((c) => [c, ev[c]])), { ...snapshot(ev), ...Object.fromEntries(cols.map((c) => [c, data[c]])) },
    await participants(db, id));
}

// Источники и достоверность удалённого события остаются в базе: возврат события возвращает и их.
export async function deleteEvent(db, userId, id) {
  const ev = await liveEvent(db, id);
  await db.q('update life_events set deleted_at = now() where id = $1', [id]);
  return logChange(db, userId, 'event', id, 'delete', snapshot(ev), null, await participants(db, id));
}

export async function restoreEvent(db, userId, id) {
  const ev = (await db.q('update life_events set deleted_at = null where id = $1 and deleted_at is not null returning *', [id]))[0];
  if (!ev) throw new HttpError(409, 'Это событие уже на месте');
  return logChange(db, userId, 'event', id, 'restore', null, snapshot(ev), await participants(db, id));
}

// null — человек уже участник.
export async function addParticipant(db, userId, eventId, personId) {
  const ev = await liveEvent(db, eventId);
  const ok = (await db.q('insert into event_persons (event_id, person_id) values ($1, $2) on conflict do nothing returning 1', [eventId, personId]))[0];
  if (!ok) return null;
  return logChange(db, userId, 'event', eventId, 'link', null, { person_id: personId, ...snapshot(ev) }, await participants(db, eventId));
}

// null — человек не участник.
export async function removeParticipant(db, userId, eventId, personId) {
  const ev = await liveEvent(db, eventId);
  const persons = await participants(db, eventId);
  if (!persons.includes(personId)) return null;
  if (persons.length === 1) throw new HttpError(409, 'У события должен остаться хотя бы один человек. Чтобы убрать событие совсем, удалите его.');
  await db.q('delete from event_persons where event_id = $1 and person_id = $2', [eventId, personId]);
  return logChange(db, userId, 'event', eventId, 'unlink', { person_id: personId, ...snapshot(ev) }, null, persons);
}
