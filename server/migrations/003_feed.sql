-- Лента: когда человек последний раз её открывал. Новое — действия других людей после этой отметки.
alter table users add column feed_seen_at timestamptz not null default now();

-- Отмены ищутся по reverted_by, новые действия — по времени.
create index changes_reverted_by on changes (reverted_by) where reverted_by is not null;
create index changes_at on changes (at);
