#!/usr/bin/env bash
# Семьи на сервере (то же — в приложении: «Главная → Семьи на сервере»):
#   sudo bash /srv/drevo/current/deploy/families.sh                       — список с номерами
#   sudo bash /srv/drevo/current/deploy/families.sh delete abc123 --yes   — удалить семью с закрытым входом навсегда
# Владелец другой семьи потерял вход: deploy/password.sh "" abc123 — новая ссылка для его входа.
set -euo pipefail
APP=/srv/drevo
docker compose -p drevo --env-file "$APP/.env" -f "$APP/current/deploy/docker-compose.yml" exec -T app node bin/families.js "$@"
