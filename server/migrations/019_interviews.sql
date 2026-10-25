-- Интервью голосом (routes/interviews.js, shared/interview.js): вопросы о жизни человека по одному, на каждый — запись голоса.
-- Черновик — не правка дерева, как и вопросы родным: в журнал, ленту и уведомления не идёт; удаление мягкое.
-- В дерево интервью попадает одним действием «Сохранить в истории» (saved_op): каждый ответ — история с голосом, фото — в альбом.
-- Ссылка без входа (token_hash — только хеш, как у вопросов родным) — для того, кто отвечает сам на своём телефоне.
create table interviews (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id), -- у кого берут интервью
  about text not null, -- как записано при создании; страничка по ссылке его не показывает
  topics text[] not null default '{}',
  -- [{ key, topic, text }] — вопросы с именами родных, как их подставили при создании; свои вопросы дописываются
  questions jsonb not null default '[]',
  pos integer not null default 0, -- на каком вопросе остановились
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  to_name text not null default '', -- для кого ссылка (видят владелец и участники)
  token_hash text unique,
  expires_at timestamptz,
  opened_at timestamptz,
  revoked_at timestamptz,
  saved_op uuid, -- действие «Сохранить в истории»; отменили его — черновик можно сохранить снова
  deleted_at timestamptz
);
create index interviews_person on interviews (person_id) where deleted_at is null;

-- Ответ на вопрос: пропущен ли и заметка. Запись голоса и фото — в interview_files.
create table interview_answers (
  interview_id uuid not null references interviews(id) on delete cascade,
  qkey text not null,
  skipped boolean not null default false,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (interview_id, qkey)
);

-- Файлы ответа — в interview/ рядом с media/; при сохранении в дерево копируются в историю и альбом.
create table interview_files (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references interviews(id) on delete cascade,
  qkey text not null,
  kind text not null check (kind in ('photo', 'audio')),
  mime text not null,
  bytes integer not null,
  name text not null default '',
  thumb boolean not null default false,
  duration integer,
  created_at timestamptz not null default now()
);
create index interview_files_q on interview_files (interview_id, qkey);

-- История из интервью: из какого и каким по счёту ответом. В карточке такие истории собраны вместе: «Интервью 24 октября: 12 ответов».
alter table stories add column interview_id uuid references interviews(id);
alter table stories add column interview_no integer;
create index stories_interview on stories (interview_id) where interview_id is not null;

-- Открытые приложения перечитывают интервью. В событии нет ни людей, ни текста; гостям его не шлют (src/events.js).
create function drevo_notify_interviews() returns trigger language plpgsql as $$
begin
  perform pg_notify('drevo', '{"kind":"interviews"}');
  return null;
end $$;
create trigger interviews_notify after insert or update on interviews for each statement execute function drevo_notify_interviews();
create trigger interview_answers_notify after insert or update or delete on interview_answers for each statement execute function drevo_notify_interviews();
create trigger interview_files_notify after insert or delete on interview_files for each statement execute function drevo_notify_interviews();
