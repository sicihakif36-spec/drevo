import { q } from '../db.js';
import { need, createInvite, startSession, hash, COOKIE } from '../auth.js';

const ROLES = ['owner', 'editor', 'relative', 'viewer'];
const attempts = new Map();

function limited(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  a.push(now);
  attempts.set(ip, a);
  return a.length > 20;
}

export default async function userRoutes(app) {
  app.get('/api/me', async (req) => ({ user: req.user }));

  app.post('/api/invites/redeem', async (req, reply) => {
    if (limited(req.ip)) return reply.code(429).send({ error: 'Слишком много попыток, подождите 10 минут' });
    const token = String(req.body?.token || '');
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const inv = (await q(
      'update invites set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning *',
      [hash(token)],
    ))[0];
    if (!inv) return reply.code(400).send({ error: 'Ссылка недействительна или уже использована. Попросите новую.' });
    let userId = inv.for_user;
    if (!userId) {
      userId = (await q('insert into users (name, role) values ($1, $2) returning id', [name || inv.label || 'Родственник', inv.role]))[0].id;
    }
    await q('update invites set used_by = $1 where token_hash = $2', [userId, inv.token_hash]);
    await startSession(reply, userId, req.headers['user-agent'] || '');
    return { ok: true };
  });

  app.post('/api/logout', async (req, reply) => {
    if (req.sessionHash) await q('delete from sessions where token_hash = $1', [req.sessionHash]);
    reply.clearCookie(COOKIE, { path: '/' });
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

  app.get('/api/invites', { preHandler: need('owner') }, async () => q(
    `select token_hash as id, role, label, created_at, expires_at, for_user from invites
     where used_at is null and expires_at > now() order by created_at desc`,
  ));

  app.post('/api/invites', { preHandler: need('owner') }, async (req, reply) => {
    const role = req.body?.role;
    if (!ROLES.includes(role)) return reply.code(400).send({ error: 'Неизвестная роль' });
    const days = Math.min(90, Math.max(1, Number(req.body?.days) || 14));
    return createInvite({ role, label: String(req.body?.label || '').trim().slice(0, 80), createdBy: req.user.id, days });
  });

  app.delete('/api/invites/:id', { preHandler: need('owner') }, async (req) => {
    await q('delete from invites where token_hash = $1 and used_at is null', [req.params.id]);
    return { ok: true };
  });

  app.get('/api/users', { preHandler: need('owner') }, async () => q(
    `select u.id, u.name, u.role, u.person_id, u.disabled, u.created_at, max(s.last_seen_at) as last_seen_at
     from users u left join sessions s on s.user_id = u.id group by u.id order by u.created_at`,
  ));

  app.patch('/api/users/:id', { preHandler: need('owner') }, async (req, reply) => {
    if (req.params.id === req.user.id) return reply.code(400).send({ error: 'Свои права изменить нельзя' });
    const { role, disabled } = req.body || {};
    if (role !== undefined) {
      if (!ROLES.includes(role)) return reply.code(400).send({ error: 'Неизвестная роль' });
      await q('update users set role = $1 where id = $2', [role, req.params.id]);
    }
    if (disabled !== undefined) {
      await q('update users set disabled = $1 where id = $2', [Boolean(disabled), req.params.id]);
      if (disabled) await q('delete from sessions where user_id = $1', [req.params.id]);
    }
    return { ok: true };
  });

  // Ссылка для входа существующего участника на новом телефоне.
  app.post('/api/users/:id/login-link', { preHandler: need('owner') }, async (req, reply) => {
    const u = (await q('select id, role, name from users where id = $1', [req.params.id]))[0];
    if (!u) return reply.code(404).send({ error: 'Участник не найден' });
    return createInvite({ role: u.role, label: u.name, createdBy: req.user.id, forUser: u.id, days: 3 });
  });
}
