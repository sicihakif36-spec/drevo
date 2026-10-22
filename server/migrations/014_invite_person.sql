-- Кто это в дереве: приглашение сразу связывает вошедшего с его карточкой, и родство считается от него.
alter table invites add column person_id uuid references persons(id) on delete set null;
