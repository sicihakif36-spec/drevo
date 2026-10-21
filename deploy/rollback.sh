#!/usr/bin/env bash
# Откат последнего обновления: прежний выпуск кода и база из копии, снятой установщиком перед обновлением.
#   sudo bash /srv/drevo/current/deploy/rollback.sh
# Что сделано после обновления (новые люди, правки, фото в базе), пропадёт из дерева, но не насовсем:
# перед откатом снимается копия нынешней базы. Файлы фото и записей не удаляются. «Мы рядом» не затрагивается.
set -euo pipefail
APP=/srv/drevo
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

say() { printf '\n== %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }
[ -f "$APP/last-update" ] || { echo "Нет сведений о последнем обновлении ($APP/last-update): откатывать нечего."; exit 1; }
PREV="" DUMP=""
# shellcheck source=/dev/null
. "$APP/last-update"
[ -d "$PREV" ] || { echo "Прежний выпуск не найден: $PREV"; exit 1; }
[ -s "$DUMP" ] || { echo "Копия базы перед обновлением не найдена или пустая: $DUMP"; exit 1; }
CUR=$(readlink -f "$APP/current")
compose() { docker compose -p drevo --env-file "$APP/.env" -f "$1/deploy/docker-compose.yml" "${@:2}"; }

echo "Сейчас стоит:      $CUR"
echo "Вернётся выпуск:   $PREV"
echo "База вернётся из:  $DUMP ($(du -h "$DUMP" | cut -f1), снята $(date -r "$DUMP" '+%d.%m.%Y %H:%M'))"
echo "Всё, что внесли в дерево после этого времени, из дерева пропадёт (останется в копии нынешней базы)."
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Откатить? Напишите ДА (или yes): " answer
  case "$answer" in ДА|Да|да|yes|YES) ;; *) echo "Отменено, ничего не менялось."; exit 1 ;; esac
fi

say "Копия нынешней базы"
compose "$CUR" up -d --wait db
NOW="$APP/backups/drevo-$STAMP-before-rollback.dump"
(umask 077; compose "$CUR" exec -T db pg_dump -U drevo -Fc drevo > "$NOW")
compose "$CUR" exec -T db pg_restore -l < "$NOW" >/dev/null || { echo "Копия нынешней базы не читается, откат остановлен: $NOW"; exit 1; }
echo "Копия: $NOW"

say "Останавливаю приложение"
compose "$CUR" stop app

say "База из копии перед обновлением"
# Одной транзакцией: при ошибке база остаётся как была.
{
  echo 'set client_min_messages = warning;'
  echo 'begin;'
  echo 'drop schema public cascade;'
  echo 'create schema public;'
  compose "$CUR" exec -T db pg_restore --no-owner -f - < "$DUMP"
  echo 'commit;'
} | compose "$CUR" exec -T db psql -q -v ON_ERROR_STOP=1 -U drevo -d drevo >/dev/null || {
  echo "База не восстановилась, она осталась как была. Приложение запускается снова: $CUR"
  compose "$CUR" start app
  exit 1
}

say "Прежний выпуск: $PREV"
ln -sfn "$PREV" "$APP/current"
ln -sfn "$APP/.env" "$PREV/deploy/.env"
compose "$PREV" up -d --build
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:8095/api/health >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS http://127.0.0.1:8095/api/health >/dev/null || { compose "$PREV" logs --tail 50 app; echo "Прежний выпуск не запустился"; exit 1; }

say "Nginx прежнего выпуска"
CONF=/etc/nginx/sites-available/drevo.conf
cp -p "$CONF" "$CONF.before-$STAMP"
cp "$PREV/deploy/nginx/drevo.conf" "$CONF"
if nginx -t; then
  systemctl reload nginx
  rm -f "$CONF.before-$STAMP"
else
  mv "$CONF.before-$STAMP" "$CONF"
  echo "nginx -t не прошёл с прежним файлом: оставлен нынешний."
fi

# Повторный откат того же обновления не нужен: сведения о нём убираем (сам файл копий не трогаем).
mv "$APP/last-update" "$APP/backups/last-update-rolled-back-$STAMP"
say "Готово: стоит $PREV. Копия базы до отката: $NOW"
