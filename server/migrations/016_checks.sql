-- Проверка дерева (shared/checks.js): отметки «Всё верно» и «Это разные люди». Не правка дерева — поэтому не в журнале
-- changes: не попадают в «Последние правки», ленту, счётчик нового и уведомления. Общие для владельца и участников.
-- key — какая находка (вид и люди), sig — к каким данным относилась отметка: изменились данные — находка снова видна.
create table check_marks (
  key text primary key,
  kind text not null,
  persons uuid[] not null default '{}',
  sig text not null,
  user_id uuid references users(id),
  at timestamptz not null default now()
);

-- Открытые приложения перечитывают дерево (отметки владельцу и участникам приходят вместе с ним). Данных людей в событии нет.
create trigger check_marks_notify after insert or update or delete on check_marks for each statement execute function drevo_notify_tree();
