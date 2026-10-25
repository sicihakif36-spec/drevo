import crypto from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';

export const COOKIE = 'drevo_s';
// Родственник видит всё, как участник, но дерево не правит: need('editor') его не пускает.
const RANK = { viewer: 1, relative: 2, editor: 3, owner: 4 };
const YEAR = 60 * 60 * 24 * 365;
// Пароль при входе с нового устройства нужен тем, кто правит дерево.
export const needsPassword = (role) => RANK[role] >= RANK.editor;

export const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');

// Срок ссылки по умолчанию — 3 дня: чем короче, тем меньше времени у того, кому она попала по ошибке.
export const INVITE_DAYS = 3;

export async function createInvite({ role, label = '', createdBy = null, forUser = null, days = INVITE_DAYS, personId = null }) {
  const token = newToken();
  await q(
    `insert into invites (token_hash, role, label, created_by, for_user, expires_at, person_id)
     values ($1, $2, $3, $4, $5, now() + make_interval(days => $6), $7)`,
    [hash(token), role, label, createdBy, forUser, days, personId],
  );
  return { token, url: `${config.publicUrl}/#/invite/${token}` };
}

const cookieOptions = () => ({ path: '/', httpOnly: true, sameSite: 'strict', secure: config.secureCookies });

// pending — сессия ждёт пароль (вход по ссылке на новом телефоне). Возвращает хеш ключа сессии.
// db — транзакция, если вход идёт внутри неё.
export async function startSession(reply, userId, { userAgent = '', ip = '', pending = false, db = { q } } = {}) {
  const token = newToken();
  await db.q('insert into sessions (token_hash, user_id, user_agent, ip, pending) values ($1, $2, $3, $4, $5)',
    [hash(token), userId, String(userAgent).slice(0, 300), String(ip).slice(0, 64), pending]);
  reply.setCookie(COOKIE, token, { ...cookieOptions(), maxAge: YEAR });
  return hash(token);
}

export const endSession = (reply) => reply.clearCookie(COOKIE, cookieOptions());

// Кто вошёл, как его видят маршруты. Участник или владелец без пароля пока только смотрит, как родственник:
// role — то, что ему можно сейчас, real_role — его права после того, как придумает пароль.
export function sessionUser(row) {
  const user = { id: row.id, name: row.name, role: row.role, person_id: row.person_id, has_password: row.has_password };
  if (needsPassword(row.role) && !row.has_password) Object.assign(user, { role: 'relative', real_role: row.role, needs_password: true });
  return user;
}

// Кто я — для телефона: настоящая роль и needs_password (тогда, пока нет пароля, правка закрыта).
export const meOf = (user) => user && (({ real_role: real, ...u }) => ({ ...u, role: real || u.role }))(user);

// Сессией не пользовались год — она больше не действует (и удаляется при уборке).
export const ALIVE = "s.last_seen_at > now() - interval '1 year'";

// Уборка раз в час: старые сессии, брошенные на вводе пароля, входы старше 90 дней, старые попытки пароля.
export async function cleanup() {
  await q("delete from sessions s where not (s.last_seen_at > now() - interval '1 year') or (s.pending and s.created_at < now() - interval '7 days')");
  await q("delete from logins where at < now() - interval '90 days'");
  await q("delete from password_tries where at < now() - interval '1 day'");
}

export function authPlugin(app) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionHash', null);
  app.decorateRequest('pending', null);
  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) {
      const h = hash(token);
      const [row] = await q(
        `with old as (select last_seen_at from sessions where token_hash = $1)
         update sessions s set last_seen_at = now() from users u
         where s.token_hash = $1 and u.id = s.user_id and not u.disabled and ${ALIVE}
         returning u.id, u.name, u.role, u.person_id, u.password_hash is not null as has_password, s.pending, s.id as session_id,
           (select last_seen_at from old) < now() - interval '1 day' as stale`,
        [h],
      );
      if (row?.pending) {
        // Ждёт пароль: ничего, кроме ввода пароля (и выхода).
        req.pending = { id: row.id, name: row.name, session_id: row.session_id };
        req.sessionHash = h;
      } else if (row) {
        req.user = sessionUser(row);
        req.sessionId = row.session_id;
        req.sessionHash = h;
        // Кто заходит хотя бы раз в год, не выходит сам собой: срок ключа продлевается раз в день.
        if (row.stale) reply.setCookie(COOKIE, token, { ...cookieOptions(), maxAge: YEAR });
      }
    }
    // Защита от подделки запросов: изменения только из нашего приложения.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url.startsWith('/api/') && req.headers['x-drevo'] !== '1') {
      return reply.code(403).send({ error: 'Запрос отклонён' });
    }
  });

  let timer = null;
  let running = null;
  const sweep = () => {
    running ??= cleanup().catch((err) => app.log.warn({ err }, 'уборка старых входов не удалась')).finally(() => { running = null; });
  };
  app.addHook('onReady', async () => {
    timer = setInterval(sweep, 3600000);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await running;
  });
}

export function need(role) {
  return async (req, reply) => {
    if (req.pending) return reply.code(401).send({ error: 'Сначала введите пароль', password: true });
    if (!req.user) return reply.code(401).send({ error: 'Нужно войти по ссылке-приглашению' });
    if (RANK[req.user.role] < RANK[role]) {
      if (req.user.needs_password && RANK[req.user.real_role] >= RANK[role]) {
        return reply.code(403).send({ error: 'Чтобы править дерево, придумайте пароль: «Ещё → Мои устройства и пароль»', password: true });
      }
      return reply.code(403).send({ error: 'Недостаточно прав' });
    }
  };
}
