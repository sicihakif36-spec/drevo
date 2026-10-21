import crypto from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';

export const COOKIE = 'drevo_s';
// Родственник видит всё, как участник, но дерево не правит: need('editor') его не пускает.
const RANK = { viewer: 1, relative: 2, editor: 3, owner: 4 };

export const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');

export async function createInvite({ role, label = '', createdBy = null, forUser = null, days = 14 }) {
  const token = newToken();
  await q(
    `insert into invites (token_hash, role, label, created_by, for_user, expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
    [hash(token), role, label, createdBy, forUser, days],
  );
  return { token, url: `${config.publicUrl}/#/invite/${token}` };
}

export async function startSession(reply, userId, userAgent = '') {
  const token = newToken();
  await q('insert into sessions (token_hash, user_id, user_agent) values ($1, $2, $3)', [hash(token), userId, userAgent.slice(0, 200)]);
  reply.setCookie(COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: config.secureCookies, maxAge: 60 * 60 * 24 * 365,
  });
}

export function authPlugin(app) {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) {
      const rows = await q(
        `update sessions s set last_seen_at = now() from users u
         where s.token_hash = $1 and u.id = s.user_id and not u.disabled
         returning u.id, u.name, u.role, u.person_id`,
        [hash(token)],
      );
      req.user = rows[0] || null;
      req.sessionHash = rows[0] ? hash(token) : null;
    }
    // Защита от подделки запросов: изменения только из нашего приложения.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url.startsWith('/api/') && req.headers['x-drevo'] !== '1') {
      return reply.code(403).send({ error: 'Запрос отклонён' });
    }
  });
}

export function need(role) {
  return async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Нужно войти по ссылке-приглашению' });
    if (RANK[req.user.role] < RANK[role]) return reply.code(403).send({ error: 'Недостаточно прав' });
  };
}
