-- Защита входа (src/auth.js, src/password.js, routes/users.js).

-- Пароль владельца и участников: scrypt с солью, открытым текстом не хранится. Нет пароля — null.
alter table users add column password_hash text;

-- У сессии свой номер для «Мои устройства» (хеш ключа наружу не отдаём) и адрес входа.
-- pending — вход по ссылке на новом телефоне ждёт пароль: такая сессия не даёт ничего, кроме ввода пароля.
alter table sessions add column id uuid not null default gen_random_uuid();
alter table sessions add constraint sessions_id_key unique (id);
alter table sessions add column pending boolean not null default false;
alter table sessions add column ip text not null default '';
create index sessions_user on sessions (user_id);

-- Входы за 90 дней — владелец видит, кто и с какого устройства вошёл.
-- kind: invite — вход по приглашению, link — по ссылке для нового телефона, fails — пять раз неверный пароль.
create table logins (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('invite', 'link', 'fails')),
  role text not null,
  user_agent text not null default '',
  ip text not null default '',
  session_hash text references sessions(token_hash) on delete set null
);
create index logins_at on logins (at desc);

-- Попытки ввести пароль — в базе, а не в памяти: перезапуск сервера счёт не обнуляет.
create table password_tries (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid not null references users(id) on delete cascade,
  ip text not null default ''
);
create index password_tries_user on password_tries (user_id, at);
create index password_tries_ip on password_tries (ip, at);
