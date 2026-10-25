import { q, tx } from '../db.js';
import { need, meOf, createInvite, startSession, endSession, hash, needsPassword, INVITE_DAYS, ALIVE } from '../auth.js';
import { hashPassword, checkPassword } from '../password.js';
import { HttpError } from '../tree.js';
import { deviceName } from '../../../shared/device.js';

const ROLES = ['owner', 'editor', 'relative', 'viewer'];
// Сколько дней живёт ссылка-приглашение: на выбор.
const DAYS = [1, 3, 7, 14];
// Ключ ссылки — 256 бит, подобрать его нельзя; ограничение лишь гасит мусорные запросы, поэтому хранится в памяти.
const attempts = new Map();
// Пароль подобрать можно: попытки считаются в базе (password_tries), по человеку и по адресу.
const TRIES = 5;
const WAIT = 15; // минут

// Считаются только неудачные попытки: кто открыл верную ссылку, тот не мешает ни себе, ни соседу по адресу.
function limited(ip, fail = false) {
  const now = Date.now();
  const fresh = (list) => list.filter((t) => now - t < 10 * 60 * 1000);
  const a = fresh(attempts.get(ip) || []);
  if (fail) a.push(now);
  attempts.set(ip, a);
  if (attempts.size > 10000) for (const [k, v] of attempts) if (!fresh(v).length) attempts.delete(k);
  return a.length >= 20;
}

const minutes = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'минуту' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'минуты' : 'минут'}`;

// Одна попытка ввести пароль человека userId. Неверно — HttpError с тем, сколько осталось; пятая неверная — сообщение владельцу.
async function tryPassword(app, req, userId, password) {
  const ip = req.ip || '';
  const [mine] = await q('insert into password_tries (user_id, ip) values ($1, $2) returning id', [userId, ip]);
  const [n] = await q(
    `select count(*) filter (where user_id = $1)::int as by_user, count(*) filter (where ip = $2)::int as by_ip
     from password_tries where at > now() - make_interval(mins => $3) and (user_id = $1 or ip = $2)`,
    [userId, ip, WAIT],
  );
  if (n.by_user > TRIES || n.by_ip > TRIES) {
    // Лишняя попытка не в счёт: ожидание идёт от пятой неверной, а не продлевается каждой новой.
    await q('delete from password_tries where id = $1', [mine.id]);
    const [w] = await q(
      `select ceil(extract(epoch from max(fifth) + make_interval(mins => $3) - now()) / 60)::int as wait from (
         (select at as fifth from password_tries where user_id = $1 order by at desc offset ${TRIES - 1} limit 1)
         union all (select at from password_tries where ip = $2 order by at desc offset ${TRIES - 1} limit 1)) t`,
      [userId, ip, WAIT],
    );
    throw new HttpError(429, `Пять раз неверный пароль. Подождите ${minutes(Math.max(1, w?.wait || WAIT))} и попробуйте снова.`);
  }
  const [u] = await q('select password_hash from users where id = $1', [userId]);
  if (await checkPassword(password, u?.password_hash)) {
    await q('delete from password_tries where user_id = $1', [userId]);
    return;
  }
  if (n.by_user === TRIES) {
    const [l] = await q(
      `insert into logins (user_id, kind, role, user_agent, ip) select id, 'fails', role, $2, $3 from users where id = $1 returning id`,
      [userId, String(req.headers['user-agent'] || '').slice(0, 300), ip],
    );
    app.push.login(l.id);
  }
  const left = TRIES - Math.max(n.by_user, n.by_ip);
  throw new HttpError(400, left > 0
    ? `Неверный пароль. Осталось попыток: ${left}`
    : `Неверный пароль. Пять раз подряд — подождите ${minutes(WAIT)} и попробуйте снова.`);
}

// Сессии человека для «Мои устройства»: номер, устройство, когда вошли и были, ждёт ли пароль.
const sessionList = async (userId, current = null) => (await q(
  `select s.id, s.user_agent, s.created_at, s.last_seen_at, s.pending, s.token_hash = $2 as current
   from sessions s where s.user_id = $1 and ${ALIVE} order by (s.token_hash = $2) desc, s.last_seen_at desc`,
  [userId, current],
)).map(({ user_agent: ua, ...s }) => ({ ...s, device: deviceName(ua) }));

const findUser = async (id) => {
  const [u] = await q('select id, name, role, disabled, password_hash is not null as has_password from users where id = $1', [id]);
  if (!u) throw new HttpError(404, 'Участник не найден');
  return u;
};

// Выйти на всех устройствах человека; ссылки для нового телефона, которые ещё не открыли, тоже перестают действовать.
async function signOut(db, userId) {
  await db.q('delete from sessions where user_id = $1', [userId]);
  await db.q('delete from invites where for_user = $1 and used_at is null', [userId]);
}

export default async function userRoutes(app) {
  app.get('/api/me', async (req) => ({ user: meOf(req.user), pending: req.pending && { name: req.pending.name } }));

  app.post('/api/invites/redeem', async (req, reply) => {
    if (limited(req.ip)) return reply.code(429).send({ error: 'Слишком много попыток, подождите 10 минут' });
    const token = String(req.body?.token || '');
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const userAgent = String(req.headers['user-agent'] || '');
    const res = await tx(async (db) => {
      const [inv] = await db.q(
        'update invites set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning *',
        [hash(token)],
      );
      if (!inv) return null;
      let user;
      if (inv.for_user) {
        [user] = await db.q('select id, role, disabled, password_hash is not null as has_password from users where id = $1', [inv.for_user]);
        if (!user || user.disabled) return null;
      } else {
        // «Кто это в дереве» из приглашения — если человек ещё есть
        const [person] = inv.person_id ? await db.q('select id from persons where id = $1 and deleted_at is null', [inv.person_id]) : [];
        [user] = await db.q('insert into users (name, role, person_id) values ($1, $2, $3) returning id, role, false as has_password',
          [name || inv.label || 'Родственник', inv.role, person?.id || null]);
      }
      await db.q('update invites set used_by = $1 where token_hash = $2', [user.id, inv.token_hash]);
      // У кого есть пароль и кто правит дерево — на новом телефоне ещё и пароль; до него сессия ничего не даёт.
      const pending = needsPassword(user.role) && user.has_password;
      const session = await startSession(reply, user.id, { userAgent, ip: req.ip, pending, db });
      const [login] = await db.q(
        'insert into logins (user_id, kind, role, user_agent, ip, session_hash) values ($1, $2, $3, $4, $5, $6) returning id',
        [user.id, inv.for_user ? 'link' : 'invite', user.role, userAgent.slice(0, 300), req.ip || '', session],
      );
      return { login: login.id, pending };
    });
    if (!res) {
      limited(req.ip, true);
      return reply.code(400).send({ error: 'Ссылка недействительна или уже использована. Попросите новую.' });
    }
    app.push.login(res.login);
    return { ok: true, password: res.pending };
  });

  // Вход по ссылке на новом телефоне: ввести пароль.
  app.post('/api/login/password', async (req) => {
    if (!req.pending) throw new HttpError(400, 'Вход не ждёт пароля. Откройте приложение заново.');
    await tryPassword(app, req, req.pending.id, req.body?.password);
    await q('update sessions set pending = false where token_hash = $1', [req.sessionHash]);
    return { ok: true };
  });

  app.post('/api/logout', async (req, reply) => {
    if (req.sessionHash) await q('delete from sessions where token_hash = $1', [req.sessionHash]);
    endSession(reply);
    return { ok: true };
  });

  app.patch('/api/me', { preHandler: need('viewer') }, async (req, reply) => {
    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 80) : undefined;
    const personId = req.body?.person_id;
    if (personId && !(await q('select 1 from persons where id = $1 and deleted_at is null', [personId]))[0]) {
      return reply.code(404).send({ error: 'Человек не найден' });
    }
    if (name) await q('update users set name = $1 where id = $2', [name, req.user.id]);
    if (personId !== undefined) await q('update users set person_id = $1 where id = $2', [personId || null, req.user.id]);
    return (await q('select id, name, role, person_id from users where id = $1', [req.user.id]))[0];
  });

  // Придумать пароль (если его нет) или сменить (старый + новый). Смена выводит со всех остальных устройств.
  app.post('/api/me/password', { preHandler: need('viewer') }, async (req) => {
    if (!needsPassword(req.user.real_role || req.user.role)) throw new HttpError(400, 'Пароль нужен только тем, кто правит дерево');
    const password = req.body?.password;
    // Сначала — годится ли новый: неудачный новый пароль не должен тратить попытки старого.
    const stored = await hashPassword(password);
    if (req.user.has_password) await tryPassword(app, req, req.user.id, req.body?.old);
    await tx(async (db) => {
      await db.q('update users set password_hash = $1 where id = $2', [stored, req.user.id]);
      if (req.user.has_password) await db.q('delete from sessions where user_id = $1 and token_hash <> $2', [req.user.id, req.sessionHash]);
    });
    return { ok: true };
  });

  app.get('/api/me/sessions', { preHandler: need('viewer') }, async (req) => sessionList(req.user.id, req.sessionHash));

  // Выйти на одном своём устройстве (на этом — тоже).
  app.delete('/api/me/sessions/:id', { preHandler: need('viewer') }, async (req, reply) => {
    const [s] = await q('delete from sessions where id = $1 and user_id = $2 returning token_hash', [req.params.id, req.user.id]);
    if (!s) throw new HttpError(404, 'Такого входа уже нет');
    if (s.token_hash === req.sessionHash) endSession(reply);
    return { ok: true };
  });

  app.post('/api/me/sessions/others', { preHandler: need('viewer') }, async (req) => {
    const gone = await q('delete from sessions where user_id = $1 and token_hash <> $2 returning 1', [req.user.id, req.sessionHash]);
    return { ok: true, count: gone.length };
  });

  app.get('/api/invites', { preHandler: need('owner') }, async () => q(
    `select token_hash as id, role, label, created_at, expires_at, for_user, person_id from invites
     where used_at is null and expires_at > now() order by created_at desc`,
  ));

  app.post('/api/invites', { preHandler: need('owner') }, async (req, reply) => {
    const role = req.body?.role;
    if (!ROLES.includes(role)) return reply.code(400).send({ error: 'Неизвестная роль' });
    const days = req.body?.days === undefined ? INVITE_DAYS : Number(req.body.days);
    if (!DAYS.includes(days)) return reply.code(400).send({ error: `Срок ссылки — ${DAYS.join(', ')} дней` });
    const personId = req.body?.person_id || null;
    if (personId && !(await q('select 1 from persons where id = $1 and deleted_at is null', [personId]))[0]) {
      return reply.code(404).send({ error: 'Человек не найден' });
    }
    return createInvite({ role, label: String(req.body?.label || '').trim().slice(0, 80), createdBy: req.user.id, days, personId });
  });

  app.delete('/api/invites/:id', { preHandler: need('owner') }, async (req) => {
    await q('delete from invites where token_hash = $1 and used_at is null', [req.params.id]);
    return { ok: true };
  });

  app.get('/api/users', { preHandler: need('owner') }, async () => q(
    `select u.id, u.name, u.role, u.person_id, u.disabled, u.created_at, u.password_hash is not null as has_password,
       (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as last_seen_at,
       (select count(*)::int from sessions s where s.user_id = u.id and ${ALIVE}) as devices
     from users u order by u.created_at`,
  ));

  app.patch('/api/users/:id', { preHandler: need('owner') }, async (req, reply) => {
    if (req.params.id === req.user.id) return reply.code(400).send({ error: 'Свои права изменить нельзя' });
    const { role, disabled } = req.body || {};
    await findUser(req.params.id);
    if (role !== undefined) {
      if (!ROLES.includes(role)) return reply.code(400).send({ error: 'Неизвестная роль' });
      await q('update users set role = $1 where id = $2', [role, req.params.id]);
    }
    if (disabled !== undefined) {
      await tx(async (db) => {
        await db.q('update users set disabled = $1 where id = $2', [Boolean(disabled), req.params.id]);
        if (disabled) await signOut(db, req.params.id);
      });
    }
    return { ok: true };
  });

  // «Это не он — отключить»: вошёл чужой. Отключить, вывести со всех устройств и забыть пароль —
  // его мог придумать тот, кто вошёл. Новую ссылку настоящему человеку владелец делает следом.
  app.post('/api/users/:id/intruder', { preHandler: need('owner') }, async (req) => {
    if (req.params.id === req.user.id) throw new HttpError(400, 'Себя отключить нельзя. Чтобы выйти на чужом устройстве — «Мои устройства».');
    await findUser(req.params.id);
    await tx(async (db) => {
      await db.q('update users set disabled = true, password_hash = null where id = $1', [req.params.id]);
      await signOut(db, req.params.id);
    });
    return { ok: true };
  });

  // Ссылка для входа существующего участника на новом телефоне.
  app.post('/api/users/:id/login-link', { preHandler: need('owner') }, async (req) => {
    const u = await findUser(req.params.id);
    if (u.disabled) throw new HttpError(400, 'Вход для этого человека отключён. Сначала включите вход.');
    return createInvite({ role: u.role, label: u.name, createdBy: req.user.id, forUser: u.id, days: INVITE_DAYS });
  });

  // Забыл пароль: сбросить, вывести со всех устройств (вдруг пароль узнал кто-то ещё) и дать новую ссылку —
  // по ней человек придумает новый пароль.
  app.post('/api/users/:id/reset-password', { preHandler: need('owner') }, async (req) => {
    if (req.params.id === req.user.id) throw new HttpError(400, 'Свой пароль меняется в «Мои устройства и пароль»');
    const u = await findUser(req.params.id);
    if (u.disabled) throw new HttpError(400, 'Вход для этого человека отключён. Сначала включите вход.');
    await tx(async (db) => {
      await db.q('update users set password_hash = null where id = $1', [u.id]);
      await signOut(db, u.id);
    });
    return createInvite({ role: u.role, label: u.name, createdBy: req.user.id, forUser: u.id, days: INVITE_DAYS });
  });

  // Устройства любого человека — владельцу: посмотреть, выйти на одном или на всех (без отключения).
  app.get('/api/users/:id/sessions', { preHandler: need('owner') }, async (req) => {
    await findUser(req.params.id);
    return sessionList(req.params.id, req.sessionHash);
  });

  app.delete('/api/users/:id/sessions/:sid', { preHandler: need('owner') }, async (req, reply) => {
    const [s] = await q('delete from sessions where id = $1 and user_id = $2 returning token_hash', [req.params.sid, req.params.id]);
    if (!s) throw new HttpError(404, 'Такого входа уже нет');
    if (s.token_hash === req.sessionHash) endSession(reply);
    return { ok: true };
  });

  app.delete('/api/users/:id/sessions', { preHandler: need('owner') }, async (req) => {
    if (req.params.id === req.user.id) throw new HttpError(400, 'Чтобы выйти на других своих устройствах — «Выйти на всех, кроме этого»');
    await findUser(req.params.id);
    const gone = await q('delete from sessions where user_id = $1 returning 1', [req.params.id]);
    return { ok: true, count: gone.length };
  });

  // Входы за 90 дней, новые сверху.
  app.get('/api/logins', { preHandler: need('owner') }, async () => (await q(
    `select l.id, l.at, l.kind, l.role, l.user_agent, l.user_id, u.name, u.disabled, p.sex,
       s.token_hash is not null as active, coalesce(s.pending, false) as pending
     from logins l join users u on u.id = l.user_id left join persons p on p.id = u.person_id
     left join sessions s on s.token_hash = l.session_hash
     where l.at > now() - interval '90 days' order by l.at desc, l.id desc limit 200`,
  )).map(({ user_agent: ua, ...l }) => ({ ...l, device: deviceName(ua) })));
}
