-- Второе написание имени (shared/names.js, ALT_FIELDS): основное — как в семейной схеме (часто по-татарски),
-- второе — как в документах (по-русски) или латиницей. Правится как остальные поля карточки, через журнал и откат.
alter table persons
  add column alt_surname text not null default '',
  add column alt_given text not null default '',
  add column alt_patronymic text not null default '';
