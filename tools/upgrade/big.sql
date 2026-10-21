-- Большое дерево первой версии для замера миграций: 3000 людей, 1500 семей, около 10 000 записей журнала,
-- 2000 фото (из них часть заменены и убраны), 20 пользователей. Применяется к базе со схемой 001_init.sql.
insert into users (name, role) select 'Участник ' || i, case when i = 1 then 'owner' when i < 10 then 'editor' else 'viewer' end from generate_series(1, 20) i;
create temp table u as select id, row_number() over (order by name) as n from users;
insert into sessions (token_hash, user_id) select md5(random()::text) || i, (select id from u where n = 1 + i % 20) from generate_series(1, 40) i;
insert into persons (given, surname, sex, birth_date, living, created_by)
select 'Имя' || i, 'Фамилия' || (i % 300), case when i % 2 = 0 then 'M' else 'F' end, (1850 + i % 170)::text, i % 3 = 0, (select id from u where n = 1 + i % 9)
from generate_series(1, 3000) i;
create temp table p as select id, row_number() over (order by id) as n from persons;
insert into families (partner1, partner2) select (select id from p where n = 2 * i - 1), (select id from p where n = 2 * i) from generate_series(1, 1500) i;
create temp table f as select id, row_number() over (order by id) as n from families;
insert into family_children (family_id, child_id) select (select id from f where n = 1 + i % 1500), (select id from p where n = i) from generate_series(1, 2900) i
on conflict do nothing;
-- Журнал: создание каждого человека, семьи и связи, правки. Записи одного действия — с общим временем, как в транзакции.
insert into changes (at, user_id, entity, entity_id, action, before, after)
select now() - make_interval(secs => 100000 - n), (select id from u where n = 1 + p.n % 9), 'person', p.id, 'create', null, to_jsonb(x) from p join persons x on x.id = p.id;
insert into changes (at, user_id, entity, entity_id, action, before, after)
select now() - make_interval(secs => 100000 - f.n), (select id from u where n = 1 + f.n % 9), 'family', f.id, 'create', null, to_jsonb(x) from f join families x on x.id = f.id;
insert into changes (at, user_id, entity, entity_id, action, before, after)
select now() - make_interval(secs => 50000 - i), (select id from u where n = 1 + i % 9), 'family', fc.family_id, 'add_child', null, jsonb_build_object('child_id', fc.child_id, 'kind', 'birth')
from (select *, row_number() over () as i from family_children) fc;
insert into changes (at, user_id, entity, entity_id, action, before, after)
select now() - make_interval(secs => 20000 - i), (select id from u where n = 1 + i % 9), 'person', (select id from p where n = 1 + i % 3000), 'update',
  '{"notes": ""}', jsonb_build_object('notes', 'заметка ' || i)
from generate_series(1, 1500) i;
-- Фото: 2000 штук, у 300 людей главное заменено, 200 убраны.
insert into media (person_id, mime, bytes) select (select id from p where n = 1 + i % 3000), 'image/jpeg', 50000 from generate_series(1, 2000) i;
update persons x set photo_id = m.id from (select distinct on (person_id) id, person_id from media order by person_id, id desc) m where m.person_id = x.id;
insert into changes (at, user_id, entity, entity_id, action, before, after)
select now() - make_interval(secs => 10000 - row_number() over ()), (select id from u where n = 2), 'person', m.person_id, 'photo', '{"photo_id": null}', jsonb_build_object('photo_id', m.id) from media m;
update persons x set photo_id = null where x.id in (select id from p where n <= 200);
insert into changes (at, user_id, entity, entity_id, action, before, after)
select now() - make_interval(secs => 100 + n), (select id from u where n = 3), 'person', x.id, 'photo', jsonb_build_object('photo_id', m.id), '{"photo_id": null}'
from p x join media m on m.person_id = x.id where x.n <= 200;
select (select count(*) from persons) persons, (select count(*) from changes) changes, (select count(*) from media) media;
