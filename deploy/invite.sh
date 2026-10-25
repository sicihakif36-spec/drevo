#!/usr/bin/env bash
# Ссылка для входа нового владельца:  sudo bash /srv/drevo/current/deploy/invite.sh "Имя"
# Новый владелец другой семьи на сервере: sudo bash /srv/drevo/current/deploy/invite.sh "Имя" abc123 (номер — в deploy/families.sh)
# Свой вход потерян (телефон, пароль) — лучше deploy/password.sh: тот же аккаунт, старые входы закрываются.
set -euo pipefail
APP=/srv/drevo
docker compose -p drevo --env-file "$APP/.env" -f "$APP/current/deploy/docker-compose.yml" exec -T app node bin/invite.js --role owner --name "${1:-Владелец}" --family "${2:-}"
