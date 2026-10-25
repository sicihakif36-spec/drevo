-- Исследование (src/research.js): вопросы поиска у человека — «что хотим узнать» — и записи по ходу: где искали, что нашли.
-- Видят и ведут только владелец и участники: в записях бывают сведения о живых. Удаление мягкое, правки — через журнал
-- (entity 'research' и 'research_note'), поэтому любое действие отменяется из «Последних правок».
create table research_questions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id),
  title text not null,
  status text not null default 'open' check (status in ('open', 'found', 'notfound')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index research_questions_person on research_questions (person_id);

create table research_notes (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references research_questions(id),
  result text not null default '' check (result in ('', 'found', 'notfound')), -- нашли, не нашли или просто заметка
  place text not null default '', -- где искали: сайт или архив
  url text not null default '',
  ref text not null default '', -- шифр: фонд, опись, дело, лист
  body text not null default '', -- что нашли или что не нашли
  op uuid, -- загрузка из ответа помощника: действие в журнале
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index research_notes_question on research_notes (question_id, created_at);
