// Фото и документы. Телефон присылает файлы по одному (так виден ход загрузки и плохая связь не губит всё разом),
// а несколько файлов, выбранных вместе, становятся одним действием в журнале: со второго файла телефон
// передаёт batch — номер действия из ответа на первый, — и откат убирает их все.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { config } from '../config.js';
import { logChange } from '../changes.js';
import { HttpError, alive } from '../tree.js';
import { snapshot, liveMedia, setMain, deleteMedia, tag, untag, updateMedia } from '../album.js';
import { isGuest, guestMedia } from '../privacy.js';

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const MIME = { photo: IMAGES, doc: [...IMAGES, 'application/pdf'] };
export const MAX_FILE = 20 * 1024 * 1024; // крупный PDF; nginx пропускает до 25 МБ (deploy/nginx/drevo.conf)
export const mediaPath = (id, thumb = false) => path.join(config.dataDir, 'media', thumb ? `${id}.thumb` : id);

const text = (v, n) => String(v ?? '').trim().slice(0, n);

const LIST = `select m.id, m.kind, m.mime, m.name, m.caption, m.date, m.thumb, m.created_at,
    array(select mp.person_id from media_persons mp join persons p on p.id = mp.person_id
          where mp.media_id = m.id and p.deleted_at is null order by mp.person_id) as persons
  from media m`;

// Файл гостю не отдаётся: на нём живой человек или его нет в альбоме.
async function guestDenied(req, id) {
  return isGuest(req.user) && !(await guestMedia([id])).has(id);
}

export default async function mediaRoutes(app) {
  await fsp.mkdir(path.join(config.dataDir, 'media'), { recursive: true });

  app.get('/api/persons/:id/media', { preHandler: need('viewer') }, async (req) => {
    const rows = await q(`${LIST} join media_persons t on t.media_id = m.id and t.person_id = $1
      where m.deleted_at is null order by m.created_at, m.id`, [req.params.id]);
    if (!isGuest(req.user)) return rows;
    const ok = await guestMedia(rows.map((r) => r.id));
    return rows.filter((r) => ok.has(r.id));
  });

  // Один файл (и его уменьшенная копия thumb для сетки). Поля до файла: kind — photo или doc, batch, caption, date.
  app.post('/api/persons/:id/media', { preHandler: need('editor') }, async (req) => {
    if (!(await alive({ q }, req.params.id))) throw new HttpError(404, 'Человек не найден');
    const id = crypto.randomUUID();
    const fields = {};
    let file = null;
    let thumb = false;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') fields[part.fieldname] = part.value;
        else if (part.fieldname === 'file' && !file) {
          file = { mime: part.mimetype, name: text(part.filename, 200) };
          await pipeline(part.file, fs.createWriteStream(mediaPath(id)));
        } else if (part.fieldname === 'thumb' && file && part.mimetype === 'image/jpeg') {
          await pipeline(part.file, fs.createWriteStream(mediaPath(id, true)));
          thumb = true;
        } else part.file.resume();
      }
      const kind = fields.kind === 'doc' ? 'doc' : 'photo';
      if (!file) throw new HttpError(400, 'Файл не получен');
      if (!MIME[kind].includes(file.mime)) {
        throw new HttpError(400, kind === 'doc' ? 'Нужен снимок (JPEG, PNG, WebP) или PDF' : 'Нужна фотография JPEG, PNG или WebP');
      }
      const { size } = await fsp.stat(mediaPath(id));
      return await tx(async (db) => {
        // Продолжение того же выбора файлов — в то же действие, пока его не отменили.
        const batch = /^[0-9a-f-]{36}$/.test(fields.batch || '') && (await db.q(
          `select 1 from changes where op = $1 and user_id = $2 and entity = 'media' and action = 'add'
           and reverted_by is null and at > now() - interval '1 hour' limit 1`, [fields.batch, req.user.id]))[0];
        if (batch) db.op = fields.batch;
        const m = (await db.q(
          `insert into media (id, kind, mime, bytes, name, caption, date, thumb, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
          [id, kind, file.mime, size, file.name, text(fields.caption, 500), text(fields.date, 100), thumb, req.user.id],
        ))[0];
        await db.q('insert into media_persons (media_id, person_id) values ($1, $2)', [id, req.params.id]);
        await logChange(db, req.user.id, 'media', id, 'add', null, snapshot(m), [req.params.id]);
        // Первое фото человека сразу становится главным.
        const p = (await db.q('select photo_id from persons where id = $1 for update', [req.params.id]))[0];
        if (!p.photo_id && kind === 'photo') await setMain(db, req.user.id, req.params.id, id);
        return { ...m, persons: [req.params.id], batch: db.op };
      });
    } catch (err) {
      await fsp.rm(mediaPath(id), { force: true });
      await fsp.rm(mediaPath(id, true), { force: true });
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, `Файл слишком большой: не больше ${MAX_FILE / 1024 / 1024} МБ`);
      if (err.code === 'FST_FILES_LIMIT') throw new HttpError(413, 'Файлы отправляются по одному');
      throw err;
    }
  });

  app.patch('/api/media/:id', { preHandler: need('editor') }, async (req) => {
    const data = {};
    if (req.body?.caption !== undefined) data.caption = text(req.body.caption, 500);
    if (req.body?.date !== undefined) data.date = text(req.body.date, 100);
    await tx((db) => updateMedia(db, req.user.id, req.params.id, data));
    return (await q(`${LIST} where m.id = $1`, [req.params.id]))[0];
  });

  app.delete('/api/media/:id', { preHandler: need('editor') }, async (req) => {
    const changeId = await tx((db) => deleteMedia(db, req.user.id, req.params.id));
    return { ok: true, changeId };
  });

  // Отметить человека на файле или снять отметку.
  app.put('/api/media/:id/persons/:personId', { preHandler: need('editor') }, async (req) => {
    await tx(async (db) => {
      if (!(await alive(db, req.params.personId))) throw new HttpError(404, 'Человек не найден');
      await tag(db, req.user.id, req.params.id, req.params.personId);
    });
    return { ok: true };
  });

  app.delete('/api/media/:id/persons/:personId', { preHandler: need('editor') }, async (req) => {
    await tx((db) => untag(db, req.user.id, req.params.id, req.params.personId));
    return { ok: true };
  });

  // Главное фото — из альбома человека.
  app.put('/api/persons/:id/photo', { preHandler: need('editor') }, async (req) => {
    const mediaId = String(req.body?.media_id || '');
    await tx(async (db) => {
      if (!(await alive(db, req.params.id))) throw new HttpError(404, 'Человек не найден');
      const m = await liveMedia(db, mediaId);
      if (!IMAGES.includes(m.mime)) throw new HttpError(400, 'Главным может быть только снимок');
      if (!(await db.q('select 1 from media_persons where media_id = $1 and person_id = $2', [m.id, req.params.id]))[0]) {
        throw new HttpError(400, 'Этого фото нет в альбоме человека');
      }
      await setMain(db, req.user.id, req.params.id, m.id);
    });
    return { photo_id: mediaId };
  });

  async function send(req, reply, thumb) {
    const m = (await q('select id, mime, thumb from media where id = $1', [req.params.id]))[0];
    if (!m || (await guestDenied(req, m.id))) return reply.code(404).send({ error: 'Файл не найден' });
    // Миниатюры нет (старое фото) — отдаём сам снимок.
    const small = thumb && m.thumb;
    if (thumb && !small && !IMAGES.includes(m.mime)) return reply.code(404).send({ error: 'Файл не найден' });
    reply.header('Content-Type', small ? 'image/jpeg' : m.mime).header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(fs.createReadStream(mediaPath(m.id, small)));
  }
  app.get('/api/media/:id', { preHandler: need('viewer') }, (req, reply) => send(req, reply, false));
  app.get('/api/media/:id/thumb', { preHandler: need('viewer') }, (req, reply) => send(req, reply, true));
}

