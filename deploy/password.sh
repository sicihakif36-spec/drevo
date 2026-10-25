#!/usr/bin/env bash
# Владелец забыл пароль или потерял телефон: сбросить пароль, выйти на всех его устройствах и получить новую ссылку
# для входа в тот же аккаунт (по ней придумать новый пароль):
#   sudo bash /srv/drevo/current/deploy/password.sh                  — если владелец один
#   sudo bash /srv/drevo/current/deploy/password.sh "Имя"            — если владельцев несколько
#   sudo bash /srv/drevo/current/deploy/password.sh "" abc123        — владелец другой семьи (номер — в deploy/families.sh)
set -euo pipefail
APP=/srv/drevo
docker compose -p drevo --env-file "$APP/.env" -f "$APP/current/deploy/docker-compose.yml" exec -T app node bin/password.js --name "${1:-}" --family "${2:-}"
