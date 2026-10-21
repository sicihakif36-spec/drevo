// Изменения связей между людьми. Каждое пишется в журнал так, чтобы его можно было отменить (см. revert.js).
import { logChange } from './changes.js';

export const PERSON_FIELDS = ['sex', 'surname', 'given', 'patronymic', 'birth_surname', 'living', 'birth_date', 'birth_place', 'death_date', 'death_place', 'burial_place', 'occupation', 'notes'];
export const FAMILY_FIELDS = ['kind', 'start_date', 'place', 'end_date', 'ended'];
export const SLOTS = ['partner1', 'partner2'];

// Ошибку с кодом < 500 общий обработчик отдаёт пользователю как есть.
export class HttpError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode; }
}

export async function alive(db, id) {
  return Boolean((await db.q('select 1 from persons where id = $1 and deleted_at is null', [id]))[0]);
}

// Кто сейчас в семье: для подписи правки в журнале и для истории каждого из них.
async function members(db, familyId) {
  const f = (await db.q('select partner1, partner2 from families where id = $1', [familyId]))[0];
  const kids = await db.q('select child_id from family_children where family_id = $1 order by child_id', [familyId]);
  return { partners: f ? [f.partner1, f.partner2].filter(Boolean) : [], children: kids.map((k) => k.child_id) };
}
const everyone = (m) => [...m.partners, ...m.children];

export async function newFamily(db, userId, p1, p2) {
  const f = (await db.q('insert into families (partner1, partner2) values ($1, $2) returning *', [p1, p2]))[0];
  await logChange(db, userId, 'family', f.id, 'create', null, { family: f, children: [] }, [p1, p2]);
  return f;
}

export async function addChild(db, userId, familyId, childId, kind = 'birth') {
  await db.q('insert into family_children (family_id, child_id, kind) values ($1, $2, $3) on conflict do nothing', [familyId, childId, kind]);
  const m = await members(db, familyId);
  return logChange(db, userId, 'family', familyId, 'add_child', null, { child_id: childId, kind, ...m }, everyone(m));
}

// null, если такого ребёнка в семье нет.
export async function removeChild(db, userId, familyId, childId) {
  const m = await members(db, familyId);
  const row = (await db.q('delete from family_children where family_id = $1 and child_id = $2 returning kind', [familyId, childId]))[0];
  if (!row) return null;
  return logChange(db, userId, 'family', familyId, 'remove_child', { child_id: childId, kind: row.kind, ...m }, null, everyone(m));
}

export async function setPartner(db, userId, familyId, slot, personId) {
  await db.q(`update families set ${slot} = $1 where id = $2`, [personId, familyId]);
  const m = await members(db, familyId);
  return logChange(db, userId, 'family', familyId, 'set_partner', null, { [slot]: personId, ...m }, everyone(m));
}

export async function unsetPartner(db, userId, familyId, slot, personId) {
  const m = await members(db, familyId);
  await db.q(`update families set ${slot} = null where id = $1`, [familyId]);
  return logChange(db, userId, 'family', familyId, 'unset_partner', { [slot]: personId, ...m }, null, everyone(m));
}

// Убрать семью целиком, сохранив снимок: откат вернёт её с тем же id, супругами и детьми.
export async function dropFamily(db, userId, f) {
  const children = await db.q('select child_id, kind from family_children where family_id = $1 order by child_id', [f.id]);
  await db.q('delete from families where id = $1', [f.id]);
  return logChange(db, userId, 'family', f.id, 'drop', { family: f, children }, null,
    [f.partner1, f.partner2, ...children.map((c) => c.child_id)]);
}

export async function restoreFamily(db, userId, { family: f, children }) {
  const live = async (id) => (id && (await alive(db, id)) ? id : null);
  const p1 = await live(f.partner1);
  const p2 = await live(f.partner2);
  const ok = (await db.q(
    `insert into families (id, partner1, partner2, kind, start_date, place, end_date, ended, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do nothing returning id`,
    [f.id, p1, p2, f.kind, f.start_date, f.place ?? '', f.end_date, f.ended, f.created_at],
  ))[0];
  if (!ok) throw new HttpError(409, 'Эта семья уже есть в дереве');
  const back = [];
  for (const c of children) {
    if (!(await alive(db, c.child_id))) continue;
    await db.q('insert into family_children (family_id, child_id, kind) values ($1, $2, $3)', [f.id, c.child_id, c.kind]);
    back.push(c);
  }
  const family = { ...f, partner1: p1, partner2: p2 };
  return logChange(db, userId, 'family', f.id, 'create', null, { family, children: back }, [p1, p2, ...back.map((c) => c.child_id)]);
}

// Семья без супругов и меньше чем с двумя детьми ничего не связывает — убираем.
export async function dropEmpty(db, userId, familyIds) {
  for (const id of new Set(familyIds)) {
    const f = (await db.q('select * from families where id = $1 and partner1 is null and partner2 is null', [id]))[0];
    if (!f) continue;
    const n = (await db.q('select count(*)::int as n from family_children where family_id = $1', [id]))[0].n;
    if (n < 2) await dropFamily(db, userId, f);
  }
}

export async function deletePerson(db, userId, id) {
  const cur = (await db.q('select * from persons where id = $1 and deleted_at is null for update', [id]))[0];
  if (!cur) throw new HttpError(404, 'Человек не найден');
  const partnerIn = await db.q(
    `select id as family_id, case when partner1 = $1 then 'partner1' else 'partner2' end as slot from families where partner1 = $1 or partner2 = $1`, [id]);
  const childIn = await db.q('select family_id, kind from family_children where child_id = $1', [id]);
  const users = (await db.q('update users set person_id = null where person_id = $1 returning id', [id])).map((u) => u.id);
  await db.q('update families set partner1 = null where partner1 = $1', [id]);
  await db.q('update families set partner2 = null where partner2 = $1', [id]);
  await db.q('delete from family_children where child_id = $1', [id]);
  await db.q('update persons set deleted_at = now() where id = $1', [id]);
  const changeId = await logChange(db, userId, 'person', id, 'delete', { person: cur, links: { partnerIn, childIn }, users }, null);
  await dropEmpty(db, userId, [...partnerIn, ...childIn].map((l) => l.family_id));
  return changeId;
}

export async function restorePerson(db, userId, id, before) {
  const p = (await db.q('update persons set deleted_at = null where id = $1 and deleted_at is not null returning id', [id]))[0];
  if (!p) throw new HttpError(409, 'Этот человек уже в дереве');
  for (const l of before.links.partnerIn) {
    const slot = l.slot === 'partner1' ? 'partner1' : 'partner2';
    await db.q(`update families set ${slot} = $1 where id = $2 and ${slot} is null`, [id, l.family_id]);
  }
  for (const l of before.links.childIn) {
    await db.q(
      `insert into family_children (family_id, child_id, kind) select $1, $2, $3
       where exists (select 1 from families where id = $1) on conflict do nothing`, [l.family_id, id, l.kind]);
  }
  if (before.users?.length) await db.q('update users set person_id = $1 where id = any($2) and person_id is null', [id, before.users]);
  return logChange(db, userId, 'person', id, 'restore', null, {});
}

async function parentFamily(db, childId) {
  return (await db.q(
    'select f.* from family_children c join families f on f.id = c.family_id where c.child_id = $1 order by f.created_at limit 1',
    [childId],
  ))[0];
}

// Связать человека newId с человеком to отношением type.
export async function link(db, userId, { to, type, familyId }, newId) {
  if (!(await alive(db, to)) || !(await alive(db, newId))) throw new HttpError(404, 'Человек не найден');
  if (to === newId) throw new HttpError(400, 'Нельзя связать человека с самим собой');
  if (type === 'father' || type === 'mother' || type === 'parent') {
    const fam = await parentFamily(db, to);
    if (!fam) {
      const f = await newFamily(db, userId, newId, null);
      await addChild(db, userId, f.id, to);
      return;
    }
    if (fam.partner1 === newId || fam.partner2 === newId) throw new HttpError(409, 'Этот человек уже указан родителем');
    const slot = !fam.partner1 ? 'partner1' : !fam.partner2 ? 'partner2' : null;
    if (!slot) throw new HttpError(409, 'У этого человека уже указаны оба родителя');
    await setPartner(db, userId, fam.id, slot, newId);
    return;
  }
  if (type === 'spouse') {
    const empty = (await db.q('select * from families where (partner1 = $1 and partner2 is null) or (partner2 = $1 and partner1 is null) limit 1', [to]))[0];
    if (empty) await setPartner(db, userId, empty.id, empty.partner1 ? 'partner2' : 'partner1', newId);
    else await newFamily(db, userId, to, newId);
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
      fid = fams[0]?.id || (await newFamily(db, userId, to, null)).id;
    }
    await addChild(db, userId, fid, newId);
    return;
  }
  if (type === 'sibling') {
    let fam = await parentFamily(db, to);
    if (!fam) {
      fam = await newFamily(db, userId, null, null);
      await addChild(db, userId, fam.id, to);
    }
    await addChild(db, userId, fam.id, newId);
    return;
  }
  throw new HttpError(400, 'Неизвестный тип связи');
}
