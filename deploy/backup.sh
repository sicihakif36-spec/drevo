#!/usr/bin/env bash
# Ежедневная копия в /srv/drevo/backups (запускает таймер drevo-backup.timer, можно и вручную через sudo):
#   drevo-<время>.dump — база, хранится 30 дней (копии перед обновлением — пока их не удалят руками);
#   files/ — все файлы: фото, миниатюры, сканы, записи голоса (media/) фото из анкет (survey/), фото и голос из ответов родных (ask/).
# Файлы приложение не меняет и не стирает (удаление мягкое), поэтому files/ только пополняется новыми:
# одна копия на диске, а не по архиву всех фото на каждый день.
set -euo pipefail
APP=/srv/drevo
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
compose() { docker compose -p drevo --env-file "$APP/.env" -f "$APP/current/deploy/docker-compose.yml" "$@"; }
umask 077
mkdir -p "$APP/backups/files"

compose exec -T db pg_dump -U drevo -Fc drevo > "$APP/backups/drevo-$STAMP.dump.part"
mv "$APP/backups/drevo-$STAMP.dump.part" "$APP/backups/drevo-$STAMP.dump"

# Файлы — прямо из тома Docker; копия не стирает того, чего в томе уже нет.
DATA=$(docker volume inspect drevo_media --format '{{.Mountpoint}}')
rsync -a "$DATA/" "$APP/backups/files/"

find "$APP/backups" -maxdepth 1 -type f \( -name 'drevo-*Z.dump' -o -name 'media-*.tar.gz' -o -name '*.part' \) -mtime +30 -delete
