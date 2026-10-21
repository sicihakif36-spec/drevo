-- Альбом: у человека несколько фото и сканов документов, один файл можно отметить у нескольких людей.
-- Главное фото по-прежнему persons.photo_id. Удаление мягкое: файл остаётся на диске, удаление отменяется.
alter table media add column kind text not null default 'photo' check (kind in ('photo', 'doc'));
alter table media add column caption text not null default '';
alter table media add column date text not null default '';
alter table media add column name text not null default ''; -- имя файла с телефона: для списка документов
alter table media add column thumb boolean not null default false; -- есть уменьшенная копия media/<id>.thumb
alter table media add column deleted_at timestamptz;

-- Кто на фото или в документе.
create table media_persons (
  media_id uuid not null references media(id) on delete cascade,
  person_id uuid not null references persons(id),
  primary key (media_id, person_id)
);
create index media_persons_person on media_persons (person_id);

-- Старые фото — в альбом того, кому их загрузили, включая заменённые другим фото.
insert into media_persons (media_id, person_id) select id, person_id from media where person_id is not null;

-- Недогруженное и фото, загрузку которого отменили, в альбом не попадает (файлы остаются на диске).
update media m set deleted_at = now()
where m.bytes = 0 or m.person_id is null
   or (not exists (select 1 from persons p where p.photo_id = m.id)
       and exists (select 1 from changes c where c.entity = 'person' and c.action = 'photo'
                   and c.after->>'photo_id' = m.id::text and c.reverted_by is not null));

-- Фото, которое убрали с карточки кнопкой «убрать фото» (и оно ничьё не главное), — в альбом сразу удалённым.
-- Удаление пишется в журнал отдельным действием того, кто убрал фото, и в то же время: «Вернуть» возвращает фото в альбом.
create temp table album_removed on commit drop as
select distinct on (m.id) m.id, m.person_id, c.user_id, c.at
from media m join changes c on c.entity = 'person' and c.action = 'photo' and c.reverted_by is null
  and c.before->>'photo_id' = m.id::text and c.after->>'photo_id' is null
where m.deleted_at is null and not exists (select 1 from persons p where p.photo_id = m.id)
order by m.id, c.id desc;

update media m set deleted_at = r.at from album_removed r where r.id = m.id;
insert into changes (op, at, user_id, entity, entity_id, action, before, after, persons)
select gen_random_uuid(), r.at, r.user_id, 'media', r.id, 'delete',
  jsonb_build_object('kind', 'photo', 'name', '', 'caption', '', 'date', ''), null, array[r.person_id]
from album_removed r order by r.at;
-- Эти записи — не новые правки: в сводку уведомлений не попадают.
update push_digests d set last_change = x.last
from (select user_id, max(id) as last from changes where user_id is not null group by user_id) x
where x.user_id = d.user_id and not exists (
  select 1 from changes c where c.user_id = d.user_id and c.id > d.last_change
  and not (c.entity = 'media' and c.action = 'delete' and c.entity_id in (select id from album_removed)));

alter table media drop column person_id;
