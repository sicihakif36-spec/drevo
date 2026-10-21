// Лента «что нового»: последние действия, которые остались в силе. Новое — действия других людей
// после прошлого визита. Позже сюда же добавятся обсуждения (каждый элемент ленты — со своим kind).
import { q } from '../db.js';
import { need } from '../auth.js';
import { listOps } from '../changes.js';
import { isGuest, trimEntry } from '../privacy.js';

export default async function feedRoutes(app) {
  app.get('/api/feed', { preHandler: need('viewer') }, async (req) => {
    const [ops, [u]] = await Promise.all([
      listOps({ limit: 50, standing: true }),
      q('select feed_seen_at, now() as now from users where id = $1', [req.user.id]),
    ]);
    const guest = isGuest(req.user);
    const items = ops.map(({ user_id: who, reverted, ...op }) => ({
      kind: 'op',
      ...op,
      entries: guest ? op.entries.map(trimEntry) : op.entries,
      fresh: who !== req.user.id && op.at > u.feed_seen_at,
    }));
    return { items, now: u.now };
  });

  // Лента просмотрена до момента at — того, что вернул GET /api/feed: правки, появившиеся после, останутся новыми.
  app.post('/api/feed/seen', { preHandler: need('viewer') }, async (req) => {
    const at = new Date(req.body?.at);
    await q('update users set feed_seen_at = greatest(feed_seen_at, least($1::timestamptz, now())) where id = $2',
      [Number.isNaN(at.getTime()) ? new Date() : at, req.user.id]);
    return { ok: true };
  });
}
