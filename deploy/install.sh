#!/usr/bin/env bash
# Установка и обновление «Древа» на сервере. Запускать через sudo из распакованного релиза:
#   sudo bash deploy/install.sh
# Повторный запуск безопасен: база и фото сохраняются, обновляется только код.
set -euo pipefail

DOMAIN=drevo.myryadom.su
APP=/srv/drevo
SRC="$(cd "$(dirname "$0")/.." && pwd)"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
EMAIL=${CERTBOT_EMAIL:-}

say() { printf '\n== %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }
command -v docker >/dev/null || { echo "Нет Docker"; exit 1; }
docker compose version >/dev/null || { echo "Нет Docker Compose"; exit 1; }
command -v rsync >/dev/null || apt-get install -y rsync

say "Код -> $APP/releases/$STAMP"
mkdir -p "$APP/releases" "$APP/acme" "$APP/backups"
chmod 700 "$APP/backups"
rsync -a --delete --exclude node_modules --exclude web/dist --exclude server/var --exclude deploy/.env "$SRC/" "$APP/releases/$STAMP/"
ln -sfn "$APP/releases/$STAMP" "$APP/current"

if [ ! -f "$APP/.env" ]; then
  say "Создаю $APP/.env с паролем базы"
  umask 077
  printf 'POSTGRES_PASSWORD=%s\nPUBLIC_URL=https://%s\n' "$(openssl rand -hex 24)" "$DOMAIN" > "$APP/.env"
  umask 022
fi
ln -sfn "$APP/.env" "$APP/current/deploy/.env"

compose() { docker compose -p drevo --env-file "$APP/.env" -f "$APP/current/deploy/docker-compose.yml" "$@"; }

if compose ps --status running db 2>/dev/null | grep -q db; then
  say "Копия базы перед обновлением"
  compose exec -T db pg_dump -U drevo -Fc drevo > "$APP/backups/drevo-$STAMP-before-update.dump"
fi

say "Сборка и запуск контейнеров (первый раз несколько минут)"
compose up -d --build
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:8095/api/health >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS http://127.0.0.1:8095/api/health >/dev/null || { compose logs --tail 50 app; echo "Приложение не запустилось"; exit 1; }
echo "Приложение отвечает на 127.0.0.1:8095"

say "Резервные копии: ежедневно, 30 дней"
cat > /etc/systemd/system/drevo-backup.service <<UNIT
[Unit]
Description=Резервная копия базы и фото «Древа»
[Service]
Type=oneshot
ExecStart=/bin/bash $APP/current/deploy/backup.sh
UNIT
cat > /etc/systemd/system/drevo-backup.timer <<UNIT
[Unit]
Description=Ежедневная копия «Древа»
[Timer]
OnCalendar=*-*-* 02:40:00 UTC
RandomizedDelaySec=300
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now drevo-backup.timer >/dev/null

say "Nginx и сертификат для $DOMAIN"
IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')
MYIP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
if [ -z "$IP" ]; then
  echo "DNS: у $DOMAIN нет A-записи. Добавьте A-запись на $MYIP и запустите установщик ещё раз."
  exit 2
fi
[ "$IP" = "$MYIP" ] || echo "Внимание: $DOMAIN указывает на $IP, а у сервера адрес $MYIP"
if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  cp "$APP/current/deploy/nginx/drevo-acme.conf" /etc/nginx/sites-available/drevo.conf
  ln -sfn /etc/nginx/sites-available/drevo.conf /etc/nginx/sites-enabled/drevo.conf
  nginx -t && systemctl reload nginx
  if [ -n "$EMAIL" ]; then certbot certonly --webroot -w "$APP/acme" -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL"
  else certbot certonly --webroot -w "$APP/acme" -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email; fi
fi
cp "$APP/current/deploy/nginx/drevo.conf" /etc/nginx/sites-available/drevo.conf
ln -sfn /etc/nginx/sites-available/drevo.conf /etc/nginx/sites-enabled/drevo.conf
nginx -t && systemctl reload nginx

# Старые релизы: оставляем пять последних.
ls -1dt "$APP"/releases/* | tail -n +6 | xargs -r rm -rf

say "Готово: https://$DOMAIN"
if [ "$(compose exec -T db psql -U drevo -d drevo -tAc 'select count(*) from users')" = "0" ]; then
  echo "Первая ссылка для входа владельца (откройте на своём телефоне):"
  compose exec -T app node bin/invite.js --role owner --name "${OWNER_NAME:-Владелец}"
fi
