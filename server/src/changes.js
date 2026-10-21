import { q } from './db.js';

// Запись в журнал правок. db.op — общий номер всех записей одного действия (см. tx).
// persons — кого касается запись, чтобы показать её в истории каждого из них.
export async function logChange(db, userId, entity, entityId, action, before, after, persons = entity === 'person' ? [entityId] : []) {
  const rows = await db.q(
    `insert into changes (op, user_id, entity, entity_id, action, before, after, persons)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8) returning id`,
    [db.op || null, userId, entity, entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
      [...new Set(persons.filter(Boolean))]],
  );
  return rows[0].id;
}

// Действие осталось в силе: само не отменено и не отменяет другое (у отменённых reverted_by = id первой записи отмены).
// Для ленты: пара «сделал — отменил» — не новость.
export const STANDS = `bool_and(c.reverted_by is null)
  and not exists (select 1 from changes x join changes r on r.reverted_by = x.id where x.op = c.op)`;

// Последние действия целиком, новые сверху. id действия — номер его первой записи.
export async function listOps({ person = null, limit = 50, standing = false } = {}) {
  const rows = await q(
    `with ops as (
       select op, max(id) as last from changes c where $1::uuid is null or $1 = any(persons)
       group by op ${standing ? `having ${STANDS}` : ''} order by last desc limit $2
     )
     select c.id, c.op, c.at, c.entity, c.entity_id, c.action, c.before, c.after, c.persons, c.reverted_by, c.user_id, u.name as user_name
     from changes c join ops o on o.op = c.op left join users u on u.id = c.user_id
     order by o.last desc, c.id`,
    [person, limit],
  );
  const out = [];
  for (const r of rows) {
    let op = out.at(-1);
    if (op?.op !== r.op) out.push((op = { op: r.op, id: r.id, at: r.at, user_id: r.user_id, user_name: r.user_name, reverted: false, entries: [] }));
    if (r.reverted_by) op.reverted = true;
    op.entries.push({ id: r.id, entity: r.entity, entity_id: r.entity_id, action: r.action, before: r.before, after: r.after, persons: r.persons });
  }
  return out;
}

// Сколько действий и комментариев других людей появилось после того, как человек открывал ленту.
// hidden — люди, чьи обсуждения ему не видны (см. privateIds).
export async function countNew(userId, hidden = []) {
  const rows = await q(
    `with seen as (select feed_seen_at as at from users where id = $1)
     select (select count(*) from (
       select c.op from changes c
       where c.at > (select at from seen) and c.user_id is distinct from $1
       group by c.op having ${STANDS}
     ) s) + (select count(*) from comments c join persons p on p.id = c.person_id
       where c.created_at > (select at from seen) and c.user_id <> $1
         and c.deleted_at is null and p.deleted_at is null and not (c.person_id = any($2::uuid[]))
     ) as n`,
    [userId, hidden],
  );
  return Number(rows[0].n);
}
