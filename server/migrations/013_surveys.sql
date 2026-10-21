-- Анкета для родственника, который приложением не пользуется (src/surveys.js): ссылка на заполнение без входа,
-- ответы сохраняются по ходу, после отправки — только чтение. Токен ссылки — только хешем, как у приглашений.
-- Загрузка в дерево — одно действие в журнале (loaded_op), отменяется из «Последних правок».
create table surveys (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  name text not null, -- для кого: «Тётя Валя»
  person_id uuid references persons(id), -- кто это в дереве, если указали
  answers jsonb not null default '{}',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  opened_at timestamptz,
  saved_at timestamptz, -- последнее сохранение черновика
  submitted_at timestamptz,
  loaded_op uuid, -- действие загрузки в журнале
  loaded_by uuid references users(id),
  loaded_at timestamptz
);

-- Фото из анкеты. Файлы — в survey/ рядом с media/; при загрузке в дерево копируются в альбом.
create table survey_files (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  mime text not null,
  bytes integer not null,
  name text not null default '',
  caption text not null default '',
  thumb boolean not null default false,
  created_at timestamptz not null default now()
);
create index survey_files_survey on survey_files (survey_id);

-- Анкету отправили: открытые приложения перечитывают ленту (данных людей в событии нет).
create trigger surveys_notify after update of submitted_at on surveys for each statement execute function drevo_notify_tree();
