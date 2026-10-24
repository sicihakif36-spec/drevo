// Интервью голосом (src/interviews.js, shared/interview.js). Записывают все, кроме гостей: владелец, участники и родственники —
// родственник сядет рядом с бабушкой так же, как участник. Черновик видят тот, кто его начал, владелец и участники.
// В дерево («Сохранить в истории») сохраняют только владелец и участники: это правка дерева.
// Для того, кто далеко, — ссылка без входа (делают владелец и участники): ключ в заголовке x-interview, на сервере только хеш,
// срок, отзыв, ограничение частоты; сессии и записи во «Входы» нет. Страничка получает только вопросы интервью и свои ответы.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { q, tx } from '../db.js';
import { need, hash, newToken } from '../auth.js';
import { config } from '../config.js';
import { HttpError } from '../tree.js';
import { checkRate, badLink } from '../limit.js';
import { toMp3 } from '../audio.js';
import { MAX_FILE, mediaPath, audioMime, parseRange } from './media.js';
import { loadTreeData } from './print.js';
import { ivPath, SAVED_UNDONE, answersOf, saveInterview } from '../interviews.js';
import { TOPICS, IV_DAYS, IV_NOTE, IV_OWN, IV_PHOTOS, IV_QUESTIONS, buildQuestions, namesFor } from '../../../shared/interview.js';
import { buildIndex, fullName } from '../../../shared/names.js';

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const text = (v, n) => String(v ?? '').trim().slice(0, n);
const editor = (u) => ['owner', 'editor'].includes(u?.role);
const linkOf = (token) => `${config.publicUrl}/#/iv/${token}`;
const SAVED = 'Интервью уже сохранено в истории. Чтобы что-то изменить, отмените сохранение в «Ещё → Последние правки».';

const ROW = `select i.*, u.name as by_name, i.saved_op is not null and not ${SAVED_UNDONE} as saved,
    (select min(c.id) from changes c where c.op = i.saved_op) as saved_change,
    (select count(*)::int from (
       select f.qkey from interview_files f where f.interview_id = i.id and f.kind = 'audio'
       union select a.qkey from interview_answers a where a.interview_id = i.id and a.note <> '') x
     where not exists (select 1 from interview_answers s where s.interview_id = i.id and s.qkey = x.qkey and s.skipped)) as answered,
    (select count(*)::int from interview_answers s where s.interview_id = i.id and s.skipped) as skipped
  from interviews i join persons p on p.id = i.person_id left join users u on u.id = i.created_by
  where i.deleted_at is null and p.deleted_at is null`;

// Строка для списка: без ключа ссылки и без вопросов.
function summary(i, user) {
  const out = {
    id: i.id, person_id: i.person_id, about: i.about, created_by: i.created_by, by_name: i.by_name || '',
    created_at: i.created_at, updated_at: i.updated_at, pos: i.pos, total: i.questions.length, answered: i.answered, skipped: i.skipped,
    saved: i.saved, saved_change: i.saved ? i.saved_change : null, link: Boolean(i.token_hash),
  };
  // Подпись «для кого» и срок ссылки — только тем, кто ведёт дерево.
  if (editor(user) && i.token_hash) Object.assign(out, { to_name: i.to_name, expires_at: i.expires_at, opened_at: i.opened_at, revoked: Boolean(i.revoked_at) });
  return out;
}
const files = (list) => list.map(({ id, kind, thumb, duration }) => ({ id, kind, thumb, duration }));
const answersOut = (map) => Object.fromEntries(Object.entries(map).map(([k, a]) => [k, { skipped: a.skipped, note: a.note, files: files(a.files) }]));

async function detail(i, user) {
  const answers = (await answersOf({ q }, [i.id])).get(i.id);
  return { ...summary(i, user), topics: i.topics, questions: i.questions, answers: answersOut(answers) };
}

// Интервью, которое этот человек может видеть: начатое им самим, владельцу и участникам — любое.
async function visible(req, id = req.params.id) {
  const i = (await q(`${ROW} and i.id = $1`, [id]))[0];
  if (!i || !(editor(req.user) || i.created_by === req.user.id)) throw new HttpError(404, 'Интервью не найдено');
  return i;
}

// Интервью по ключу ссылки из заголовка.
async function byToken(req) {
  checkRate('interview', req.ip);
  const token = String(req.headers['x-interview'] || '');
  const i = token.length >= 20 && token.length <= 100 ? (await q(`${ROW} and i.token_hash = $1`, [hash(token)]))[0] : null;
  if (!i) {
    badLink('interview', req.ip);
    throw new HttpError(404, 'Ссылка недействительна. Попросите новую у того, кто её прислал.');
  }
  if (i.revoked_at) throw new HttpError(410, 'Эту ссылку отключили. Если нужно, попросите новую.');
  if (i.expires_at < new Date()) throw new HttpError(410, 'Срок ссылки истёк. Попросите новую у того, кто её прислал.');
  return { ...i, pub: true };
}

// pub — по ссылке: тому, кто рассказывал, про «Последние правки» знать незачем.
const writable = (i, pub) => { if (i.saved) throw new HttpError(409, pub ? 'Спасибо! Ваши рассказы уже сохранены в семейном дереве.' : SAVED); };

function question(i, qkey) {
  const x = i.questions.find((v) => v.key === qkey);
  if (!x) throw new HttpError(404, 'Вопрос не найден');
  return x;
}

// Изменение черновика: в транзакции, под замком строки — чтобы не разминуться с «Сохранить в истории».
async function change(iv, fn) {
  return tx(async (db) => {
    const i = (await db.q(`select i.*, i.saved_op is not null and not ${SAVED_UNDONE} as saved from interviews i
      where i.id = $1 and i.deleted_at is null for update of i`, [iv.id]))[0];
    if (!i) throw new HttpError(404, 'Интервью не найдено');
    writable(i, iv.pub);
    const out = await fn(db, i);
    await db.q('update interviews set updated_at = now() where id = $1', [i.id]);
    return out;
  });
}

// Заметка к ответу и «Пропустить». Присланные поля — только они меняются.
async function setAnswer(i, qkey, body) {
  question(i, qkey);
  const b = body || {};
  if (b.note !== undefined && String(b.note).trim().length > IV_NOTE) throw new HttpError(400, `Слишком длинная заметка: не больше ${IV_NOTE} знаков`);
  return change(i, async (db) => {
    const cur = (await db.q('select skipped, note from interview_answers where interview_id = $1 and qkey = $2', [i.id, qkey]))[0]
      || { skipped: false, note: '' };
    const note = b.note !== undefined ? text(b.note, IV_NOTE) : cur.note;
    const skipped = b.skipped !== undefined ? Boolean(b.skipped) : cur.skipped;
    await db.q(`insert into interview_answers (interview_id, qkey, skipped, note) values ($1, $2, $3, $4)
      on conflict (interview_id, qkey) do update set skipped = excluded.skipped, note = excluded.note, updated_at = now()`,
    [i.id, qkey, skipped, note]);
    return { skipped, note };
  });
}

// Где остановились: номер вопроса (равный числу вопросов — «всё пройдено»).
async function setPos(i, body) {
  const pos = Math.max(0, Math.min(i.questions.length, Math.floor(Number(body?.pos) || 0)));
  await change(i, (db) => db.q('update interviews set pos = $2 where id = $1', [i.id, pos]));
  return { pos };
}

// Свой вопрос — после вопроса номер after (по умолчанию — после того, где сейчас), или в конец.
async function addQuestion(i, body) {
  const t = text(body?.text, IV_OWN + 1);
  if (!t) throw new HttpError(400, 'Напишите вопрос');
  if (t.length > IV_OWN) throw new HttpError(400, `Слишком длинный вопрос: не больше ${IV_OWN} знаков`);
  return change(i, async (db, cur) => {
    const list = cur.questions;
    if (list.length >= IV_QUESTIONS) throw new HttpError(400, `В одном интервью — не больше ${IV_QUESTIONS} вопросов`);
    const after = body?.after === undefined ? cur.pos : Math.floor(Number(body.after));
    const at = Number.isFinite(after) ? Math.max(0, Math.min(list.length, after + 1)) : list.length;
    const x = { key: `own.${crypto.randomUUID().slice(0, 8)}`, topic: 'own', text: t };
    list.splice(at, 0, x);
    await db.q('update interviews set questions = $2 where id = $1', [i.id, JSON.stringify(list)]);
    return { question: x, index: at, questions: list };
  });
}

// Запись голоса (заменяет прежнюю — «Переписать») или фото к ответу — по одному файлу за раз.
async function receive(req, i, qkey) {
  question(i, qkey);
  writable(i, i.pub);
  const id = crypto.randomUUID();
  const upload = `${ivPath(id)}.upload`;
  let file = null;
  let thumb = false;
  let old = [];
  try {
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      if (part.fieldname === 'file' && !file) {
        const name = text(part.filename, 200);
        if (IMAGES.includes(part.mimetype)) {
          file = { kind: 'photo', mime: part.mimetype, name };
          await pipeline(part.file, fs.createWriteStream(ivPath(id)));
        } else if (audioMime(part.mimetype, part.filename || '')) {
          file = { kind: 'audio', mime: 'audio/mpeg', name: `${name.replace(/\.[a-z0-9]{1,5}$/i, '') || 'golos'}.mp3` };
          await pipeline(part.file, fs.createWriteStream(upload));
        } else {
          file = { kind: null };
          part.file.resume();
        }
      } else if (part.fieldname === 'thumb' && file?.kind === 'photo' && part.mimetype === 'image/jpeg') {
        await pipeline(part.file, fs.createWriteStream(ivPath(id, true)));
        thumb = true;
      } else part.file.resume();
    }
    if (!file) throw new HttpError(400, 'Файл не получен');
    if (!file.kind) throw new HttpError(400, 'Нужна запись голоса или фотография (JPEG, PNG, WebP)');
    let duration = null;
    if (file.kind === 'audio') {
      if (!(await fsp.stat(upload)).size) throw new HttpError(400, 'Запись пустая. Попробуйте записать ещё раз.');
      duration = await toMp3(upload, ivPath(id));
    }
    const { size } = await fsp.stat(ivPath(id));
    if (!size) throw new HttpError(400, 'Файл пустой');
    const f = await change(i, async (db) => {
      if (file.kind === 'audio') {
        old = (await db.q("delete from interview_files where interview_id = $1 and qkey = $2 and kind = 'audio' returning id", [i.id, qkey])).map((r) => r.id);
        // Записали ответ — он больше не пропущен.
        await db.q(`insert into interview_answers (interview_id, qkey) values ($1, $2)
          on conflict (interview_id, qkey) do update set skipped = false, updated_at = now()`, [i.id, qkey]);
      }
      const max = file.kind === 'photo' ? IV_PHOTOS : 1;
      const row = (await db.q(
        `insert into interview_files (id, interview_id, qkey, kind, mime, bytes, name, thumb, duration)
         select $1, $2, $3, $4, $5, $6, $7, $8, $9
         where (select count(*) from interview_files where interview_id = $2 and qkey = $3 and kind = $4) < $10
         returning id, kind, thumb, duration`,
        [id, i.id, qkey, file.kind, file.mime, size, file.name, thumb, duration, max],
      ))[0];
      if (!row) throw new HttpError(400, `К одному ответу — не больше ${IV_PHOTOS} фото`);
      return row;
    });
    for (const x of old) {
      await fsp.rm(ivPath(x), { force: true });
      await fsp.rm(ivPath(x, true), { force: true });
    }
    return f;
  } catch (err) {
    await fsp.rm(ivPath(id), { force: true });
    await fsp.rm(ivPath(id, true), { force: true });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, `Файл слишком большой: не больше ${MAX_FILE / 1024 / 1024} МБ`);
    if (err.code === 'FST_FILES_LIMIT') throw new HttpError(413, 'Файлы отправляются по одному');
    throw err;
  } finally {
    await fsp.rm(upload, { force: true });
  }
}

async function dropFile(i, fid) {
  const f = await change(i, async (db) => (await db.q('delete from interview_files where id = $1 and interview_id = $2 returning id', [fid, i.id]))[0]);
  if (!f) throw new HttpError(404, 'Файл не найден');
  await fsp.rm(ivPath(f.id), { force: true });
  await fsp.rm(ivPath(f.id, true), { force: true });
  return { ok: true };
}

// Файл ответа: фото, его уменьшенная копия или запись голоса (кусками по Range — иначе Safari на iPhone не играет).
async function sendFile(req, reply, ivId, thumb) {
  const f = (await q('select * from interview_files where id = $1 and interview_id = $2', [req.params.fid, ivId]))[0];
  if (!f) return reply.code(404).send({ error: 'Файл не найден' });
  const small = thumb && f.thumb;
  const file = ivPath(f.id, small);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) return reply.code(404).send({ error: 'Файл не найден' });
  const range = parseRange(req.headers.range, stat.size);
  if (range === false) return reply.code(416).header('Content-Range', `bytes */${stat.size}`).send({ error: 'Такого куска в файле нет' });
  reply.header('Content-Type', small ? 'image/jpeg' : f.mime).header('Cache-Control', 'private, no-store').header('Accept-Ranges', 'bytes');
  if (!range) return reply.header('Content-Length', stat.size).send(fs.createReadStream(file));
  return reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`)
    .header('Content-Length', range.end - range.start + 1).send(fs.createReadStream(file, range));
}

export default async function interviewRoutes(app) {
  await fsp.mkdir(path.join(config.dataDir, 'interview'), { recursive: true });

  // ---------- По ссылке, без входа ----------

  // Только вопросы интервью и свои ответы — ничего из дерева: ни имени того, о ком оно, ни подписи «для кого».
  app.get('/api/interview', async (req) => {
    const i = await byToken(req);
    if (!i.opened_at) await q('update interviews set opened_at = now() where id = $1', [i.id]);
    const answers = (await answersOf({ q }, [i.id])).get(i.id);
    return { from: i.by_name || '', questions: i.questions, answers: answersOut(answers), pos: i.pos, saved: i.saved, expires_at: i.expires_at };
  });
  app.patch('/api/interview', async (req) => setPos(await byToken(req), req.body));
  app.post('/api/interview/questions', async (req) => addQuestion(await byToken(req), req.body));
  app.put('/api/interview/answers/:qkey', async (req) => setAnswer(await byToken(req), req.params.qkey, req.body));
  app.post('/api/interview/answers/:qkey/files', async (req) => receive(req, await byToken(req), req.params.qkey));
  app.delete('/api/interview/files/:fid', async (req) => dropFile(await byToken(req), req.params.fid));
  app.get('/api/interview/files/:fid', async (req, reply) => sendFile(req, reply, (await byToken(req)).id, req.query.full === undefined));

  // ---------- В приложении ----------

  // Список: о человеке (?person=) или все, что мне видно. Черновики и сохранённые, новые сверху.
  app.get('/api/interviews', { preHandler: need('relative') }, async (req) => {
    const rows = await q(`${ROW} and ($1::uuid is null or i.person_id = $1) and ($2 or i.created_by = $3)
      order by i.updated_at desc limit 200`, [req.query.person ? String(req.query.person) : null, editor(req.user), req.user.id]);
    return rows.map((i) => summary(i, req.user));
  });

  app.get('/api/interviews/:id', { preHandler: need('relative') }, async (req) => detail(await visible(req), req.user));

  // Начать: о ком, темы, свои вопросы. Имена родных подставляются в вопросы сразу — как их видно в дереве сейчас.
  app.post('/api/interviews', { preHandler: need('relative') }, async (req) => {
    const b = req.body || {};
    const tree = await loadTreeData(req.user, false);
    const idx = buildIndex(tree);
    const p = idx.persons.get(String(b.person_id || ''));
    if (!p) throw new HttpError(404, 'Человек не найден');
    const topics = TOPICS.map((t) => t.key).filter((k) => Array.isArray(b.topics) && b.topics.includes(k));
    const own = (Array.isArray(b.own) ? b.own : []).map((t) => text(t, IV_OWN + 1)).filter(Boolean);
    if (own.some((t) => t.length > IV_OWN)) throw new HttpError(400, `Слишком длинный вопрос: не больше ${IV_OWN} знаков`);
    const questions = [...buildQuestions(topics, namesFor(idx, p.id)),
      ...own.map((t) => ({ key: `own.${crypto.randomUUID().slice(0, 8)}`, topic: 'own', text: t }))];
    if (!questions.length) throw new HttpError(400, 'Выберите хотя бы одну тему или напишите свой вопрос');
    if (questions.length > IV_QUESTIONS) throw new HttpError(400, `В одном интервью — не больше ${IV_QUESTIONS} вопросов`);
    const i = (await q('insert into interviews (person_id, about, topics, questions, created_by) values ($1, $2, $3, $4, $5) returning id',
      [p.id, fullName(p), topics, JSON.stringify(questions), req.user.id]))[0];
    return detail(await visible(req, i.id), req.user);
  });

  // Ответы — так же, как по ссылке.
  app.patch('/api/interviews/:id', { preHandler: need('relative') }, async (req) => setPos(await visible(req), req.body));
  app.post('/api/interviews/:id/questions', { preHandler: need('relative') }, async (req) => addQuestion(await visible(req), req.body));
  app.put('/api/interviews/:id/answers/:qkey', { preHandler: need('relative') }, async (req) => setAnswer(await visible(req), req.params.qkey, req.body));
  app.post('/api/interviews/:id/answers/:qkey/files', { preHandler: need('relative') }, async (req) => receive(req, await visible(req), req.params.qkey));
  app.delete('/api/interviews/:id/files/:fid', { preHandler: need('relative') }, async (req) => dropFile(await visible(req), req.params.fid));
  app.get('/api/interviews/:id/files/:fid', { preHandler: need('relative') }, async (req, reply) => sendFile(req, reply, (await visible(req)).id, req.query.full === undefined));

  // Удалить черновик — мягко: пропадает из списков, ссылка перестаёт работать; истории, уже сохранённые в дерево, остаются.
  app.delete('/api/interviews/:id', { preHandler: need('relative') }, async (req) => {
    const i = await visible(req);
    await q('update interviews set deleted_at = now() where id = $1', [i.id]);
    return { ok: true };
  });

  // ---------- Для владельца и участников ----------

  // Ссылка для того, кто ответит сам: новая взамен прежней (в базе только хеш — старую показать нельзя), срок — заново.
  app.post('/api/interviews/:id/link', { preHandler: need('editor') }, async (req) => {
    const i = await visible(req);
    writable(i);
    const toName = text(req.body?.to_name, 80) || i.to_name;
    const token = newToken();
    await q(`update interviews set token_hash = $2, to_name = $3, expires_at = now() + make_interval(days => ${IV_DAYS}), revoked_at = null
      where id = $1`, [i.id, hash(token), toName]);
    return { token, url: linkOf(token) };
  });

  app.post('/api/interviews/:id/revoke', { preHandler: need('editor') }, async (req) => {
    const i = await visible(req);
    await q('update interviews set revoked_at = coalesce(revoked_at, now()) where id = $1', [i.id]);
    return { ok: true };
  });

  // «Готово — сохранить в истории»: одно действие в журнале.
  app.post('/api/interviews/:id/save', { preHandler: need('editor') }, async (req) => {
    const copied = [];
    try {
      return await tx(async (db) => {
        db.copied = copied;
        const i = (await db.q(`select i.*, i.saved_op is not null and not ${SAVED_UNDONE} as saved from interviews i
          where i.id = $1 and i.deleted_at is null for update of i`, [req.params.id]))[0];
        if (!i) throw new HttpError(404, 'Интервью не найдено');
        if (i.saved) throw new HttpError(409, 'Интервью уже сохранено в истории');
        const out = await saveInterview(db, req.user.id, i);
        const ch = (await db.q('select min(id) as id from changes where op = $1', [db.op]))[0].id;
        return { ...out, change: ch };
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
