#!/usr/bin/env bash
# Новая ссылка для входа владельца (если потерян телефон):  sudo bash /srv/drevo/current/deploy/invite.sh "Имя"
set -euo pipefail
APP=/srv/drevo
docker compose -p drevo --env-file "$APP/.env" -f "$APP/current/deploy/docker-compose.yml" exec -T app node bin/invite.js --role owner --name "${1:-Владелец}"
