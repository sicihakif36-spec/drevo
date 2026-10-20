import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { q } from '../db.js';
import { need } from '../auth.js';
import { config } from '../config.js';
import { logChange } from '../changes.js';

const MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const mediaPath = (id) => path.join(config.dataDir, 'media', id);

export default async function mediaRoutes(app) {
  await fsp.mkdir(path.join(config.dataDir, 'media'), { recursive: true });

  app.post('/api/persons/:id/photo', { preHandler: need('editor') }, async (req, reply) => {
    const person = (await q('select id, photo_id from persons where id = $1 and deleted_at is null', [req.params.id]))[0];
    if (!person) return reply.code(404).send({ error: 'Человек не найден' });
    const file = await req.file();
    if (!file || !MIME.includes(file.mimetype)) return reply.code(400).send({ error: 'Нужна фотография JPEG, PNG или WebP' });
    const id = (await q('insert into media (person_id, mime, bytes, created_by) values ($1, $2, 0, $3) returning id', [person.id, file.mimetype, req.user.id]))[0].id;
    await pipeline(file.file, fs.createWriteStream(mediaPath(id)));
    if (file.file.truncated) {
      await fsp.rm(mediaPath(id), { force: true });
      await q('delete from media where id = $1', [id]);
      return reply.code(413).send({ error: 'Фото слишком большое' });
    }
    const { size } = await fsp.stat(mediaPath(id));
    await q('update media set bytes = $1 where id = $2', [size, id]);
    await q('update persons set photo_id = $1, version = version + 1, updated_at = now() where id = $2', [id, person.id]);
    await logChange(q, req.user.id, 'person', person.id, 'photo', { photo_id: person.photo_id }, { photo_id: id });
    return { photo_id: id };
  });

  app.delete('/api/persons/:id/photo', { preHandler: need('editor') }, async (req) => {
    const p = (await q('select photo_id from persons where id = $1', [req.params.id]))[0];
    await q('update persons set photo_id = null, version = version + 1 where id = $1', [req.params.id]);
    if (p?.photo_id) await logChange(q, req.user.id, 'person', req.params.id, 'photo', { photo_id: p.photo_id }, { photo_id: null });
    return { ok: true };
  });

  app.get('/api/media/:id', { preHandler: need('viewer') }, async (req, reply) => {
    const m = (await q('select * from media where id = $1', [req.params.id]))[0];
    if (!m) return reply.code(404).send({ error: 'Файл не найден' });
    reply.header('Content-Type', m.mime).header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(fs.createReadStream(mediaPath(m.id)));
  });
}
