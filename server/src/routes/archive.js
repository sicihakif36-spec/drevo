// Полный архив «Скачать всё» (src/archive.js) — только владельцу. Сначала телефон спрашивает, сколько он весит,
// потом скачивает. В журнал правок не пишется (это не правка дерева), в журнал сервера — кто и когда скачал.
import { PassThrough } from 'node:stream';
import { need } from '../auth.js';
import { archivePlan, countsText, planSize, writeArchive } from '../archive.js';

export default async function archiveRoutes(app) {
  app.get('/api/archive', { preHandler: need('owner') }, async (req) => {
    const plan = await archivePlan(req.user);
    return { ...plan.counts, files: plan.files, bytes: planSize(plan), summary: countsText(plan.counts) };
  });

  app.get('/api/archive.zip', { preHandler: need('owner') }, async (req, reply) => {
    const plan = await archivePlan(req.user);
    const out = new PassThrough();
    const started = Date.now();
    const who = { user: req.user.id, name: req.user.name };
    let size = 0;
    const abort = writeArchive(plan, out, {
      onSize: (n) => { size = n; },
      onError: (err) => req.log.error({ err, ...who }, 'полный архив: ошибка при сборке'),
    });
    const seconds = () => Math.round((Date.now() - started) / 1000);
    let done = false;
    reply.raw.once('finish', () => {
      done = true;
      req.log.info({ ...who, bytes: size, seconds: seconds() }, 'полный архив скачан');
    });
    reply.raw.once('close', () => {
      if (done) return;
      abort();
      req.log.info({ ...who, bytes: size, seconds: seconds() }, 'полный архив: скачивание прервано');
    });
    req.log.info({ ...who, ...plan.counts, bytes: size }, 'полный архив: начато скачивание');
    const date = plan.stamp.toISOString().slice(0, 10);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="drevo-${date}.zip"`);
    if (size > 0) reply.header('Content-Length', size);
    reply.header('Cache-Control', 'no-store');
    // nginx не копит ответ у себя, а сразу передаёт дальше (deploy/nginx/drevo.conf).
    reply.header('X-Accel-Buffering', 'no');
    return reply.send(out);
  });
}
