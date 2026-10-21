-- Одно действие пользователя (например, «добавить отца») — несколько записей журнала с общим op.
-- Откат отменяет действие целиком. persons — кого касается запись: для истории в карточке человека.
alter table changes add column op uuid;
alter table changes add column persons uuid[] not null default '{}';

-- Старые записи: действие шло одной транзакцией, а now() внутри транзакции один и тот же.
update changes c set op = g.op
from (select at, user_id, gen_random_uuid() as op from changes group by at, user_id) g
where c.at = g.at and c.user_id is not distinct from g.user_id;

update changes set persons = array[entity_id] where entity = 'person';
update changes c set persons = array(
  select distinct y from (
    select unnest(array[(c.after->>'partner1')::uuid, (c.after->>'partner2')::uuid, (c.after->>'child_id')::uuid,
                        (c.before->>'partner1')::uuid, (c.before->>'partner2')::uuid, (c.before->>'child_id')::uuid])
    union all select unnest(array[f.partner1, f.partner2]) from families f where f.id = c.entity_id
    union all select fc.child_id from family_children fc where fc.family_id = c.entity_id
  ) s(y) where y is not null
) where c.entity = 'family';

alter table changes alter column op set default gen_random_uuid();
alter table changes alter column op set not null;
create index changes_op on changes (op);
create index changes_persons on changes using gin (persons);
