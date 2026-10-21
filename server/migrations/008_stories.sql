-- Истории: воспоминания текстом и записью голоса, общая летопись семьи. Правки пишутся в журнал (src/stories.js).
-- Запись голоса — файл в media с kind 'audio': без отметок людей, поэтому в альбом не попадает;
-- кому её отдавать, решает история, к которой она приложена. Файл не меняется: новая запись — новый файл.
alter table media drop constraint media_kind_check;
alter table media add constraint media_kind_check check (kind in ('photo', 'doc', 'audio'));
alter table media add column duration integer; -- секунд, у записи голоса: в записи с телефона длительности часто нет

create table stories (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  date text not null default '', -- в свободной форме: «около 1945», «лето 1960»
  body text not null default '',
  audio_id uuid references media(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- О ком история: она видна в карточке каждого.
create table story_persons (
  story_id uuid not null references stories(id) on delete cascade,
  person_id uuid not null references persons(id),
  primary key (story_id, person_id)
);
create index story_persons_person on story_persons (person_id);
