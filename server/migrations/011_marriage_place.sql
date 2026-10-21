-- Место брака (венчания, регистрации): простым текстом, как другие места.
alter table families add column place text not null default '';
