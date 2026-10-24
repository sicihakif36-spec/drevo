-- «Спросить у родных» (src/asks.js): вопрос о человеке конкретному родственнику и его ответ.
-- Это не правка дерева, как и обсуждение: в журнал не пишется, в «Последние правки» не идёт.
-- Отдельная таблица, а не сообщение в comments: обсуждение видят гости (у ушедших), о нём сообщают всем
-- и оно идёт в ленту всем, а вопрос — только спросившему, адресату и тем, кто ведёт дерево.
-- Кому: to_user — тот, кто пользуется приложением; иначе ссылка без входа (token_hash — только хеш, как у анкет), to_name — для кого.
create table asks (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id), -- о ком
  about text not null, -- о ком, как написано в вопросе: страничка по ссылке не берёт ничего из дерева
  question text not null,
  field text not null default '', -- поле карточки, о котором вопрос (birth_date…): «Дописать в карточку» откроет его
  research_id uuid references research_questions(id), -- вопрос исследования: ответ можно записать в его журнал поиска
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  to_user uuid references users(id),
  to_name text not null default '',
  token_hash text unique,
  expires_at timestamptz,
  opened_at timestamptz,
  reminded_at timestamptz,
  answer text,
  answered_at timestamptz,
  answered_by uuid references users(id),
  -- Что сделали с ответом: действия в журнале (отменяются из «Последних правок»).
  story_op uuid,
  note_op uuid,
  closed_at timestamptz,
  revoked_at timestamptz,
  deleted_at timestamptz,
  check (to_user is not null or token_hash is not null)
);
create index asks_person on asks (person_id, created_at);
create index asks_to on asks (to_user) where to_user is not null;

-- Фото и запись голоса к ответу. Файлы — в ask/ рядом с media/; «Сохранить как историю» копирует их в альбом и историю.
create table ask_files (
  id uuid primary key default gen_random_uuid(),
  ask_id uuid not null references asks(id) on delete cascade,
  kind text not null check (kind in ('photo', 'audio')),
  mime text not null,
  bytes integer not null,
  name text not null default '',
  thumb boolean not null default false,
  duration integer,
  created_at timestamptz not null default now()
);
create index ask_files_ask on ask_files (ask_id);

-- Открытые приложения перечитывают вопросы. В событии нет ни людей, ни текста; гостям его не шлют (src/events.js).
create function drevo_notify_asks() returns trigger language plpgsql as $$
begin
  perform pg_notify('drevo', '{"kind":"asks"}');
  return null;
end $$;
create trigger asks_notify after insert or update on asks for each statement execute function drevo_notify_asks();
