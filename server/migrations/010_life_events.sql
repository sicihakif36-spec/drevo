-- Лента жизни: свои события человека — учёба, служба, переезд, награда… (src/timeline.js). Вид — из shared/events.js,
-- без проверки в базе: новый вид добавляется без миграции. Дата — в свободной форме, в том числе период «1941–1945».
-- Событие видно у каждого участника (переезд всей семьи). Удаление мягкое.
create table life_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'other',
  date text not null default '',
  place text not null default '', -- простым текстом: исторические названия мест — потом (4.5)
  title text not null default '', -- что именно: учебное заведение, название награды…
  body text not null default '',
  unit text not null default '', -- часть, у службы и войны
  rank text not null default '', -- звание
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table event_persons (
  event_id uuid not null references life_events(id) on delete cascade,
  person_id uuid not null references persons(id),
  primary key (event_id, person_id)
);
create index event_persons_person on event_persons (person_id);

-- Источники и достоверность — и у событий.
alter table citations drop constraint citations_subject_check;
alter table citations add constraint citations_subject_check check (subject in ('person', 'family', 'event'));
alter table fact_quality drop constraint fact_quality_subject_check;
alter table fact_quality add constraint fact_quality_subject_check check (subject in ('person', 'family', 'event'));
