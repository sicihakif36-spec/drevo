// Справочник мест. Правится как данные дерева: каждое изменение пишется в журнал так, чтобы его можно было отменить
// (см. revert.js). Записи журнала: entity 'place', действия add, update, delete, restore.
// В карточках место — простой текст; место из справочника записано там полным названием (title). Новое название места
// заменяет текст у людей, браков и событий в том же действии: каждая замена — своя запись журнала, откат возвращает всё разом.
import { logChange } from './changes.js';
import { HttpError } from './tree.js';
import { updateEvent } from './timeline.js';
import { PLACE_FIELDS, PLACE_KINDS, placeTitle, placeKey } from '../../shared/places.js';

// Поля мест в карточке человека.
export const PERSON_PLACES = ['birth_place', 'death_place', 'burial_place'];

export async function livePlace(db, id) {
  const p = (await db.q('select * from places where id = $1 and deleted_at is null for update', [id]))[0];
  if (!p) throw new HttpError(404, 'Место не найдено');
  return p;
}

function check(data) {
  if ('kind' in data && !(data.kind in PLACE_KINDS)) throw new HttpError(400, 'Неизвестный вид места');
  if ('name' in data && !data.name) throw new HttpError(400, 'Напишите название места');
}

// Такого же места (по полному названию) в справочнике нет.
async function unique(db, title, id = null) {
  if (!title) throw new HttpError(400, 'Напишите название места');
  if ((await db.q('select 1 from places where place_key(title) = place_key($1) and deleted_at is null and id is distinct from $2', [title, id]))[0]) {
    throw new HttpError(409, `Такое место уже есть в справочнике: ${title}`);
  }
}

// Заменить место from на to во всех карточках: рождение, смерть, захоронение, брак, события.
// Регистр, пробелы и «ё» не важны: «д. горки» и «Д. Горки» — одно и то же. Удалённых не трогаем. -> сколько замен.
export async function retitle(db, userId, from, to) {
  if (!placeKey(from)) return 0;
  let n = 0;
  const persons = await db.q(
    `select * from persons where deleted_at is null and (${PERSON_PLACES.map((c) => `place_key(${c}) = place_key($1)`).join(' or ')}) for update`, [from]);
  for (const p of persons) {
    const cols = PERSON_PLACES.filter((c) => p[c] !== to && placeKey(p[c]) === placeKey(from));
    if (!cols.length) continue;
    await db.q(`update persons set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now() where id = $1`,
      [p.id, ...cols.map(() => to)]);
    await logChange(db, userId, 'person', p.id, 'update', Object.fromEntries(cols.map((c) => [c, p[c]])), Object.fromEntries(cols.map((c) => [c, to])));
    n++;
  }
  const families = await db.q('select * from families where place_key(place) = place_key($1) and place <> $2 for update', [from, to]);
  for (const f of families) {
    await db.q('update families set place = $2 where id = $1', [f.id, to]);
    await logChange(db, userId, 'family', f.id, 'update', { place: f.place }, { place: to }, [f.partner1, f.partner2]);
    n++;
  }
  const events = await db.q('select id from life_events where deleted_at is null and place_key(place) = place_key($1) and place <> $2', [from, to]);
  for (const e of events) if (await updateEvent(db, userId, e.id, { place: to })) n++;
  return n;
}

// from — текст места, который уже записан в карточках: он заменится полным названием нового места.
export async function createPlace(db, userId, data, from = '') {
  check({ kind: 'village', ...data, name: data.name ?? '' });
  const title = placeTitle(data);
  await unique(db, title);
  const cols = PLACE_FIELDS.filter((c) => c in data);
  const p = (await db.q(
    `insert into places (${[...cols, 'title', 'created_by'].join(', ')}) values (${[...cols, 't', 'u'].map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    [...cols.map((c) => data[c]), title, userId],
  ))[0];
  await logChange(db, userId, 'place', p.id, 'add', null, { ...Object.fromEntries(PLACE_FIELDS.map((c) => [c, p[c]])), title });
  if (from.trim()) await retitle(db, userId, from, title);
  return p;
}

// data — присланные поля. Полное название изменилось — оно заменится и в карточках (кроме отката: там карточки
// возвращаются своими записями журнала). null — ничего не изменилось.
export async function updatePlace(db, userId, id, data, { carry = true } = {}) {
  const p = await livePlace(db, id);
  const cols = PLACE_FIELDS.filter((c) => c in data && data[c] !== p[c]);
  if (!cols.length) return null;
  check(data);
  const next = { ...p, ...Object.fromEntries(cols.map((c) => [c, data[c]])) };
  const title = placeTitle(next);
  if (title !== p.title) await unique(db, title, id);
  await db.q(`update places set ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}, title = $2 where id = $1`, [id, title, ...cols.map((c) => data[c])]);
  // Название — для подписи в журнале, даже если оно не менялось.
  const changeId = await logChange(db, userId, 'place', id, 'update',
    { ...Object.fromEntries(cols.map((c) => [c, p[c]])), ...(title !== p.title ? { title: p.title } : {}) },
    { ...Object.fromEntries(cols.map((c) => [c, data[c]])), title });
  if (carry && title !== p.title) await retitle(db, userId, p.title, title);
  return changeId;
}

// Удалённое место остаётся в карточках простым текстом.
export async function deletePlace(db, userId, id) {
  const p = await livePlace(db, id);
  await db.q('update places set deleted_at = now() where id = $1', [id]);
  return logChange(db, userId, 'place', id, 'delete', { kind: p.kind, title: p.title }, null);
}

export async function restorePlace(db, userId, id) {
  const p = (await db.q('select * from places where id = $1 and deleted_at is not null for update', [id]))[0];
  if (!p) throw new HttpError(409, 'Это место уже в справочнике');
  await unique(db, p.title, id);
  await db.q('update places set deleted_at = null where id = $1', [id]);
  return logChange(db, userId, 'place', id, 'restore', null, { kind: p.kind, title: p.title });
}
