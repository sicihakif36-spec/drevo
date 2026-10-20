#!/usr/bin/env bash
# Копия базы и фото в /srv/drevo/backups, хранится 30 дней.
set -euo pipefail
APP=/srv/drevo
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
compose() { docker compose -p drevo --env-file "$APP/.env" -f "$APP/current/deploy/docker-compose.yml" "$@"; }
umask 077
compose exec -T db pg_dump -U drevo -Fc drevo > "$APP/backups/drevo-$STAMP.dump"
compose exec -T app tar -C /data -cf - media | gzip > "$APP/backups/media-$STAMP.tar.gz"
find "$APP/backups" -type f -mtime +30 -delete
