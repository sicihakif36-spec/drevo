// «Главная → Исследование» и раздел «Исследование» в карточке: вопросы поиска и записи по ходу (src/research.js).
// Только владелец и участники: в записях бывают сведения о живых, поэтому родственнику и гостю — 403 на всё.
// «Загрузить результат» — ответ ИИ-помощника текстом: из него вырезается GEDCOM и идёт в обычную загрузку из файла
// (routes/import.js) — тот же предпросмотр, загрузка одним действием и отмена.
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { HttpError } from '../tree.js';
import { createQuestion, updateQuestion, deleteQuestion, createNote, updateNote, deleteNote } from '../research.js';
import { keepForImport } from './import.js';
import { extractGedcom, QUESTION_MAX, NOTE_LIMITS, ANSWER_MAX, ANSWER_FILE } from '../../../shared/research.js';

const NO_FILE = 'В ответе нет файла для загрузки — попросите помощника прислать результат в формате GEDCOM';

const QUESTIONS = `select x.id, x.person_id, x.title, x.status, x.created_at, x.updated_at, x.created_by, u.name as user_name,
    (select count(*)::int from research_notes n where n.question_id = x.id and n.deleted_at is null) as notes
  from research_questions x join persons p on p.id = x.person_id left join users u on u.id = x.created_by
  where x.deleted_at is null and p.deleted_at is null`;
// Сначала «ищем», потом по последней записи.
const ORDER = `order by (x.status = 'open') desc, x.updated_at desc, x.id`;

// Записи поиска; у записи о загрузке — номер действия и отменено ли оно.
const NOTES = `select n.id, n.question_id, n.result, n.place, n.url, n.ref, n.body, n.op, n.created_at, n.created_by, u.name as user_name,
    (select min(c.id) from changes c where c.op = n.op) as change,
    exists (select 1 from changes c join changes r on r.id = c.reverted_by where c.op = n.op and r.reverted_by is null) as undone
  from research_notes n left join users u on u.id = n.created_by
  where n.deleted_at is null`;

function question(body) {
  const out = {};
  if (body?.title !== undefined) out.title = String(body.title ?? '').trim().slice(0, QUESTION_MAX);
  if (body?.status !== undefined) out.status = String(body.status);
  return out;
}

function note(body) {
  const out = {};
  for (const [k, n] of Object.entries(NOTE_LIMITS)) if (body?.[k] !== undefined) out[k] = String(body[k] ?? '').trim().slice(0, n);
  if (body?.result !== undefined) out.result = String(body.result ?? '');
  return out;
}

const one = async (id) => (await q(`${QUESTIONS} and x.id = $1`, [id]))[0];

// Вопросы с записями, новые записи снизу.
async function withNotes(rows) {
  const notes = rows.length ? await q(`${NOTES} and n.question_id = any($1::uuid[]) order by n.created_at, n.id`, [rows.map((r) => r.id)]) : [];
  return rows.map((r) => ({ ...r, items: notes.filter((n) => n.question_id === r.id) }));
}

export default async function researchRoutes(app) {
  // Все вопросы по дереву: для «Главная → Исследование».
  app.get('/api/research', { preHandler: need('editor') }, async () => q(`${QUESTIONS} ${ORDER}`));

  app.get('/api/persons/:id/research', { preHandler: need('editor') }, async (req) => withNotes(await q(`${QUESTIONS} and x.person_id = $1 ${ORDER}`, [req.params.id])));

  app.get('/api/research/:id', { preHandler: need('editor') }, async (req) => {
    const x = await one(req.params.id);
    if (!x) throw new HttpError(404, 'Вопрос не найден');
    return (await withNotes([x]))[0];
  });

  app.post('/api/persons/:id/research', { preHandler: need('editor') }, async (req) => {
    const data = question(req.body);
    if (!data.title) throw new HttpError(400, 'Напишите, что хотите узнать');
    const x = await tx((db) => createQuestion(db, req.user.id, req.params.id, data));
    return (await withNotes([await one(x.id)]))[0];
  });

  app.patch('/api/research/:id', { preHandler: need('editor') }, async (req) => {
    await tx((db) => updateQuestion(db, req.user.id, req.params.id, question(req.body)));
    const x = await one(req.params.id);
    if (!x) throw new HttpError(404, 'Вопрос не найден');
    return x;
  });

  app.delete('/api/research/:id', { preHandler: need('editor') }, async (req) => {
    const changeId = await tx((db) => deleteQuestion(db, req.user.id, req.params.id));
    return { ok: true, changeId };
  });

  app.post('/api/research/:id/notes', { preHandler: need('editor') }, async (req) => {
    const n = await tx((db) => createNote(db, req.user.id, req.params.id, note(req.body)));
    return (await q(`${NOTES} and n.id = $1`, [n.id]))[0];
  });

  app.patch('/api/research/notes/:id', { preHandler: need('editor') }, async (req) => {
    await tx((db) => updateNote(db, req.user.id, req.params.id, note(req.body)));
    const n = (await q(`${NOTES} and n.id = $1`, [req.params.id]))[0];
    if (!n) throw new HttpError(404, 'Запись не найдена');
    return n;
  });

  app.delete('/api/research/notes/:id', { preHandler: need('editor') }, async (req) => {
    const changeId = await tx((db) => deleteNote(db, req.user.id, req.params.id));
    return { ok: true, changeId };
  });

  // «Загрузить результат»: ответ помощника целиком -> предпросмотр загрузки из файла.
  app.post('/api/research/:id/import', { preHandler: need('editor'), bodyLimit: ANSWER_MAX + 64 * 1024 }, async (req) => {
    const x = await one(req.params.id);
    if (!x) throw new HttpError(404, 'Вопрос не найден');
    const text = String(req.body?.text ?? '');
    if (!text.trim()) throw new HttpError(400, 'Вставьте ответ помощника целиком');
    const found = extractGedcom(text);
    if (!found) throw new HttpError(400, NO_FILE);
    try {
      return await keepForImport(Buffer.from(found.gedcom, 'utf8'), ANSWER_FILE, req.user,
        { question_id: x.id, report: found.report.slice(0, 15000) });
    } catch (err) {
      if (err.statusCode === 400 && /не похоже/.test(err.message)) throw new HttpError(400, NO_FILE);
      if (err.statusCode === 400 && /нет ни одного/.test(err.message)) throw new HttpError(400, 'В файле из ответа нет ни одного человека — попросите помощника прислать найденных людей в формате GEDCOM');
      throw err;
    }
  });
}
