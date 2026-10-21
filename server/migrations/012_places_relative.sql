-- Справочник мест (src/places.js): место по старому делению и как это сейчас. В карточках людей, браков и событий
-- место остаётся простым текстом; место из справочника записывается туда полным названием (title, см. shared/places.js),
-- по нему карточка места и находит людей. Удаление мягкое.
create table places (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'village', -- вид населённого пункта, из shared/places.js
  name text not null default '',
  volost text not null default '',
  uezd text not null default '',
  gubernia text not null default '',
  country text not null default '',
  now text not null default '', -- как это сейчас: «Старицкий район, Тверская область»
  note text not null default '',
  title text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Место для сравнения: без разницы в регистре, пробелах и «ё» (как placeKey в shared/places.js).
create function place_key(t text) returns text language sql immutable as $$
  select lower(translate(regexp_replace(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'), '^ | $', '', 'g'), 'Ёё', 'Ее'))
$$;
create unique index places_title on places (place_key(title)) where deleted_at is null;

-- Роль «Родственник»: видит всё, как участник, но дерево не правит; обсуждать может.
alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('owner', 'editor', 'relative', 'viewer'));
alter table invites drop constraint invites_role_check;
alter table invites add constraint invites_role_check check (role in ('owner', 'editor', 'relative', 'viewer'));
