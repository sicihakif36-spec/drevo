-- Напоминание о семейном архиве (src/push.js, routes/archive.js): владелец раз в месяц скачивает «Скачать всё» и хранит у себя.
-- Отметка — только о скачивании, дошедшем до конца: прерванное не считается. Не в settings: они уходят всем в GET /api/tree.
create table archive_downloads (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  at timestamptz not null default now(),
  bytes bigint not null default 0
);
create index archive_downloads_at on archive_downloads (at);

-- У каждого владельца своё: переключатель в «Уведомлениях», «Напомнить позже» (до этого времени — ни плашки, ни уведомления)
-- и когда в последний раз напомнили на телефон (не чаще раза в неделю).
alter table users add column notify_archive boolean not null default true;
alter table users add column archive_later timestamptz;
alter table users add column archive_reminded_at timestamptz;
