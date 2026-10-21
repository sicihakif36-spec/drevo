// Справочник мест и карточка места: кто здесь родился, вступил в брак, жил (события), умер, похоронен.
// Гостю — только то, что он и так видит: без живых, их браков и событий с ними.
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { HttpError } from '../tree.js';
import { createPlace, updatePlace, deletePlace, retitle } from '../places.js';
import { LIST, visibleEvents } from './timeline.js';
import { isGuest } from '../privacy.js';
import { isPrivate } from '../../../shared/names.js';
import { PLACE_FIELDS } from '../../../shared/places.js';

const LIMITS = { kind: 20, name: 200, volost: 200, uezd: 200, gubernia: 200, country: 200, now: 300, note: 2000 };

// Поля из запроса: только присланные.
function clean(body) {
  const out = {};
  for (const c of PLACE_FIELDS) if (body?.[c] !== undefined) out[c] = String(body[c] ?? '').trim().slice(0, LIMITS[c]);
  return out;
}

export const listPlaces = () => q(`select id, ${PLACE_FIELDS.join(', ')}, title from places where deleted_at is null order by title`);

const one = async (id) => (await q(`select id, ${PLACE_FIELDS.join(', ')}, title from places where id = $1 and deleted_at is null`, [id]))[0];

export default async function placeRoutes(app) {
  app.get('/api/places', { preHandler: need('viewer') }, () => listPlaces());

  // Места, которые уже встречаются в дереве, — для подсказки при вводе. Нужны только тем, кто правит.
  app.get('/api/places/used', { preHandler: need('editor') }, async () => (await q(
    `select min(t) as text from (
       select unnest(array[birth_place, death_place, burial_place]) as t from persons where deleted_at is null
       union all select place from families
       union all select place from life_events where deleted_at is null
     ) x where trim(t) <> '' group by place_key(t) order by count(*) desc, min(t)`,
  )).map((r) => r.text));

  // Карточка места: по id из справочника или по тексту из карточки человека (место может быть и не в справочнике).
  app.get('/api/places/card', { preHandler: need('viewer') }, async (req) => {
    let place = null;
    let text = String(req.query.text || '').trim();
    if (req.query.id) {
      place = await one(req.query.id);
      if (!place) throw new HttpError(404, 'Место не найдено');
      text = place.title;
    } else {
      if (!text) throw new HttpError(400, 'Не указано место');
      place = (await q(`select id, ${PLACE_FIELDS.join(', ')}, title from places where place_key(title) = place_key($1) and deleted_at is null`, [text]))[0] || null;
    }
    const at = (col, date) => q(
      `select id, ${date ? `${date} as date` : "'' as date"}, living, birth_date from persons
       where deleted_at is null and place_key(${col}) = place_key($1) order by surname, given`, [text]);
    const [born, died, buried, families, events] = await Promise.all([
      at('birth_place', 'birth_date'), at('death_place', 'death_date'), at('burial_place', null),
      q(`select f.id, f.partner1, f.partner2, f.kind, f.start_date as date from families f
         where place_key(f.place) = place_key($1) order by f.start_date`, [text]),
      q(`${LIST} where e.deleted_at is null and place_key(e.place) = place_key($1) order by e.date, e.created_at`, [text]),
    ]);
    const guest = isGuest(req.user);
    let hidden = new Set();
    if (guest) {
      const ids = families.flatMap((f) => [f.partner1, f.partner2]).filter(Boolean);
      hidden = new Set((await q('select id, living, birth_date from persons where id = any($1::uuid[])', [ids])).filter((p) => isPrivate(p)).map((p) => p.id));
    }
    const people = (rows) => rows.filter((p) => !(guest && isPrivate(p))).map(({ id, date }) => ({ id, date }));
    return {
      place,
      text: place?.title || text,
      born: people(born),
      died: people(died),
      buried: people(buried),
      married: families.filter((f) => !hidden.has(f.partner1) && !hidden.has(f.partner2)),
      events: await visibleEvents(req.user, events),
    };
  });

  // from — текст места из карточек, который станет полным названием нового места.
  app.post('/api/places', { preHandler: need('editor') }, async (req) => {
    const p = await tx((db) => createPlace(db, req.user.id, clean(req.body), String(req.body?.from || '').slice(0, 300)));
    return one(p.id);
  });

  app.patch('/api/places/:id', { preHandler: need('editor') }, async (req) => {
    await tx((db) => updatePlace(db, req.user.id, req.params.id, clean(req.body)));
    const p = await one(req.params.id);
    if (!p) throw new HttpError(404, 'Место не найдено');
    return p;
  });

  app.delete('/api/places/:id', { preHandler: need('editor') }, async (req) => {
    const changeId = await tx((db) => deletePlace(db, req.user.id, req.params.id));
    return { ok: true, changeId };
  });

  // Это место из справочника: везде, где записано текстом text, написать его полное название.
  app.post('/api/places/:id/adopt', { preHandler: need('editor') }, async (req) => {
    const text = String(req.body?.text || '').trim();
    if (!text) throw new HttpError(400, 'Не указано место');
    const n = await tx(async (db) => {
      const p = (await db.q('select title from places where id = $1 and deleted_at is null', [req.params.id]))[0];
      if (!p) throw new HttpError(404, 'Место не найдено');
      return retitle(db, req.user.id, text, p.title);
    });
    return { ok: true, changed: n };
  });
}
