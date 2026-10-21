// Обсуждение у карточки: комментарии и воспоминания. Это не правка дерева, в журнал не пишется.
// Пишут участники и владелец; изменить можно только своё, удалить — своё, а владелец — любое.
// Гость читает обсуждение, кроме карточек живых (там бывают телефоны и адреса, как в заметках).
import { q } from '../db.js';
import { need } from '../auth.js';
import { HttpError } from '../tree.js';
import { isGuest } from '../privacy.js';
import { isPrivate } from '../../../shared/names.js';

const MAX = 5000;

const SELECT = `select c.id, c.person_id, c.user_id, u.name as user_name, c.body, c.created_at, c.updated_at
  from comments c join persons p on p.id = c.person_id left join users u on u.id = c.user_id
  where c.deleted_at is null and p.deleted_at is null`;

// Последние комментарии для ленты, без тех, что у людей из hidden.
export function recentComments({ hidden = [], limit = 50 } = {}) {
  return q(`${SELECT} and not (c.person_id = any($1::uuid[])) order by c.created_at desc limit $2`, [hidden, limit]);
}

function text(body) {
  const t = String(body?.body ?? '').trim();
  if (!t) throw new HttpError(400, 'Напишите текст');
  if (t.length > MAX) throw new HttpError(400, `Слишком длинно: не больше ${MAX} знаков`);
  return t;
}

async function person(id) {
  const p = (await q('select id, living, birth_date from persons where id = $1 and deleted_at is null', [id]))[0];
  if (!p) throw new HttpError(404, 'Человек не найден');
  return p;
}

// Свой комментарий (или любой — для владельца, если можно и чужой).
async function own(req, anyForOwner) {
  const c = (await q(`${SELECT} and c.id = $1`, [req.params.id]))[0];
  if (!c) throw new HttpError(404, 'Комментарий не найден');
  if (c.user_id !== req.user.id && !(anyForOwner && req.user.role === 'owner')) {
    throw new HttpError(403, anyForOwner ? 'Удалить можно только свой комментарий' : 'Изменить можно только свой комментарий');
  }
  return c;
}

export default async function commentRoutes(app) {
  app.get('/api/persons/:id/comments', { preHandler: need('viewer') }, async (req) => {
    const p = await person(req.params.id);
    if (isGuest(req.user) && isPrivate(p)) throw new HttpError(403, 'Обсуждение живых родственников видно только участникам дерева');
    return q(`${SELECT} and c.person_id = $1 order by c.created_at`, [p.id]);
  });

  app.post('/api/persons/:id/comments', { preHandler: need('editor') }, async (req) => {
    const body = text(req.body);
    const p = await person(req.params.id);
    const { id } = (await q('insert into comments (person_id, user_id, body) values ($1, $2, $3) returning id', [p.id, req.user.id, body]))[0];
    return (await q(`${SELECT} and c.id = $1`, [id]))[0];
  });

  app.patch('/api/comments/:id', { preHandler: need('editor') }, async (req) => {
    const body = text(req.body);
    const c = await own(req, false);
    if (body === c.body) return c;
    await q('update comments set body = $2, updated_at = now() where id = $1', [c.id, body]);
    return (await q(`${SELECT} and c.id = $1`, [c.id]))[0];
  });

  app.delete('/api/comments/:id', { preHandler: need('editor') }, async (req) => {
    const c = await own(req, true);
    await q('update comments set deleted_at = now() where id = $1', [c.id]);
    return { ok: true };
  });
}
