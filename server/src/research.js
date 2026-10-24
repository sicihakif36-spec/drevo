// Исследование: вопросы поиска у человека («что хотим узнать») и записи по ходу — где искали, что нашли.
// Правятся как данные дерева: каждое изменение пишется в журнал так, чтобы его можно было отменить (см. revert.js).
// Записи журнала: entity 'research' (вопрос) и 'research_note' (запись поиска), действия add, update, delete, restore.
// Удаление мягкое: deleted_at. Видят только владелец и участники (RESEARCH в changes.js).
import { logChange } from './changes.js';
import { HttpError, alive } from './tree.js';
import { STATUSES, RESULTS } from '../../shared/research.js';

export const QUESTION_FIELDS = ['title', 'status'];
export const NOTE_FIELDS = ['result', 'place', 'url', 'ref', 'body'];
const GONE = 'Этот вопрос удалён. Сначала верните его.';

// Что пишется в журнал: по этому снимку строится подпись в «Последних правках».
const qSnap = (x) => ({ person_id: x.person_id, title: x.title, status: x.status });
const nSnap = (x, question) => ({ question_id: x.question_id, title: question.title, result: x.result, place: x.place });

async function liveQuestion(db, id) {
  const x = (await db.q('select * from research_questions where id = $1 and deleted_at is null for update', [id]))[0];
  if (!x) throw new HttpError(404, 'Вопрос не найден');
  return x;
}

function check(data) {
  if ('title' in data && !data.title) throw new HttpError(400, 'Напишите, что хотите узнать');
  if ('status' in data && !STATUSES[data.status]) throw new HttpError(400, 'Неизвестное состояние вопроса');
  if ('result' in data && !(data.result in RESULTS)) throw new HttpError(400, 'Неизвестный итог поиска');
}

export async function createQuestion(db, userId, personId, data) {
  check(data);
  if (!(await alive(db, personId))) throw new HttpError(404, 'Человек не найден');
  const x = (await db.q(
    'insert into research_questions (person_id, title, status, created_by) values ($1, $2, $3, $4) returning *',
    [personId, data.title, data.status || 'open', userId],
  ))[0];
  await logChange(db, userId, 'research', x.id, 'add', null, qSnap(x), [personId]);
  return x;
}

// data — только изменённые поля. null — ничего не изменилось.
export async function updateQuestion(db, userId, id, data) {
  const x = await liveQuestion(db, id);
  const cols = QUESTION_FIELDS.filter((c) => c in data && data[c] !== x[c]);
  if (!cols.length) return null;
  check(data);
  await db.q(`update research_questions set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`,
    [id, ...cols.map((c) => data[c])]);
  return logChange(db, userId, 'research', id, 'update',
    Object.fromEntries(cols.map((c) => [c, x[c]])), { ...qSnap(x), ...Object.fromEntries(cols.map((c) => [c, data[c]])) }, [x.person_id]);
}

// Записи поиска удалённого вопроса остаются в базе: возврат вопроса возвращает и их.
export async function deleteQuestion(db, userId, id) {
  const x = await liveQuestion(db, id);
  await db.q('update research_questions set deleted_at = now() where id = $1', [id]);
  return logChange(db, userId, 'research', id, 'delete', qSnap(x), null, [x.person_id]);
}

export async function restoreQuestion(db, userId, id) {
  const cur = (await db.q('select person_id from research_questions where id = $1', [id]))[0];
  if (cur && !(await alive(db, cur.person_id))) throw new HttpError(409, 'Этот человек удалён. Сначала верните его.');
  const x = (await db.q('update research_questions set deleted_at = null where id = $1 and deleted_at is not null returning *', [id]))[0];
  if (!x) throw new HttpError(409, 'Этот вопрос уже на месте');
  return logChange(db, userId, 'research', id, 'restore', null, qSnap(x), [x.person_id]);
}

async function liveNote(db, id) {
  const n = (await db.q('select * from research_notes where id = $1 and deleted_at is null for update', [id]))[0];
  if (!n) throw new HttpError(404, 'Запись не найдена');
  return n;
}
const questionOf = async (db, id) => (await db.q('select * from research_questions where id = $1', [id]))[0];

// data.op — действие загрузки из ответа помощника, если запись о ней.
export async function createNote(db, userId, questionId, data) {
  check(data);
  const x = await liveQuestion(db, questionId);
  if (!NOTE_FIELDS.some((c) => c !== 'result' && data[c])) throw new HttpError(400, 'Напишите, где искали или что нашли');
  const cols = NOTE_FIELDS.filter((c) => c in data);
  const n = (await db.q(
    `insert into research_notes (question_id, op, created_by${cols.map((c) => `, ${c}`).join('')})
     values ($1, $2, $3${cols.map((_, i) => `, $${i + 4}`).join('')}) returning *`,
    [questionId, data.op || null, userId, ...cols.map((c) => data[c])],
  ))[0];
  await db.q('update research_questions set updated_at = now() where id = $1', [questionId]);
  await logChange(db, userId, 'research_note', n.id, 'add', null, nSnap(n, x), [x.person_id]);
  return n;
}

export async function updateNote(db, userId, id, data) {
  const n = await liveNote(db, id);
  const cols = NOTE_FIELDS.filter((c) => c in data && data[c] !== n[c]);
  if (!cols.length) return null;
  check(data);
  const next = { ...n, ...Object.fromEntries(cols.map((c) => [c, data[c]])) };
  if (!NOTE_FIELDS.some((c) => c !== 'result' && next[c])) throw new HttpError(400, 'Напишите, где искали или что нашли');
  await db.q(`update research_notes set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [id, ...cols.map((c) => data[c])]);
  const x = await questionOf(db, n.question_id);
  return logChange(db, userId, 'research_note', id, 'update',
    Object.fromEntries(cols.map((c) => [c, n[c]])), nSnap(next, x), [x.person_id]);
}

export async function deleteNote(db, userId, id) {
  const n = await liveNote(db, id);
  await db.q('update research_notes set deleted_at = now() where id = $1', [id]);
  const x = await questionOf(db, n.question_id);
  return logChange(db, userId, 'research_note', id, 'delete', nSnap(n, x), null, [x.person_id]);
}

export async function restoreNote(db, userId, id) {
  const cur = (await db.q('select q.deleted_at from research_notes n join research_questions q on q.id = n.question_id where n.id = $1', [id]))[0];
  if (cur?.deleted_at) throw new HttpError(409, GONE);
  const n = (await db.q('update research_notes set deleted_at = null where id = $1 and deleted_at is not null returning *', [id]))[0];
  if (!n) throw new HttpError(409, 'Эта запись уже на месте');
  const x = await questionOf(db, n.question_id);
  return logChange(db, userId, 'research_note', id, 'restore', null, nSnap(n, x), [x.person_id]);
}
