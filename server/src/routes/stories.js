// Истории в карточке человека: заголовок, дата в свободной форме, текст и запись голоса.
// Запись голоса телефон сначала загружает отдельно (POST /api/audio), потом прикладывает к истории её номером.
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { HttpError, alive } from '../tree.js';
import { createStory, updateStory, deleteStory, linkPerson, unlinkPerson } from '../stories.js';
import { isGuest, guestStories } from '../privacy.js';

const LIMITS = { title: 200, date: 100, body: 20000 };

const LIST = `select s.id, s.title, s.date, s.body, s.audio_id, m.mime as audio_mime, m.duration as audio_duration,
    s.created_by, u.name as user_name, s.created_at,
    array(select sp.person_id from story_persons sp join persons p on p.id = sp.person_id
          where sp.story_id = s.id and p.deleted_at is null order by sp.person_id) as persons
  from stories s left join media m on m.id = s.audio_id left join users u on u.id = s.created_by`;

// Поля из запроса: только присланные. audio_id null или '' — убрать запись.
function clean(body) {
  const out = {};
  for (const [k, n] of Object.entries(LIMITS)) if (body?.[k] !== undefined) out[k] = String(body[k] ?? '').trim().slice(0, n);
  if (body?.audio_id !== undefined) out.audio_id = body.audio_id ? String(body.audio_id) : null;
  return out;
}

async function visible(req, rows) {
  if (!isGuest(req.user)) return rows;
  const ok = await guestStories(rows.map((r) => r.id));
  return rows.filter((r) => ok.has(r.id));
}

const one = async (id) => (await q(`${LIST} where s.id = $1 and s.deleted_at is null`, [id]))[0];

export default async function storyRoutes(app) {
  app.get('/api/persons/:id/stories', { preHandler: need('viewer') }, async (req) => visible(req, await q(
    `${LIST} join story_persons t on t.story_id = s.id and t.person_id = $1
     where s.deleted_at is null order by s.created_at desc, s.id`, [req.params.id])));

  app.get('/api/stories/:id', { preHandler: need('viewer') }, async (req) => {
    const s = await one(req.params.id);
    if (!s || !(await visible(req, [s])).length) throw new HttpError(404, 'История не найдена');
    return s;
  });

  app.post('/api/persons/:id/stories', { preHandler: need('editor') }, async (req) => {
    const data = clean(req.body);
    if (!data.title) throw new HttpError(400, 'Напишите заголовок');
    const s = await tx(async (db) => {
      if (!(await alive(db, req.params.id))) throw new HttpError(404, 'Человек не найден');
      return createStory(db, req.user.id, req.params.id, data);
    });
    return one(s.id);
  });

  app.patch('/api/stories/:id', { preHandler: need('editor') }, async (req) => {
    await tx((db) => updateStory(db, req.user.id, req.params.id, clean(req.body)));
    return one(req.params.id);
  });

  app.delete('/api/stories/:id', { preHandler: need('editor') }, async (req) => {
    const changeId = await tx((db) => deleteStory(db, req.user.id, req.params.id));
    return { ok: true, changeId };
  });

  // О ком история: связать с человеком или убрать связь.
  app.put('/api/stories/:id/persons/:personId', { preHandler: need('editor') }, async (req) => {
    await tx(async (db) => {
      if (!(await alive(db, req.params.personId))) throw new HttpError(404, 'Человек не найден');
      await linkPerson(db, req.user.id, req.params.id, req.params.personId);
    });
    return one(req.params.id);
  });

  app.delete('/api/stories/:id/persons/:personId', { preHandler: need('editor') }, async (req) => {
    await tx((db) => unlinkPerson(db, req.user.id, req.params.id, req.params.personId));
    return one(req.params.id);
  });
}
