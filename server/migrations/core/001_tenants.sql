-- Несколько семей на одном сервере (src/tenants.js). У каждой семьи — своё дерево и свои люди, приглашения, входы:
-- её данные лежат в своей схеме базы с теми же таблицами (главная семья — public, остальные — f_<номер>).
-- Здесь, в схеме core, — только общее для сервера. Миграции этой папки применяются один раз, а не к каждой семье.

-- Семьи. Название дерева живёт в settings семьи; здесь — каким его назвали при создании.
-- quota_mb — предел места для фото, документов и записей голоса (null — без предела); closed_at — вход закрыт владельцем сервера.
create table core.tenants (
  id text primary key check (id ~ '^[a-z0-9]{1,16}$'),
  schema text not null unique check (schema = 'public' or schema ~ '^f_[a-z0-9]{1,16}$'),
  main boolean not null default false,
  title text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null default '',
  link_label text not null default '',
  quota_mb integer check (quota_mb > 0),
  closed_at timestamptz
);
create unique index tenants_one_main on core.tenants (main) where main;
insert into core.tenants (id, schema, main) values ('main', 'public', true);

-- Ссылки «Завести своё дерево»: их делают владельцы главной семьи. Кто открыл — владелец новой пустой семьи.
create table core.tenant_links (
  token_hash text primary key,
  label text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  tenant_id text references core.tenants(id) on delete set null
);

-- Ключи уведомлений (VAPID) — одни на сервер: у телефона одна подписка, в скольких бы семьях он ни был.
-- Ключи главной семьи переезжают сюда как есть, иначе её телефоны перестали бы получать уведомления.
create table core.push_keys (
  id integer primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);
do $$
begin
  if to_regclass('public.push_keys') is not null then
    insert into core.push_keys (public_key, private_key, created_at) select public_key, private_key, created_at from public.push_keys;
  end if;
end $$;
