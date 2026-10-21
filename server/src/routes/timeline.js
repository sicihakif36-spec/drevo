// Лента жизни в карточке человека: свои события — учёба, служба, переезд, награда… Рождение, браки и смерть телефон
// берёт из дерева сам. Событие видно у каждого участника.
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { HttpError, alive } from '../tree.js';
import { createEvent, updateEvent, deleteEvent, addParticipant, removeParticipant } from '../timeline.js';
import { isGuest, guestEvents } from '../privacy.js';

const LIMITS = { kind: 20, date: 100, place: 300, title: 300, body: 20000, unit: 300, rank: 100 };

export const LIST = `select e.id, e.kind, e.date, e.place, e.title, e.body, e.unit, e.rank, e.created_by, u.name as user_name, e.created_at,
    array(select ep.person_id from event_persons ep join persons p on p.id = ep.person_id
          where ep.event_id = e.id and p.deleted_at is null order by ep.person_id) as persons
  from life_events e left join users u on u.id = e.created_by`;

// Поля из запроса: только присланные.
function clean(body) {
  const out = {};
  for (const [k, n] of Object.entries(LIMITS)) if (body?.[k] !== undefined) out[k] = String(body[k] ?? '').trim().slice(0, n);
  return out;
}

export async function visibleEvents(user, rows) {
  if (!isGuest(user)) return rows;
  const ok = await guestEvents(rows.map((r) => r.id));
  return rows.filter((r) => ok.has(r.id));
}

// События для выгрузки GEDCOM; гостю — по тем же правилам, что и в карточке.
export async function eventData(user) {
  return { events: await visibleEvents(user, await q(`${LIST} where e.deleted_at is null order by e.created_at, e.id`)) };
}

const one = async (id) => (await q(`${LIST} where e.id = $1 and e.deleted_at is null`, [id]))[0];

export default async function timelineRoutes(app) {
  app.get('/api/persons/:id/life-events', { preHandler: need('viewer') }, async (req) => visibleEvents(req.user, await q(
    `${LIST} join event_persons t on t.event_id = e.id and t.person_id = $1
     where e.deleted_at is null order by e.created_at, e.id`, [req.params.id])));

  app.get('/api/life-events/:id', { preHandler: need('viewer') }, async (req) => {
    const ev = await one(req.params.id);
    if (!ev || !(await visibleEvents(req.user, [ev])).length) throw new HttpError(404, 'Событие не найдено');
    return ev;
  });

  // persons — другие участники, кроме самого человека.
  app.post('/api/persons/:id/life-events', { preHandler: need('editor') }, async (req) => {
    const data = clean(req.body);
    if (!data.kind) throw new HttpError(400, 'Выберите, что это за событие');
    const others = Array.isArray(req.body?.persons) ? req.body.persons.map(String).slice(0, 100) : [];
    const ev = await tx((db) => createEvent(db, req.user.id, [...new Set([req.params.id, ...others])], data));
    return one(ev.id);
  });

  app.patch('/api/life-events/:id', { preHandler: need('editor') }, async (req) => {
    await tx((db) => updateEvent(db, req.user.id, req.params.id, clean(req.body)));
    const ev = await one(req.params.id);
    if (!ev) throw new HttpError(404, 'Событие не найдено');
    return ev;
  });

  app.delete('/api/life-events/:id', { preHandler: need('editor') }, async (req) => {
    const changeId = await tx((db) => deleteEvent(db, req.user.id, req.params.id));
    return { ok: true, changeId };
  });

  // Участники события: добавить или убрать.
  app.put('/api/life-events/:id/persons/:personId', { preHandler: need('editor') }, async (req) => {
    await tx(async (db) => {
      if (!(await alive(db, req.params.personId))) throw new HttpError(404, 'Человек не найден');
      await addParticipant(db, req.user.id, req.params.id, req.params.personId);
    });
    return one(req.params.id);
  });

  app.delete('/api/life-events/:id/persons/:personId', { preHandler: need('editor') }, async (req) => {
    await tx((db) => removeParticipant(db, req.user.id, req.params.id, req.params.personId));
    return one(req.params.id);
  });
}
