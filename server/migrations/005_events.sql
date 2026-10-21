-- Обновления у всех сразу: после записи в журнал, обсуждение или настройки база шлёт NOTIFY,
-- сервер рассылает его открытым приложениям (src/events.js). Уведомление уходит только после коммита,
-- одинаковые за одну транзакцию база склеивает сама. Данных людей в нём нет: вид события и, для обсуждения, чья карточка.
create function drevo_notify_tree() returns trigger language plpgsql as $$
begin
  perform pg_notify('drevo', '{"kind":"tree"}');
  return null;
end $$;

create function drevo_notify_comments() returns trigger language plpgsql as $$
begin
  perform pg_notify('drevo', json_build_object('kind', 'comments', 'person_id', new.person_id)::text);
  return null;
end $$;

create trigger changes_notify after insert or update on changes for each statement execute function drevo_notify_tree();
create trigger settings_notify after insert or update or delete on settings for each statement execute function drevo_notify_tree();
create trigger comments_notify after insert or update on comments for each row execute function drevo_notify_comments();
