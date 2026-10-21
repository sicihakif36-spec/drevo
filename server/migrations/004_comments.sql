-- Обсуждение у карточки человека. Удаление мягкое: deleted_at.
create table comments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id),
  user_id uuid not null references users(id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create index comments_person on comments (person_id, created_at);
create index comments_created on comments (created_at);
