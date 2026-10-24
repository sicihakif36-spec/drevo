import { q, tx } from '../db.js';
import { need, meOf } from '../auth.js';
import { logChange, listOps, countNew, canResearch } from '../changes.js';
import { revertOp } from '../revert.js';
import { HttpError, ownerPerson, PERSON_FIELDS, FAMILY_FIELDS, SLOTS, link, deletePerson, unsetPartner, removeChild, dropEmpty } from '../tree.js';
import { guestTree, isGuest, privateIds } from '../privacy.js';
import { listPlaces } from './places.js';
import { listMarks } from './checks.js';

function clean(body, fields) {
  const out = {};
  for (const f of fields) {
    if (body?.[f] === undefined) continue;
    let v = body[f];
    if (f === 'living') v = Boolean(v);
    else if (f === 'sex') v = ['M', 'F', 'U'].includes(v) ? v : 'U';
    else v = String(v ?? '').trim().slice(0, f === 'notes' ? 20000 : 300);
    out[f] = v;
  }
  return out;
}

async function insertPerson(db, data, userId) {
  const cols = Object.keys(data);
  const rows = await db.q(
    `insert into persons (${[...cols, 'created_by'].join(', ')}) values (${[...cols, 'u'].map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    [...cols.map((c) => data[c]), userId],
  );
  await logChange(db, userId, 'person', rows[0].id, 'create', null, rows[0]);
  return rows[0];
}

export default async function personRoutes(app) {
  app.get('/api/tree', { preHandler: need('viewer') }, async (req) => {
    const guest = isGuest(req.user);
    const editor = ['owner', 'editor'].includes(req.user.role);
    const [persons, families, children, settings, feedNew, places, owner, marks] = await Promise.all([
      q('select * from persons where deleted_at is null order by surname, given'),
      q('select * from families order by created_at'),
      q('select * from family_children'),
      q('select key, value from settings'),
      countNew(req.user.id, guest ? await privateIds() : [], editor),
      listPlaces(),
      ownerPerson({ q }),
      editor ? listMarks() : null,
    ]);
    const data = { persons, families, children };
    return {
      ...(guest ? await guestTree(data) : data),
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
      // Справочник мест: в нём нет данных людей, гостю тоже.
      places,
      me: meOf(req.user),
      // С кого начинать дерево тем, кто себя не отметил. Гостю тоже: это лишь id человека, которого он и так видит.
      owner_person_id: owner,
      feed_new: feedNew,
      // Отметки проверки дерева — только владельцу и участникам: в них даты живых.
      ...(editor ? { check_marks: marks } : {}),
    };
  });

  // Создать человека (или взять существующего) и сразу связать.
  app.post('/api/persons', { preHandler: need('editor') }, async (req) => {
    const { person, relation, existingId } = req.body || {};
    return tx(async (db) => {
      let p;
      if (existingId) {
        p = (await db.q('select * from persons where id = $1 and deleted_at is null', [existingId]))[0];
        if (!p) throw new HttpError(404, 'Человек не найден');
      } else {
        const data = clean(person, PERSON_FIELDS);
        if (!data.given && !data.surname) throw new HttpError(400, 'Укажите имя или фамилию');
        p = await insertPerson(db, data, req.user.id);
      }
      if (relation) await link(db, req.user.id, relation, p.id);
      return p;
    });
  });

  app.patch('/api/persons/:id', { preHandler: need('editor') }, async (req, reply) => {
    const data = clean(req.body, PERSON_FIELDS);
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'Нечего сохранять' });
    return tx(async (db) => {
      const cur = (await db.q('select * from persons where id = $1 and deleted_at is null for update', [req.params.id]))[0];
      if (!cur) throw new HttpError(404, 'Человек не найден');
      if (req.body.version && Number(req.body.version) !== cur.version) {
        return reply.code(409).send({ error: 'Карточку только что изменил кто-то другой. Проверьте данные и сохраните ещё раз.', current: cur });
      }
      const changed = Object.keys(data).filter((k) => cur[k] !== data[k]);
      if (!changed.length) return cur;
      const sets = changed.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const next = (await db.q(
        `update persons set ${sets}, version = version + 1, updated_at = now() where id = $1 returning *`,
        [cur.id, ...changed.map((k) => data[k])],
      ))[0];
      await logChange(db, req.user.id, 'person', cur.id, 'update',
        Object.fromEntries(changed.map((k) => [k, cur[k]])), Object.fromEntries(changed.map((k) => [k, next[k]])));
      return next;
    });
  });

  app.delete('/api/persons/:id', { preHandler: need('editor') }, async (req) => {
    const changeId = await tx((db) => deletePerson(db, req.user.id, req.params.id));
    return { ok: true, changeId };
  });

  app.post('/api/relations', { preHandler: need('editor') }, async (req) => {
    const { personId, ...relation } = req.body || {};
    await tx((db) => link(db, req.user.id, relation, personId));
    return { ok: true };
  });

  app.patch('/api/families/:id', { preHandler: need('editor') }, async (req, reply) => {
    const data = clean(req.body, FAMILY_FIELDS);
    if (data.kind && !['marriage', 'partners', 'unknown'].includes(data.kind)) data.kind = 'marriage';
    if (data.ended && !['', 'divorce', 'death'].includes(data.ended)) data.ended = '';
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'Нечего сохранять' });
    return tx(async (db) => {
      const cur = (await db.q('select * from families where id = $1 for update', [req.params.id]))[0];
      if (!cur) throw new HttpError(404, 'Семья не найдена');
      // В журнал — только то, что изменилось.
      const cols = Object.keys(data).filter((c) => data[c] !== cur[c]);
      if (!cols.length) return cur;
      const next = (await db.q(`update families set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1 returning *`, [cur.id, ...cols.map((c) => data[c])]))[0];
      await logChange(db, req.user.id, 'family', cur.id, 'update', Object.fromEntries(cols.map((c) => [c, cur[c]])),
        Object.fromEntries(cols.map((c) => [c, data[c]])), [cur.partner1, cur.partner2]);
      return next;
    });
  });

  // Разорвать связь «ребёнок» или «супруг», не удаляя людей.
  app.delete('/api/families/:id/members/:personId', { preHandler: need('editor') }, async (req) => {
    const { id, personId } = req.params;
    return tx(async (db) => {
      const fam = (await db.q('select * from families where id = $1 for update', [id]))[0];
      if (!fam) throw new HttpError(404, 'Семья не найдена');
      const slot = SLOTS.find((s) => fam[s] === personId);
      if (slot) await unsetPartner(db, req.user.id, id, slot, personId);
      else if (!(await removeChild(db, req.user.id, id, personId))) throw new HttpError(404, 'Такой связи нет');
      await dropEmpty(db, req.user.id, [id]);
      return { ok: true };
    });
  });

  // История — всем, кроме гостей: в старых значениях есть данные живых. Откат — только тем, кто правит.
  // Записи исследования — только владельцу и участникам. op — одно действие (ссылка из журнала поиска).
  app.get('/api/persons/:id/history', { preHandler: need('relative') }, async (req) => listOps({ person: req.params.id, limit: 100, research: canResearch(req.user) }));

  app.get('/api/changes', { preHandler: need('relative') }, async (req) => listOps({ limit: 50, op: req.query.op || null, research: canResearch(req.user) }));

  // Отменить действие, в которое входит правка :id.
  app.post('/api/changes/:id/revert', { preHandler: need('editor') }, async (req) => {
    await tx((db) => revertOp(db, req.user.id, req.params.id));
    return { ok: true };
  });

  app.put('/api/settings/title', { preHandler: need('owner') }, async (req) => {
    const title = String(req.body?.title || '').trim().slice(0, 120) || 'Наше семейное древо';
    await q('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', ['title', JSON.stringify(title)]);
    return { title };
  });
}
