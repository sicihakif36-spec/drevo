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

// Записей одного действия отдаём не больше ENTRIES: загрузка из файла — это тысячи записей, а показывается она сводкой.
// В истории человека (person) — ещё и все записи о нём. total — сколько записей в действии всего.
export const ENTRIES = 300;

// Записи исследования (src/research.js) видят только владелец и участники: в них бывают сведения о живых.
// В ленту и уведомления они не попадают никому — это рабочие заметки, а не новости дерева.
export const RESEARCH = ['research', 'research_note'];
export const canResearch = (user) => ['owner', 'editor'].includes(user?.role);

// Последние действия целиком, новые сверху. id действия — номер его первой записи. op — только это действие.
// research: false — без записей исследования (действие только из них не показывается совсем).
export async function listOps({ person = null, limit = 50, standing = false, op = null, research = true } = {}) {
  const rows = await q(
    `with ops as (
       select op, max(id) as last from changes c where ($1::uuid is null or $1 = any(persons)) and ($3::uuid is null or op = $3)
         and ($5 or c.entity <> all($6))
       group by op ${standing ? `having ${STANDS}` : ''} order by last desc limit $2
     ), numbered as (
       select c.*, row_number() over (partition by c.op order by c.id) as n, count(*) over (partition by c.op) as total
       from changes c join ops o on o.op = c.op where $5 or c.entity <> all($6)
     )
     select c.id, c.op, c.at, c.entity, c.entity_id, c.action, c.before, c.after, c.persons, c.reverted_by, c.user_id, c.total,
       u.name as user_name
     from numbered c join ops o on o.op = c.op left join users u on u.id = c.user_id
     where c.n <= $4 or $1 = any(c.persons)
     order by o.last desc, c.id`,
    [person, limit, op, ENTRIES, research, RESEARCH],
  );
  const out = [];
  for (const r of rows) {
    let op = out.at(-1);
    if (op?.op !== r.op) {
      out.push((op = { op: r.op, id: r.id, at: r.at, user_id: r.user_id, user_name: r.user_name, reverted: false, total: Number(r.total), entries: [] }));
    }
    if (r.reverted_by) op.reverted = true;
    op.entries.push({ id: r.id, entity: r.entity, entity_id: r.entity_id, action: r.action, before: r.before, after: r.after, persons: r.persons });
  }
  return out;
}

// Сколько действий и комментариев других людей появилось после того, как человек открывал ленту.
// hidden — люди, чьи обсуждения ему не видны (см. privateIds); surveys — считать и отправленные анкеты (владельцу и участникам);
// asks — вопросы ему и ответы на его вопросы (всем, кроме гостей).
export async function countNew(userId, hidden = [], surveys = false, asks = false) {
  const rows = await q(
    `with seen as (select feed_seen_at as at from users where id = $1)
     select (select count(*) from (
       select c.op from changes c
       where c.at > (select at from seen) and c.user_id is distinct from $1 and c.entity <> all($4)
       group by c.op having ${STANDS}
     ) s) + (select count(*) from comments c join persons p on p.id = c.person_id
       where c.created_at > (select at from seen) and c.user_id <> $1
         and c.deleted_at is null and p.deleted_at is null and not (c.person_id = any($2::uuid[]))
     ) + (select count(*) from surveys s where $3 and s.submitted_at > (select at from seen) and s.revoked_at is null
     ) + (select count(*) from asks a join persons p on p.id = a.person_id
       where $5 and a.deleted_at is null and p.deleted_at is null and (
         (a.created_by = $1 and a.answered_at > (select at from seen))
         or (a.to_user = $1 and a.created_at > (select at from seen) and a.answered_at is null and a.revoked_at is null))
     ) as n`,
    [userId, hidden, surveys, RESEARCH, asks],
  );
  return Number(rows[0].n);
}
