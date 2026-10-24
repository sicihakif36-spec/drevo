// Лента «что нового»: последние действия, которые остались в силе, и комментарии вперемешку по времени.
// Новое — действия и комментарии других людей после прошлого визита. Владельцу и участникам — ещё и отправленные анкеты.
import { q } from '../db.js';
import { need } from '../auth.js';
import { listOps } from '../changes.js';
import { isGuest, trimEntry, privateIds, guestMedia } from '../privacy.js';
import { recentComments } from './comments.js';

// Новые фото действия — для миниатюр в ленте.
const newPhotos = (op) => op.entries.filter((e) => e.entity === 'media' && e.action === 'add' && e.after?.kind === 'photo').map((e) => e.entity_id);
// Какие из новых фото человек и так может видеть: ещё в альбоме, а гостю — ещё и без живых (guestMedia).
async function visiblePhotos(ops, guest) {
  const ids = ops.flatMap(newPhotos);
  if (!ids.length) return new Set();
  if (guest) return guestMedia(ids);
  return new Set((await q('select id from media where id = any($1::uuid[]) and deleted_at is null', [ids])).map((r) => r.id));
}

export default async function feedRoutes(app) {
  app.get('/api/feed', { preHandler: need('viewer') }, async (req) => {
    const guest = isGuest(req.user);
    const hidden = new Set(guest ? await privateIds() : []);
    const [ops, comments, [u], surveys] = await Promise.all([
      listOps({ limit: 50, standing: true, research: false }),
      recentComments({ hidden: [...hidden], limit: 50 }),
      q('select feed_seen_at, now() as now from users where id = $1', [req.user.id]),
      // Отправленные анкеты — только владельцу и участникам: в ответах данные живых.
      ['owner', 'editor'].includes(req.user.role) ? q(
        `select id, name, submitted_at as at, answers->'people'->'self'->>'sex' as sex from surveys
         where submitted_at is not null and revoked_at is null order by submitted_at desc limit 20`,
      ) : [],
    ]);
    const seen = await visiblePhotos(ops, guest);
    const items = [
      ...ops.map(({ user_id: who, reverted, ...op }) => ({
        kind: 'op',
        ...op,
        entries: guest ? op.entries.map((e) => trimEntry(e, hidden)) : op.entries,
        photos: newPhotos(op).filter((id) => seen.has(id)).slice(0, 6),
        fresh: who !== req.user.id && op.at > u.feed_seen_at,
      })),
      ...comments.map(({ user_id: who, created_at: at, body, ...c }) => ({
        kind: 'comment',
        ...c,
        at,
        body: body.slice(0, 300),
        fresh: who !== req.user.id && at > u.feed_seen_at,
      })),
      ...surveys.map((sv) => ({ kind: 'survey', ...sv, fresh: sv.at > u.feed_seen_at })),
    ];
    items.sort((a, b) => b.at - a.at);
    return { items: items.slice(0, 50), now: u.now };
  });

  // Лента просмотрена до момента at — того, что вернул GET /api/feed: правки, появившиеся после, останутся новыми.
  app.post('/api/feed/seen', { preHandler: need('viewer') }, async (req) => {
    const at = new Date(req.body?.at);
    await q('update users set feed_seen_at = greatest(feed_seen_at, least($1::timestamptz, now())) where id = $2',
      [Number.isNaN(at.getTime()) ? new Date() : at, req.user.id]);
    return { ok: true };
  });
}
