// «Спросить у родных»: вопрос о человеке конкретному родственнику (src/asks.js, shared/asks.js).
// Спрашивают владелец и участники. Кому — тому, кто пользуется приложением (родственник, участник, владелец; гостю — нельзя:
// ему не видны данные живых), или тому, кто не пользуется: ему ссылка на страничку без входа, как у анкеты.
// Вопросы и ответы гостям не отдаются нигде: все маршруты — от родственника и выше. Ссылочные вопросы (там подпись «для кого»)
// видят только владелец и участники, вопросы в приложении — ещё и родственники, как обсуждение у карточки.
// Публичные маршруты /api/ask… — только по токену из заголовка x-ask (не в адресе: адреса попадают в журналы сервера),
// с ограничением частоты; они не открывают сессию и отдают только сам вопрос, имя спросившего и о ком он.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { q, tx } from '../db.js';
import { need, hash, newToken } from '../auth.js';
import { config } from '../config.js';
import { HttpError } from '../tree.js';
import { checkSpace } from '../tenants.js';
import { checkRate, badLink } from '../limit.js';
import { toMp3 } from '../audio.js';
import { MAX_FILE, mediaPath, audioMime, parseRange } from './media.js';
import { askPath, undone, saveStory, saveNote } from '../asks.js';
import { ASK_MAX, ANSWER_MAX, ASK_PHOTOS, ASK_DAYS, ASK_FIELDS, askStatus } from '../../../shared/asks.js';
import { fullName } from '../../../shared/names.js';

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const text = (v, n) => String(v ?? '').trim().slice(0, n);
const editor = (u) => ['owner', 'editor'].includes(u?.role);
const linkOf = (token) => `${config.publicUrl}/#/ask/${token}`;

const LIST = `select a.id, a.person_id, a.about, a.question, a.field, a.research_id, a.created_by, cu.name as from_name, a.created_at,
    a.to_user, coalesce(tu.name, a.to_name) as to_name, (select sex from persons where id = tu.person_id) as to_sex, a.token_hash is not null as link, a.expires_at, a.opened_at, a.reminded_at,
    a.answer, a.answered_at, a.closed_at, a.revoked_at, a.story_op, a.note_op,
    ${undone('story_op')} as story_undone, ${undone('note_op')} as note_undone,
    (select c.entity_id from changes c where c.op = a.story_op and c.entity = 'story' limit 1) as story_id,
    (select min(c.id) from changes c where c.op = a.story_op) as story_change,
    (select x.title from research_questions x where x.id = a.research_id and x.deleted_at is null) as research_title
  from asks a join persons p on p.id = a.person_id left join users cu on cu.id = a.created_by left join users tu on tu.id = a.to_user
  where a.deleted_at is null and p.deleted_at is null`;

const files = (ids) => (ids.length
  ? q('select id, ask_id, kind, thumb, duration from ask_files where ask_id = any($1::uuid[]) order by created_at, id', [ids])
  : []);

// Строки для телефона: состояние и файлы ответа (пока ответа нет — файлы видит только тот, кто отвечает).
async function rows(list, user) {
  const all = await files(list.filter((a) => a.answered_at || a.to_user === user?.id).map((a) => a.id));
  return list.map(({ story_op: s, note_op: n, story_undone: su, note_undone: nu, ...a }) => {
    const out = { ...a, status: askStatus(a), story: Boolean(s) && !su, note: Boolean(n) && !nu,
      files: all.filter((f) => f.ask_id === a.id).map(({ ask_id: _, ...f }) => f) };
    // Исследование видят только владелец и участники.
    if (!editor(user)) for (const k of ['research_id', 'research_title', 'note']) delete out[k];
    return out;
  });
}

// Вопрос, который этот человек может видеть: владелец и участники — любой, остальные — вопросы в приложении (как обсуждение).
async function visibleAsk(req, id) {
  const a = (await q(`${LIST} and a.id = $1`, [id]))[0];
  if (!a || !(editor(req.user) || a.to_user === req.user.id || (a.to_user && !a.revoked_at))) throw new HttpError(404, 'Вопрос не найден');
  return a;
}

// Можно ли ещё отвечать.
function writable(a) {
  const st = askStatus(a);
  if (st === 'answered' || st === 'closed') throw new HttpError(409, 'Ответ уже отправлен. Спасибо!');
  if (st === 'revoked') throw new HttpError(410, 'Этот вопрос отозвали.');
  if (st === 'expired') throw new HttpError(410, 'Срок ссылки истёк. Попросите новую у того, кто её прислал.');
}

// Вопрос по токену ссылки из заголовка.
async function byToken(req) {
  checkRate('ask', req.ip);
  const token = String(req.headers['x-ask'] || '');
  const a = token.length >= 20 && token.length <= 100
    ? (await q('select a.*, u.name as from_name from asks a left join users u on u.id = a.created_by where a.token_hash = $1', [hash(token)]))[0]
    : null;
  if (!a || a.deleted_at) {
    badLink('ask', req.ip);
    throw new HttpError(404, 'Ссылка недействительна. Попросите новую у того, кто её прислал.');
  }
  if (a.revoked_at) throw new HttpError(410, 'Этот вопрос отозвали. Если нужно, попросите новую ссылку.');
  if (!a.answered_at && a.expires_at < new Date()) throw new HttpError(410, 'Срок ссылки истёк. Попросите новую у того, кто её прислал.');
  return a;
}

// Вопрос, на который отвечает вошедший: только адресат.
async function mine(req) {
  const a = (await q('select a.* from asks a join persons p on p.id = a.person_id where a.id = $1 and a.deleted_at is null and p.deleted_at is null', [req.params.id]))[0];
  if (!a || a.to_user !== req.user.id) throw new HttpError(404, 'Вопрос не найден');
  return a;
}

// Фото (с уменьшенной копией thumb от телефона) или запись голоса — по одному файлу за раз.
async function receive(req, a) {
  writable(a);
  await checkSpace();
  const id = crypto.randomUUID();
  const upload = `${askPath(id)}.upload`;
  let file = null;
  let thumb = false;
  try {
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      if (part.fieldname === 'file' && !file) {
        const name = text(part.filename, 200);
        if (IMAGES.includes(part.mimetype)) {
          file = { kind: 'photo', mime: part.mimetype, name };
          await pipeline(part.file, fs.createWriteStream(askPath(id)));
        } else if (audioMime(part.mimetype, part.filename || '')) {
          file = { kind: 'audio', mime: 'audio/mpeg', name: `${name.replace(/\.[a-z0-9]{1,5}$/i, '') || 'golos'}.mp3` };
          await pipeline(part.file, fs.createWriteStream(upload));
        } else {
          file = { kind: null };
          part.file.resume();
        }
      } else if (part.fieldname === 'thumb' && file?.kind === 'photo' && part.mimetype === 'image/jpeg') {
        await pipeline(part.file, fs.createWriteStream(askPath(id, true)));
        thumb = true;
      } else part.file.resume();
    }
    if (!file) throw new HttpError(400, 'Файл не получен');
    if (!file.kind) throw new HttpError(400, 'Нужна фотография (JPEG, PNG, WebP) или запись голоса');
    let duration = null;
    if (file.kind === 'audio') {
      if (!(await fsp.stat(upload)).size) throw new HttpError(400, 'Запись пустая. Попробуйте записать ещё раз.');
      duration = await toMp3(upload, askPath(id));
    }
    const { size } = await fsp.stat(askPath(id));
    if (!size) throw new HttpError(400, 'Файл пустой');
    // Сколько можно: фото — ASK_PHOTOS, запись голоса — одна. Проверка в том же запросе: файлы могли прийти одновременно.
    const max = file.kind === 'photo' ? ASK_PHOTOS : 1;
    const f = (await q(
      `insert into ask_files (id, ask_id, kind, mime, bytes, name, thumb, duration)
       select $1, $2, $3, $4, $5, $6, $7, $8 where (select count(*) from ask_files where ask_id = $2 and kind = $3) < $9
       returning id, kind, thumb, duration`,
      [id, a.id, file.kind, file.mime, size, file.name, thumb, duration, max],
    ))[0];
    if (!f) throw new HttpError(400, file.kind === 'photo' ? `Можно приложить не больше ${ASK_PHOTOS} фото` : 'Запись голоса уже есть. Уберите её, чтобы записать заново.');
    return f;
  } catch (err) {
    await fsp.rm(askPath(id), { force: true });
    await fsp.rm(askPath(id, true), { force: true });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, `Файл слишком большой: не больше ${MAX_FILE / 1024 / 1024} МБ`);
    if (err.code === 'FST_FILES_LIMIT') throw new HttpError(413, 'Файлы отправляются по одному');
    throw err;
  } finally {
    await fsp.rm(upload, { force: true });
  }
}

async function dropFile(a, fid) {
  writable(a);
  const f = (await q('delete from ask_files where id = $1 and ask_id = $2 returning id', [fid, a.id]))[0];
  if (!f) throw new HttpError(404, 'Файл не найден');
  await fsp.rm(askPath(f.id), { force: true });
  await fsp.rm(askPath(f.id, true), { force: true });
  return { ok: true };
}

// Файл ответа: фото, его уменьшенная копия или запись голоса (кусками по Range — иначе Safari на iPhone не играет).
async function sendFile(req, reply, askId, thumb) {
  const f = (await q('select * from ask_files where id = $1 and ask_id = $2', [req.params.fid, askId]))[0];
  if (!f) return reply.code(404).send({ error: 'Файл не найден' });
  const small = thumb && f.thumb;
  const file = askPath(f.id, small);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) return reply.code(404).send({ error: 'Файл не найден' });
  const range = parseRange(req.headers.range, stat.size);
  if (range === false) return reply.code(416).header('Content-Range', `bytes */${stat.size}`).send({ error: 'Такого куска в файле нет' });
  reply.header('Content-Type', small ? 'image/jpeg' : f.mime).header('Cache-Control', 'private, no-store').header('Accept-Ranges', 'bytes');
  if (!range) return reply.header('Content-Length', stat.size).send(fs.createReadStream(file));
  return reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`)
    .header('Content-Length', range.end - range.start + 1).send(fs.createReadStream(file, range));
}

function answerText(body) {
  const t = String(body?.answer ?? '').trim();
  if (t.length > ANSWER_MAX) throw new HttpError(400, `Слишком длинно: не больше ${ANSWER_MAX} знаков. Остальное можно записать голосом.`);
  return t;
}

// Ответ: текст и (или) приложенные файлы. Второй раз — нельзя.
async function submit(app, a, body, userId) {
  writable(a);
  const answer = answerText(body);
  if (!answer && !(await q('select 1 from ask_files where ask_id = $1 limit 1', [a.id])).length) throw new HttpError(400, 'Напишите ответ');
  const done = await q(
    `update asks set answer = $2, answered_at = now(), answered_by = $3
     where id = $1 and answered_at is null and revoked_at is null and deleted_at is null returning id`,
    [a.id, answer, userId],
  );
  if (!done.length) throw new HttpError(409, 'Ответ уже отправлен. Спасибо!');
  app.push.answer(a.id);
  return { ok: true };
}

// Вопрос для действия владельца или участника; who — кто ответил (для подписи истории и записи поиска).
async function forEditor(db, id) {
  const a = (await db.q(
    `select a.*, coalesce(u.name, a.to_name) as who, ${undone('story_op')} as story_undone, ${undone('note_op')} as note_undone
     from asks a left join users u on u.id = a.to_user where a.id = $1 and a.deleted_at is null for update of a`, [id],
  ))[0];
  if (!a) throw new HttpError(404, 'Вопрос не найден');
  return a;
}

export default async function askRoutes(app) {
  // ---------- По ссылке, без входа ----------

  app.get('/api/ask', async (req) => {
    const a = await byToken(req);
    if (!a.opened_at) await q('update asks set opened_at = now() where id = $1', [a.id]);
    // Только сам вопрос, имя спросившего и о ком он — ничего из дерева. Подпись «для кого» — для спросившего, её не показываем.
    return {
      from: a.from_name || '',
      about: a.about,
      question: a.question,
      answered: Boolean(a.answered_at),
      answer: a.answer || '',
      files: (await files([a.id])).map(({ ask_id: _, ...f }) => f),
      expires_at: a.expires_at,
    };
  });
  app.post('/api/ask/files', async (req) => receive(req, await byToken(req)));
  app.delete('/api/ask/files/:fid', async (req) => dropFile(await byToken(req), req.params.fid));
  app.get('/api/ask/files/:fid', async (req, reply) => sendFile(req, reply, (await byToken(req)).id, req.query.full === undefined));
  app.post('/api/ask/answer', async (req) => submit(app, await byToken(req), req.body, null));

  // ---------- Для того, кого спросили в приложении ----------

  // «Вас спросили»: ещё без ответа.
  app.get('/api/asks/mine', { preHandler: need('relative') }, async (req) => rows(await q(
    `${LIST} and a.to_user = $1 and a.answered_at is null and a.revoked_at is null and a.closed_at is null order by a.created_at desc`,
    [req.user.id]), req.user));
  app.post('/api/asks/:id/files', { preHandler: need('relative') }, async (req) => receive(req, await mine(req)));
  app.delete('/api/asks/:id/files/:fid', { preHandler: need('relative') }, async (req) => dropFile(await mine(req), req.params.fid));
  app.post('/api/asks/:id/answer', { preHandler: need('relative') }, async (req) => submit(app, await mine(req), req.body, req.user.id));

  // ---------- Обсуждение у карточки и сам вопрос ----------

  // Вопросы в приложении о человеке — в обсуждение его карточки. Ссылочные — только в «Вопросах родным».
  app.get('/api/persons/:id/asks', { preHandler: need('relative') }, async (req) => rows(await q(
    `${LIST} and a.person_id = $1 and a.to_user is not null and a.revoked_at is null order by a.created_at`, [req.params.id]), req.user));

  app.get('/api/asks/:id', { preHandler: need('relative') }, async (req) => (await rows([await visibleAsk(req, req.params.id)], req.user))[0]);

  app.get('/api/asks/:id/files/:fid', { preHandler: need('relative') }, async (req, reply) => {
    const a = await visibleAsk(req, req.params.id);
    // До ответа файлы видит только тот, кто отвечает.
    if (!a.answered_at && a.to_user !== req.user.id) return reply.code(404).send({ error: 'Файл не найден' });
    return sendFile(req, reply, a.id, req.query.full === undefined);
  });

  // ---------- Для владельца и участников ----------

  // Кого можно спросить в приложении: все, кроме гостей и самого себя.
  app.get('/api/asks/people', { preHandler: need('editor') }, async (req) => q(
    `select id, name, person_id, role from users where not disabled and role <> 'viewer' and id <> $1 order by name`, [req.user.id]));

  // «Ещё → Вопросы родным»: все вопросы, новые сверху.
  app.get('/api/asks', { preHandler: need('editor') }, async (req) => rows(await q(`${LIST} order by a.created_at desc limit 300`), req.user));

  app.post('/api/asks', { preHandler: need('editor') }, async (req) => {
    const b = req.body || {};
    const question = text(b.question, ASK_MAX + 1);
    if (!question) throw new HttpError(400, 'Напишите вопрос');
    if (question.length > ASK_MAX) throw new HttpError(400, `Слишком длинный вопрос: не больше ${ASK_MAX} знаков`);
    const p = (await q('select id, surname, given, patronymic from persons where id = $1 and deleted_at is null', [String(b.person_id || '')]))[0];
    if (!p) throw new HttpError(404, 'Человек не найден');
    const field = ASK_FIELDS.includes(b.field) ? b.field : '';
    let research = null;
    if (b.research_id) {
      research = (await q('select id from research_questions where id = $1 and person_id = $2 and deleted_at is null', [String(b.research_id), p.id]))[0];
      if (!research) throw new HttpError(404, 'Вопрос исследования не найден');
    }
    const cols = { person_id: p.id, about: fullName(p), question, field, research_id: research?.id || null, created_by: req.user.id };
    let token = null;
    if (b.to_user) {
      if (b.to_user === req.user.id) throw new HttpError(400, 'Себя спросить нельзя');
      const u = (await q('select id, role, disabled from users where id = $1', [String(b.to_user)]))[0];
      if (!u || u.disabled) throw new HttpError(404, 'Этого родственника нет среди тех, кто пользуется приложением');
      // Гостю не видны данные живых — и вопросы о них ему не задают.
      if (u.role === 'viewer') throw new HttpError(400, 'Гостя спросить нельзя: он видит только имена. Отправьте ему ссылку или сделайте родственником.');
      cols.to_user = u.id;
    } else {
      cols.to_name = text(b.to_name, 80);
      if (!cols.to_name) throw new HttpError(400, 'Напишите, кого спрашиваете');
      token = newToken();
      cols.token_hash = hash(token);
    }
    const keys = Object.keys(cols);
    const a = (await q(
      `insert into asks (${keys.join(', ')}${token ? ', expires_at' : ''})
       values (${keys.map((_, i) => `$${i + 1}`).join(', ')}${token ? `, now() + make_interval(days => ${ASK_DAYS})` : ''}) returning id`,
      keys.map((k) => cols[k]),
    ))[0];
    if (cols.to_user) app.push.ask(a.id);
    const out = (await rows([(await q(`${LIST} and a.id = $1`, [a.id]))[0]], req.user))[0];
    return token ? { ...out, token, url: linkOf(token) } : out;
  });

  // «Напомнить»: адресату в приложении — ещё одно уведомление (не чаще раза в час),
  // по ссылке — новая ссылка взамен потерянной (в базе только хеш, старую показать нельзя): старая перестаёт работать, срок — заново.
  app.post('/api/asks/:id/remind', { preHandler: need('editor') }, async (req) => {
    const a = (await q('select * from asks where id = $1 and deleted_at is null', [req.params.id]))[0];
    if (!a) throw new HttpError(404, 'Вопрос не найден');
    const st = askStatus(a);
    if (!['waiting', 'expired'].includes(st)) throw new HttpError(409, st === 'revoked' ? 'Вопрос отозван' : 'На вопрос уже ответили');
    if (a.to_user) {
      const ok = await q(`update asks set reminded_at = now() where id = $1
        and coalesce(reminded_at, created_at) < now() - interval '1 hour' returning id`, [a.id]);
      if (!ok.length) throw new HttpError(409, 'Уже напомнили недавно. Подождите хотя бы час.');
      app.push.ask(a.id, `${a.id}:${Date.now()}`);
      return { ok: true };
    }
    const token = newToken();
    await q(`update asks set token_hash = $2, expires_at = now() + make_interval(days => ${ASK_DAYS}), reminded_at = now() where id = $1`,
      [a.id, hash(token)]);
    return { ok: true, token, url: linkOf(token) };
  });

  // «Отозвать»: адресат больше не видит вопроса, ссылка перестаёт работать. На отвеченный — незачем.
  app.post('/api/asks/:id/revoke', { preHandler: need('editor') }, async (req) => {
    const a = (await q('select * from asks where id = $1 and deleted_at is null', [req.params.id]))[0];
    if (!a) throw new HttpError(404, 'Вопрос не найден');
    if (a.answered_at) throw new HttpError(409, 'На вопрос уже ответили. Его можно закрыть.');
    await q('update asks set revoked_at = coalesce(revoked_at, now()) where id = $1', [a.id]);
    return { ok: true };
  });

  // «Закрыть вопрос»: ответ получен и разобран.
  app.post('/api/asks/:id/close', { preHandler: need('editor') }, async (req) => {
    const a = (await q('select * from asks where id = $1 and deleted_at is null', [req.params.id]))[0];
    if (!a) throw new HttpError(404, 'Вопрос не найден');
    if (!a.answered_at) throw new HttpError(409, 'Ответа ещё нет. Если вопрос больше не нужен — отзовите его.');
    await q('update asks set closed_at = coalesce(closed_at, now()) where id = $1', [a.id]);
    return { ok: true };
  });

  // Удалить — мягко: вопрос пропадает из списков и обсуждения, ссылка перестаёт работать; в базе он остаётся.
  app.delete('/api/asks/:id', { preHandler: need('editor') }, async (req) => {
    const a = (await q('update asks set deleted_at = now() where id = $1 and deleted_at is null returning id', [req.params.id]))[0];
    if (!a) throw new HttpError(404, 'Вопрос не найден');
    return { ok: true };
  });

  // «Сохранить как историю» — одно действие в журнале: история (с записью голоса) и фото в альбом.
  app.post('/api/asks/:id/story', { preHandler: need('editor') }, async (req) => {
    const copied = [];
    try {
      return await tx(async (db) => {
        db.copied = copied;
        const a = await forEditor(db, req.params.id);
        if (!a.answered_at) throw new HttpError(409, 'Ответа ещё нет');
        if (a.story_op && !a.story_undone) throw new HttpError(409, 'Ответ уже сохранён как история');
        const list = await db.q('select * from ask_files where ask_id = $1 order by created_at, id', [a.id]);
        const story = await saveStory(db, req.user.id, a, list);
        const change = (await db.q('select min(id) as id from changes where op = $1', [db.op]))[0].id;
        return { story_id: story?.id || null, change };
      });
    } catch (err) {
      for (const id of copied) {
        await fsp.rm(mediaPath(id), { force: true });
        await fsp.rm(mediaPath(id, true), { force: true });
      }
      throw err;
    }
  });

  // «Записать в журнал поиска» — запись к вопросу исследования, из которого спрашивали.
  app.post('/api/asks/:id/research', { preHandler: need('editor') }, async (req) => tx(async (db) => {
    const a = await forEditor(db, req.params.id);
    if (!a.answered_at) throw new HttpError(409, 'Ответа ещё нет');
    if (a.note_op && !a.note_undone) throw new HttpError(409, 'Ответ уже записан в журнал поиска');
    const n = await saveNote(db, req.user.id, a);
    return { note_id: n.id, research_id: a.research_id };
  }));
}
