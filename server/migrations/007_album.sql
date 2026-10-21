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

alter table media drop column person_id;
