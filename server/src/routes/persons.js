import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { logChange } from '../changes.js';

export const PERSON_FIELDS = ['sex', 'surname', 'given', 'patronymic', 'birth_surname', 'living', 'birth_date', 'birth_place', 'death_date', 'death_place', 'burial_place', 'occupation', 'notes'];
const FAMILY_FIELDS = ['kind', 'start_date', 'end_date', 'ended'];

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

class HttpError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function insertPerson(db, data, userId) {
  const cols = Object.keys(data);
  const rows = await db.q(
    `insert into persons (${[...cols, 'created_by'].join(', ')}) values (${[...cols, 'u'].map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    [...cols.map((c) => data[c]), userId],
  );
  await logChange(db.q, userId, 'person', rows[0].id, 'create', null, rows[0]);
  return rows[0];
}

async function parentFamily(db, childId) {
  return (await db.q(
    'select f.* from family_children c join families f on f.id = c.family_id where c.child_id = $1 order by f.created_at limit 1',
    [childId],
  ))[0];
}

async function addChild(db, familyId, childId, userId, kind = 'birth') {
  await db.q('insert into family_children (family_id, child_id, kind) values ($1, $2, $3) on conflict do nothing', [familyId, childId, kind]);
  await logChange(db.q, userId, 'family', familyId, 'add_child', null, { child_id: childId, kind });
}

async function newFamily(db, p1, p2, userId) {
  const f = (await db.q('insert into families (partner1, partner2) values ($1, $2) returning *', [p1, p2]))[0];
  await logChange(db.q, userId, 'family', f.id, 'create', null, f);
  return f;
}

// Связать человека newId с человеком to отношением type.
async function link(db, { to, type, familyId }, newId, userId) {
  const exists = (await db.q('select id, sex from persons where id = $1 and deleted_at is null', [to]))[0];
  if (!exists) throw new HttpError(404, 'Человек не найден');
  if (to === newId) throw new HttpError(400, 'Нельзя связать человека с самим собой');
  if (type === 'father' || type === 'mother' || type === 'parent') {
    const fam = await parentFamily(db, to);
    if (!fam) {
      const f = await newFamily(db, newId, null, userId);
      await addChild(db, f.id, to, userId);
      return;
    }
    const slot = !fam.partner1 ? 'partner1' : !fam.partner2 ? 'partner2' : null;
    if (!slot) throw new HttpError(409, 'У этого человека уже указаны оба родителя');
    await db.q(`update families set ${slot} = $1 where id = $2`, [newId, fam.id]);
    await logChange(db.q, userId, 'family', fam.id, 'set_partner', null, { [slot]: newId });
    return;
  }
  if (type === 'spouse') {
    const empty = (await db.q('select * from families where (partner1 = $1 and partner2 is null) or (partner2 = $1 and partner1 is null) limit 1', [to]))[0];
    if (empty) {
      const slot = empty.partner1 ? 'partner2' : 'partner1';
      await db.q(`update families set ${slot} = $1 where id = $2`, [newId, empty.id]);
      await logChange(db.q, userId, 'family', empty.id, 'set_partner', null, { [slot]: newId });
    } else {
      await newFamily(db, to, newId, userId);
    }
    return;
  }
  if (type === 'child') {
    let fid = familyId;
    if (fid) {
      const ok = (await db.q('select 1 from families where id = $1 and (partner1 = $2 or partner2 = $2)', [fid, to]))[0];
      if (!ok) throw new HttpError(400, 'Семья не найдена');
    } else {
      const fams = await db.q('select id from families where partner1 = $1 or partner2 = $1 order by created_at', [to]);
      if (fams.length > 1) throw new HttpError(400, 'Выберите второго родителя');
      fid = fams[0]?.id || (await newFamily(db, to, null, userId)).id;
    }
    await addChild(db, fid, newId, userId);
    return;
  }
  if (type === 'sibling') {
    let fam = await parentFamily(db, to);
    if (!fam) {
      fam = await newFamily(db, null, null, userId);
      await addChild(db, fam.id, to, userId);
    }
    await addChild(db, fam.id, newId, userId);
    return;
  }
  throw new HttpError(400, 'Неизвестный тип связи');
}

async function snapshotLinks(db, id) {
  const partnerIn = await db.q(
    `select id as family_id, case when partner1 = $1 then 'partner1' else 'partner2' end as slot from families where partner1 = $1 or partner2 = $1`, [id]);
  const childIn = await db.q('select family_id, kind from family_children where child_id = $1', [id]);
  return { partnerIn, childIn };
}

export default async function personRoutes(app) {
  const send = (reply, e) => {
    if (e instanceof HttpError) return reply.code(e.code).send({ error: e.message });
    throw e;
  };

  app.get('/api/tree', { preHandler: need('viewer') }, async (req) => {
    const [persons, families, children, settings] = await Promise.all([
      q('select * from persons where deleted_at is null order by surname, given'),
      q('select * from families order by created_at'),
      q('select * from family_children'),
      q('select key, value from settings'),
    ]);
    return {
      persons, families, children,
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
      me: req.user,
    };
  });

  // Создать человека (или взять существующего) и сразу связать.
  app.post('/api/persons', { preHandler: need('editor') }, async (req, reply) => {
    const { person, relation, existingId } = req.body || {};
    try {
      return await tx(async (db) => {
        let p;
        if (existingId) {
          p = (await db.q('select * from persons where id = $1 and deleted_at is null', [existingId]))[0];
          if (!p) throw new HttpError(404, 'Человек не найден');
        } else {
          const data = clean(person, PERSON_FIELDS);
          if (!data.given && !data.surname) throw new HttpError(400, 'Укажите имя или фамилию');
          p = await insertPerson(db, data, req.user.id);
        }
        if (relation) await link(db, relation, p.id, req.user.id);
        return p;
      });
    } catch (e) { return send(reply, e); }
  });

  app.patch('/api/persons/:id', { preHandler: need('editor') }, async (req, reply) => {
    const data = clean(req.body, PERSON_FIELDS);
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'Нечего сохранять' });
    try {
      return await tx(async (db) => {
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
        await logChange(db.q, req.user.id, 'person', cur.id, 'update',
          Object.fromEntries(changed.map((k) => [k, cur[k]])), Object.fromEntries(changed.map((k) => [k, next[k]])));
        return next;
      });
    } catch (e) { return send(reply, e); }
  });

  app.delete('/api/persons/:id', { preHandler: need('editor') }, async (req, reply) => {
    try {
      return await tx(async (db) => {
        const cur = (await db.q('select * from persons where id = $1 and deleted_at is null for update', [req.params.id]))[0];
        if (!cur) throw new HttpError(404, 'Человек не найден');
        const links = await snapshotLinks(db, cur.id);
        await db.q('update families set partner1 = null where partner1 = $1', [cur.id]);
        await db.q('update families set partner2 = null where partner2 = $1', [cur.id]);
        await db.q('delete from family_children where child_id = $1', [cur.id]);
        await db.q('update users set person_id = null where person_id = $1', [cur.id]);
        await db.q('update persons set deleted_at = now() where id = $1', [cur.id]);
        await db.q(`delete from families f where partner1 is null and partner2 is null
                    and (select count(*) from family_children c where c.family_id = f.id) < 2`);
        const changeId = await logChange(db.q, req.user.id, 'person', cur.id, 'delete', { person: cur, links }, null);
        return { ok: true, changeId };
      });
    } catch (e) { return send(reply, e); }
  });

  app.post('/api/relations', { preHandler: need('editor') }, async (req, reply) => {
    const { personId, ...relation } = req.body || {};
    try {
      return await tx(async (db) => { await link(db, relation, personId, req.user.id); return { ok: true }; });
    } catch (e) { return send(reply, e); }
  });

  app.patch('/api/families/:id', { preHandler: need('editor') }, async (req, reply) => {
    const data = clean(req.body, FAMILY_FIELDS);
    if (data.kind && !['marriage', 'partners', 'unknown'].includes(data.kind)) data.kind = 'marriage';
    if (data.ended && !['', 'divorce', 'death'].includes(data.ended)) data.ended = '';
    const cols = Object.keys(data);
    if (!cols.length) return reply.code(400).send({ error: 'Нечего сохранять' });
    return tx(async (db) => {
      const cur = (await db.q('select * from families where id = $1', [req.params.id]))[0];
      if (!cur) return reply.code(404).send({ error: 'Семья не найдена' });
      const next = (await db.q(`update families set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1 returning *`, [cur.id, ...cols.map((c) => data[c])]))[0];
      await logChange(db.q, req.user.id, 'family', cur.id, 'update', Object.fromEntries(cols.map((c) => [c, cur[c]])), data);
      return next;
    });
  });

  // Разорвать связь «ребёнок» или «супруг», не удаляя людей.
  app.delete('/api/families/:id/members/:personId', { preHandler: need('editor') }, async (req, reply) => {
    const { id, personId } = req.params;
    return tx(async (db) => {
      const fam = (await db.q('select * from families where id = $1', [id]))[0];
      if (!fam) return reply.code(404).send({ error: 'Семья не найдена' });
      if (fam.partner1 === personId || fam.partner2 === personId) {
        const slot = fam.partner1 === personId ? 'partner1' : 'partner2';
        await db.q(`update families set ${slot} = null where id = $1`, [id]);
        await logChange(db.q, req.user.id, 'family', id, 'unset_partner', { [slot]: personId }, null);
      } else {
        await db.q('delete from family_children where family_id = $1 and child_id = $2', [id, personId]);
        await logChange(db.q, req.user.id, 'family', id, 'remove_child', { child_id: personId }, null);
      }
      await db.q(`delete from families f where id = $1 and partner1 is null and partner2 is null
                  and (select count(*) from family_children c where c.family_id = f.id) < 2`, [id]);
      return { ok: true };
    });
  });

  app.get('/api/persons/:id/history', { preHandler: need('viewer') }, async (req) => {
    return q(
      `select c.id, c.at, c.action, c.before, c.after, c.reverted_by, u.name as user_name
       from changes c left join users u on u.id = c.user_id
       where c.entity_id = $1 order by c.id desc limit 100`,
      [req.params.id],
    );
  });

  app.get('/api/changes', { preHandler: need('viewer') }, async () => {
    return q(
      `select c.id, c.at, c.entity, c.entity_id, c.action, c.after, c.before, c.reverted_by, u.name as user_name
       from changes c left join users u on u.id = c.user_id order by c.id desc limit 50`,
    );
  });

  // Откат правки карточки или удаления.
  app.post('/api/changes/:id/revert', { preHandler: need('editor') }, async (req, reply) => {
    try {
      return await tx(async (db) => {
        const ch = (await db.q('select * from changes where id = $1 for update', [req.params.id]))[0];
        if (!ch) throw new HttpError(404, 'Правка не найдена');
        if (ch.reverted_by) throw new HttpError(409, 'Эта правка уже отменена');
        if (ch.entity !== 'person' || !['update', 'delete'].includes(ch.action)) throw new HttpError(400, 'Эту правку нельзя отменить автоматически');
        let revId;
        if (ch.action === 'update') {
          const cols = Object.keys(ch.before).filter((c) => PERSON_FIELDS.includes(c));
          const cur = (await db.q('select * from persons where id = $1', [ch.entity_id]))[0];
          await db.q(`update persons set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now() where id = $1`,
            [ch.entity_id, ...cols.map((c) => ch.before[c])]);
          revId = await logChange(db.q, req.user.id, 'person', ch.entity_id, 'update',
            Object.fromEntries(cols.map((c) => [c, cur[c]])), Object.fromEntries(cols.map((c) => [c, ch.before[c]])));
        } else {
          await db.q('update persons set deleted_at = null where id = $1', [ch.entity_id]);
          for (const l of ch.before.links.partnerIn) {
            const slot = l.slot === 'partner1' ? 'partner1' : 'partner2';
            await db.q(`update families set ${slot} = $1 where id = $2 and ${slot} is null`, [ch.entity_id, l.family_id]);
          }
          for (const l of ch.before.links.childIn) {
            const famOk = (await db.q('select 1 from families where id = $1', [l.family_id]))[0];
            if (famOk) await db.q('insert into family_children (family_id, child_id, kind) values ($1, $2, $3) on conflict do nothing', [l.family_id, ch.entity_id, l.kind]);
          }
          revId = await logChange(db.q, req.user.id, 'person', ch.entity_id, 'restore', null, { restored_from: ch.id });
        }
        await db.q('update changes set reverted_by = $1 where id = $2', [revId, ch.id]);
        return { ok: true };
      });
    } catch (e) { return send(reply, e); }
  });

  app.put('/api/settings/title', { preHandler: need('owner') }, async (req) => {
    const title = String(req.body?.title || '').trim().slice(0, 120) || 'Наше семейное древо';
    await q('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', ['title', JSON.stringify(title)]);
    return { title };
  });
}
