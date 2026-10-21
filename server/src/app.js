import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { config } from './config.js';
import { authPlugin } from './auth.js';
import { pool } from './db.js';
import personRoutes from './routes/persons.js';
import userRoutes from './routes/users.js';
import mediaRoutes, { MAX_FILE } from './routes/media.js';
import printRoutes from './routes/print.js';
import exportRoutes from './routes/export.js';
import feedRoutes from './routes/feed.js';
import commentRoutes from './routes/comments.js';
import storyRoutes from './routes/stories.js';
import sourceRoutes from './routes/sources.js';
import { eventsPlugin } from './events.js';
import { pushPlugin } from './push.js';

export async function buildApp(opts = {}) {
  const app = Fastify({ logger: opts.logger ?? { level: 'info' }, trustProxy: true, bodyLimit: 256 * 1024 });
  // До регистрации маршрутов: плагины берут обработчик ошибок, действующий в момент их подключения.
  app.setErrorHandler((err, req, reply) => {
    if (err.code === '22P02') return reply.code(400).send({ error: 'Неверный идентификатор' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Ошибка на сервере' });
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_FILE, files: 2 } });
  authPlugin(app);
  // До маршрутов: обсуждение сообщает о новых комментариях через app.push.
  pushPlugin(app, opts.push);
  await app.register(personRoutes);
  await app.register(userRoutes);
  await app.register(mediaRoutes);
  await app.register(printRoutes);
  await app.register(exportRoutes);
  await app.register(feedRoutes);
  await app.register(commentRoutes);
  await app.register(storyRoutes);
  await app.register(sourceRoutes);
  eventsPlugin(app, { ping: opts.eventsPing });

  app.get('/api/health', async () => {
    await pool.query('select 1');
    return { ok: true };
  });

  if (fs.existsSync(config.webDir)) {
    await app.register(staticFiles, {
      root: config.webDir,
      // res здесь — reply Fastify, а не http.ServerResponse
      setHeaders(res, file) {
        if (/\/assets\//.test(file)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Не найдено' }) : reply.sendFile('index.html')));
  }
  return app;
}
