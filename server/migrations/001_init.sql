create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  person_id uuid,
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table invites (
  token_hash text primary key,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  label text not null default '',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references users(id),
  for_user uuid references users(id)
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text not null default ''
);

create table persons (
  id uuid primary key default gen_random_uuid(),
  sex char(1) not null default 'U' check (sex in ('M', 'F', 'U')),
  surname text not null default '',
  given text not null default '',
  patronymic text not null default '',
  birth_surname text not null default '',
  living boolean not null default true,
  birth_date text not null default '',
  birth_place text not null default '',
  death_date text not null default '',
  death_place text not null default '',
  burial_place text not null default '',
  occupation text not null default '',
  notes text not null default '',
  photo_id uuid,
  version integer not null default 1,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table families (
  id uuid primary key default gen_random_uuid(),
  partner1 uuid references persons(id),
  partner2 uuid references persons(id),
  kind text not null default 'marriage' check (kind in ('marriage', 'partners', 'unknown')),
  start_date text not null default '',
  end_date text not null default '',
  ended text not null default '' check (ended in ('', 'divorce', 'death')),
  created_at timestamptz not null default now()
);

create table family_children (
  family_id uuid not null references families(id) on delete cascade,
  child_id uuid not null references persons(id),
  kind text not null default 'birth' check (kind in ('birth', 'adopted', 'foster', 'step')),
  primary key (family_id, child_id)
);

create table media (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references persons(id),
  mime text not null,
  bytes integer not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table changes (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references users(id),
  entity text not null,
  entity_id uuid not null,
  action text not null,
  before jsonb,
  after jsonb,
  reverted_by bigint
);

create index changes_entity on changes (entity_id, id desc);
create index family_children_child on family_children (child_id);
create index families_p1 on families (partner1);
create index families_p2 on families (partner2);

alter table users add constraint users_person_fk foreign key (person_id) references persons(id);

create table settings (
  key text primary key,
  value jsonb not null
);
insert into settings (key, value) values ('title', '"Наше семейное древо"');
