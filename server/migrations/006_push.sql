-- Уведомления на телефон (Web Push, src/push.js).

-- Ключи VAPID: создаются при первом запуске. Не в settings: settings целиком уходят всем в GET /api/tree.
create table push_keys (
  id integer primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

-- Подписка телефона живёт, пока жив вход с него: выход и отключение человека удаляют сессии, а с ними и подписки.
create table push_subs (
  endpoint text primary key,
  user_id uuid not null references users(id) on delete cascade,
  session_hash text not null references sessions(token_hash) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subs_user on push_subs (user_id);

-- О чём сообщать: у каждого своё, по умолчанию всё включено.
alter table users add column notify_comments boolean not null default true;
alter table users add column notify_edits boolean not null default true;
alter table users add column notify_dates boolean not null default true;

-- Что уже отправлено: отметка ставится до отправки, второй раз то же не уйдёт, даже после перезапуска.
-- kind 'comment' — key = id комментария, 'dates' — key = «день:кому».
create table push_sent (
  kind text not null,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (kind, key)
);

-- Сводка правок: до какой записи журнала правки автора уже разосланы.
create table push_digests (
  user_id uuid primary key references users(id) on delete cascade,
  last_change bigint not null,
  sent_at timestamptz not null default now()
);
-- Старые правки — не новость.
insert into push_digests (user_id, last_change)
select user_id, max(id) from changes where user_id is not null group by user_id;
