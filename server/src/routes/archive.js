// Полный архив «Скачать всё» (src/archive.js) — только владельцу. Сначала телефон спрашивает, сколько он весит,
// потом скачивает. В журнал правок не пишется (это не правка дерева), в журнал сервера — кто и когда скачал.
// Скачивание, дошедшее до конца, отмечается в archive_downloads: от него считается напоминание раз в месяц (src/push.js).
import { PassThrough } from 'node:stream';
import { q } from '../db.js';
import { need } from '../auth.js';
import { archivePlan, countsText, planSize, writeArchive, lastDownload } from '../archive.js';
import { LATER_DAYS } from '../../../shared/archive.js';

export default async function archiveRoutes(app) {
  app.get('/api/archive', { preHandler: need('owner') }, async (req) => {
    const plan = await archivePlan(req.user);
    return { ...plan.counts, files: plan.files, bytes: planSize(plan), summary: countsText(plan.counts), last: await lastDownload() };
  });

  // Когда скачивали в последний раз: окно «Скачать всё» спрашивает, пока идёт скачивание.
  app.get('/api/archive/last', { preHandler: need('owner') }, async () => ({ last: await lastDownload() }));

  // «Напомнить позже» — через неделю, и плашкой в ленте, и на телефон.
  app.post('/api/archive/later', { preHandler: need('owner') }, async (req) => {
    await q(`update users set archive_later = now() + make_interval(days => ${LATER_DAYS}) where id = $1`, [req.user.id]);
    return { ok: true };
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
      q('insert into archive_downloads (user_id, bytes) values ($1, $2)', [req.user.id, size])
        .catch((err) => req.log.error({ err, ...who }, 'полный архив: не удалось отметить скачивание'));
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
