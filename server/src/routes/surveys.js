// Анкета для родственника: владелец или участник создаёт ссылку, родственник заполняет её без входа,
// ответы загружаются в дерево одним действием (src/surveys.js).
// Публичные маршруты /api/survey… — только по токену из заголовка x-survey (не в адресе: адреса попадают в журналы сервера),
// с ограничением частоты; по ним видна только своя анкета и ничего из дерева, кроме имени того, кто просит.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { q, tx } from '../db.js';
import { need, hash, newToken } from '../auth.js';
import { config } from '../config.js';
import { listOps } from '../changes.js';
import { HttpError, alive } from '../tree.js';
import { MAX_FILE, mediaPath } from './media.js';
import { SURVEY_DAYS, surveyPath, surveyStatus, UNDONE, loadSurvey } from '../surveys.js';
import { cleanAnswers, MAX_PHOTOS } from '../../../shared/survey.js';

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const WINDOW = 10 * 60 * 1000;
const MAX_ANSWERS = 200 * 1024; // ответы целиком, в байтах JSON
const text = (v, n) => String(v ?? '').trim().slice(0, n);

// Частота с одного адреса: всего запросов и неверных ссылок (перебор токенов).
const hits = new Map();
function tooMany(key, limit) {
  const now = Date.now();
  const a = (hits.get(key) || []).filter((t) => now - t < WINDOW);
  a.push(now);
  hits.set(key, a);
  if (hits.size > 10000) for (const [k, v] of hits) if (now - v.at(-1) > WINDOW) hits.delete(k);
  return a.length > limit;
}
const failed = (ip) => (hits.get(`bad:${ip}`) || []).filter((t) => Date.now() - t < WINDOW).length;

// Анкета по токену из заголовка. write — для правки: после отправки только чтение.
async function bySurveyToken(req, { write = false } = {}) {
  if (failed(req.ip) >= 20 || tooMany(`all:${req.ip}`, 600)) throw new HttpError(429, 'Слишком много попыток, подождите 10 минут');
  const token = String(req.headers['x-survey'] || '');
  const s = token.length >= 20 && token.length <= 100 ? (await q('select * from surveys where token_hash = $1', [hash(token)]))[0] : null;
  if (!s) {
    tooMany(`bad:${req.ip}`, Infinity);
    throw new HttpError(404, 'Ссылка на анкету недействительна. Попросите новую у того, кто её прислал.');
  }
  if (s.revoked_at) throw new HttpError(410, 'Эту анкету отозвали. Если нужно, попросите новую ссылку.');
  if (s.expires_at < new Date()) throw new HttpError(410, 'Срок ссылки истёк. Попросите новую у того, кто её прислал.');
  if (write && s.submitted_at) throw new HttpError(409, 'Анкета уже отправлена, менять её нельзя. Спасибо!');
  return s;
}

const photos = (id) => q('select id, caption, thumb from survey_files where survey_id = $1 order by created_at, id', [id]);

// Отдать файл анкеты: фото или его уменьшенную копию.
async function sendFile(reply, f, thumb) {
  const file = surveyPath(f.id, thumb && f.thumb);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) return reply.code(404).send({ error: 'Файл не найден' });
  return reply.header('Content-Type', thumb && f.thumb ? 'image/jpeg' : f.mime).header('Cache-Control', 'private, no-store')
    .header('Content-Length', stat.size).send(fs.createReadStream(file));
}

function saveAnswers(body) {
  const answers = cleanAnswers(body?.answers);
  if (Buffer.byteLength(JSON.stringify(answers)) > MAX_ANSWERS) throw new HttpError(413, 'Слишком много текста. Сократите рассказ или заметки.');
  return answers;
}

const LIST = `select s.id, s.name, s.person_id, s.created_at, s.expires_at, s.revoked_at, s.opened_at, s.saved_at, s.submitted_at,
    s.loaded_op, s.loaded_at, ${UNDONE} as undone, u.name as created_by_name, l.name as loaded_by_name,
    s.answers->'people'->'self'->>'sex' as sex,
    (select count(*)::int from survey_files f where f.survey_id = s.id) as photos
  from surveys s left join users u on u.id = s.created_by left join users l on l.id = s.loaded_by`;
const row = ({ undone, loaded_op: op, ...s }) => ({ ...s, status: surveyStatus({ ...s, loaded_op: op, undone }) });

export default async function surveyRoutes(app) {
  await fsp.mkdir(path.join(config.dataDir, 'survey'), { recursive: true });

  // ---------- Для того, кто заполняет (без входа) ----------

  app.get('/api/survey', async (req) => {
    const s = await bySurveyToken(req);
    if (!s.opened_at) await q('update surveys set opened_at = now() where id = $1', [s.id]);
    const from = (await q('select name from users where id = $1', [s.created_by]))[0]?.name || '';
    // Только имя того, кто просит: подпись «для кого» — его собственная, её человеку не показываем.
    return {
      from,
      answers: cleanAnswers(s.answers),
      photos: await photos(s.id),
      submitted: Boolean(s.submitted_at),
      expires_at: s.expires_at,
    };
  });

  // Черновик: телефон присылает ответы целиком по ходу заполнения.
  app.put('/api/survey', async (req) => {
    const s = await bySurveyToken(req, { write: true });
    const answers = saveAnswers(req.body);
    await q('update surveys set answers = $2, saved_at = now() where id = $1 and submitted_at is null', [s.id, JSON.stringify(answers)]);
    return { ok: true };
  });

  app.post('/api/survey/submit', async (req) => {
    const s = await bySurveyToken(req, { write: true });
    const answers = saveAnswers(req.body);
    const done = await q(
      'update surveys set answers = $2, saved_at = now(), submitted_at = now() where id = $1 and submitted_at is null returning id',
      [s.id, JSON.stringify(answers)],
    );
    if (done.length) app.push.survey(s.id);
    return { ok: true };
  });

  // Фото: по одному, с уменьшенной копией thumb, которую делает телефон. Поле до файла: caption.
  app.post('/api/survey/photos', async (req) => {
    const s = await bySurveyToken(req, { write: true });
    if ((await photos(s.id)).length >= MAX_PHOTOS) throw new HttpError(400, `Можно приложить не больше ${MAX_PHOTOS} фото`);
    const id = crypto.randomUUID();
    const fields = {};
    let file = null;
    let thumb = false;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') fields[part.fieldname] = part.value;
        else if (part.fieldname === 'file' && !file && IMAGES.includes(part.mimetype)) {
          file = { mime: part.mimetype, name: text(part.filename, 200) };
          await pipeline(part.file, fs.createWriteStream(surveyPath(id)));
        } else if (part.fieldname === 'thumb' && file && part.mimetype === 'image/jpeg') {
          await pipeline(part.file, fs.createWriteStream(surveyPath(id, true)));
          thumb = true;
        } else part.file.resume();
      }
      if (!file) throw new HttpError(400, 'Нужна фотография JPEG, PNG или WebP');
      const { size } = await fsp.stat(surveyPath(id));
      if (!size) throw new HttpError(400, 'Файл пустой');
      // Проверка числа ещё раз: несколько фото могли прийти одновременно.
      const f = (await q(
        `insert into survey_files (id, survey_id, mime, bytes, name, caption, thumb)
         select $1, $2, $3, $4, $5, $6, $7 where (select count(*) from survey_files where survey_id = $2) < $8
         returning id, caption, thumb`,
        [id, s.id, file.mime, size, file.name, text(fields.caption, 500), thumb, MAX_PHOTOS],
      ))[0];
      if (!f) throw new HttpError(400, `Можно приложить не больше ${MAX_PHOTOS} фото`);
      return f;
    } catch (err) {
      await fsp.rm(surveyPath(id), { force: true });
      await fsp.rm(surveyPath(id, true), { force: true });
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, `Файл слишком большой: не больше ${MAX_FILE / 1024 / 1024} МБ`);
      if (err.code === 'FST_FILES_LIMIT') throw new HttpError(413, 'Фото отправляются по одному');
      throw err;
    }
  });

  app.patch('/api/survey/photos/:id', async (req) => {
    const s = await bySurveyToken(req, { write: true });
    const f = (await q('update survey_files set caption = $3 where id = $1 and survey_id = $2 returning id, caption, thumb',
      [req.params.id, s.id, text(req.body?.caption, 500)]))[0];
    if (!f) throw new HttpError(404, 'Фото не найдено');
    return f;
  });

  app.delete('/api/survey/photos/:id', async (req) => {
    const s = await bySurveyToken(req, { write: true });
    const f = (await q('delete from survey_files where id = $1 and survey_id = $2 returning id', [req.params.id, s.id]))[0];
    if (!f) throw new HttpError(404, 'Фото не найдено');
    await fsp.rm(surveyPath(f.id), { force: true });
    await fsp.rm(surveyPath(f.id, true), { force: true });
    return { ok: true };
  });

  app.get('/api/survey/photos/:id', async (req, reply) => {
    const s = await bySurveyToken(req);
    const f = (await q('select * from survey_files where id = $1 and survey_id = $2', [req.params.id, s.id]))[0];
    if (!f) throw new HttpError(404, 'Фото не найдено');
    return sendFile(reply, f, true);
  });

  // ---------- Для владельца и участников: в ответах данные живых, родственникам и гостям не видны ----------

  app.get('/api/surveys', { preHandler: need('editor') }, async () => (await q(`${LIST} order by s.created_at desc`)).map(row));

  app.post('/api/surveys', { preHandler: need('editor') }, async (req) => {
    const name = text(req.body?.name, 80);
    if (!name) throw new HttpError(400, 'Напишите, кому анкета');
    const personId = req.body?.person_id || null;
    if (personId && !(await alive({ q }, personId))) throw new HttpError(404, 'Человек не найден');
    const token = newToken();
    const s = (await q(
      `insert into surveys (token_hash, name, person_id, created_by, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(days => $5)) returning id`,
      [hash(token), name, personId, req.user.id, SURVEY_DAYS],
    ))[0];
    return { id: s.id, token, url: `${config.publicUrl}/#/survey/${token}` };
  });

  // Новая ссылка взамен потерянной (в базе только хеш, старую показать нельзя): старая перестаёт работать, срок — заново.
  app.post('/api/surveys/:id/link', { preHandler: need('editor') }, async (req) => {
    const token = newToken();
    const s = (await q(
      `update surveys set token_hash = $2, expires_at = now() + make_interval(days => $3)
       where id = $1 and revoked_at is null and submitted_at is null returning id`,
      [req.params.id, hash(token), SURVEY_DAYS],
    ))[0];
    if (!s) throw new HttpError(409, 'Анкета уже отправлена или отозвана');
    return { id: s.id, token, url: `${config.publicUrl}/#/survey/${token}` };
  });

  app.get('/api/surveys/:id', { preHandler: need('editor') }, async (req) => {
    const s = (await q(`${LIST} where s.id = $1`, [req.params.id]))[0];
    if (!s) throw new HttpError(404, 'Анкета не найдена');
    const answers = (await q('select answers from surveys where id = $1', [s.id]))[0].answers;
    const out = row(s);
    return {
      ...out,
      // Пока анкету не отправили, ответов не показываем: человек ещё пишет.
      answers: s.submitted_at ? cleanAnswers(answers) : null,
      files: s.submitted_at ? await photos(s.id) : [],
      load: s.loaded_op ? (await listOps({ op: s.loaded_op }))[0] || null : null,
    };
  });

  app.get('/api/surveys/:id/photos/:fid', { preHandler: need('editor') }, async (req, reply) => {
    const f = (await q('select * from survey_files where id = $1 and survey_id = $2', [req.params.fid, req.params.id]))[0];
    if (!f) throw new HttpError(404, 'Фото не найдено');
    return sendFile(reply, f, req.query.full === undefined);
  });

  // Отозвать: ссылка перестаёт работать. Загруженную анкету отзывать незачем.
  app.delete('/api/surveys/:id', { preHandler: need('editor') }, async (req) => {
    const s = (await q(`select s.*, ${UNDONE} as undone from surveys s where s.id = $1`, [req.params.id]))[0];
    if (!s) throw new HttpError(404, 'Анкета не найдена');
    if (surveyStatus(s) === 'loaded') throw new HttpError(409, 'Анкета уже загружена в дерево. Чтобы убрать её из дерева, отмените загрузку.');
    await q('update surveys set revoked_at = coalesce(revoked_at, now()) where id = $1', [s.id]);
    return { ok: true };
  });

  // Загрузить ответы в дерево — одно действие в журнале.
  app.post('/api/surveys/:id/load', { preHandler: need('editor') }, async (req) => {
    const copied = [];
    try {
      return await tx(async (db) => {
        db.copied = copied;
        const s = (await db.q(`select s.*, ${UNDONE} as undone from surveys s where s.id = $1 for update`, [req.params.id]))[0];
        if (!s) throw new HttpError(404, 'Анкета не найдена');
        const status = surveyStatus(s);
        if (status === 'loaded') throw new HttpError(409, 'Эта анкета уже загружена в дерево');
        if (status !== 'submitted') throw new HttpError(409, 'Загрузить можно только отправленную анкету');
        const files = await db.q('select * from survey_files where survey_id = $1 order by created_at, id', [s.id]);
        const res = await loadSurvey(db, req.user.id, s, req.body || {}, files);
        const first = (await db.q('select min(id) as id from changes where op = $1', [db.op]))[0].id;
        return { ...res, change: first };
      });
    } catch (err) {
      for (const id of copied) {
        await fsp.rm(mediaPath(id), { force: true });
        await fsp.rm(mediaPath(id, true), { force: true });
      }
      throw err;
    }
  });
}
