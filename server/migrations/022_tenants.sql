-- Несколько семей на сервере (src/tenants.js, migrations/core/).

-- Ключи уведомлений теперь одни на сервер — в core.push_keys (туда их перенесла migrations/core/001_tenants.sql).
drop table push_keys;

-- В событии обновления — схема семьи (s), чтобы сервер разослал его только её телефонам (src/events.js).
create or replace function drevo_notify_tree() returns trigger language plpgsql as $$
begin
  perform pg_notify('drevo', json_build_object('kind', 'tree', 's', TG_TABLE_SCHEMA)::text);
  return null;
end $$;

create or replace function drevo_notify_comments() returns trigger language plpgsql as $$
begin
  perform pg_notify('drevo', json_build_object('kind', 'comments', 'person_id', new.person_id, 's', TG_TABLE_SCHEMA)::text);
  return null;
end $$;

create or replace function drevo_notify_asks() returns trigger language plpgsql as $$
begin
  perform pg_notify('drevo', json_build_object('kind', 'asks', 's', TG_TABLE_SCHEMA)::text);
  return null;
end $$;

create or replace function drevo_notify_interviews() returns trigger language plpgsql as $$
begin
  perform pg_notify('drevo', json_build_object('kind', 'interviews', 's', TG_TABLE_SCHEMA)::text);
  return null;
end $$;
