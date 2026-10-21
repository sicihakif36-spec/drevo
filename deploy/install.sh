#!/usr/bin/env bash
# Установка и обновление «Древа» на сервере. Запускать через sudo из распакованного релиза:
#   sudo bash deploy/install.sh
# Повторный запуск безопасен: база и фото сохраняются, обновляется только код.
# Перед обновлением снимается копия базы; вернуть прежний выпуск: sudo bash /srv/drevo/current/deploy/rollback.sh
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

mkdir -p "$APP/releases" "$APP/acme" "$APP/backups"
chmod 700 "$APP/backups"
PREV=$(readlink -f "$APP/current" 2>/dev/null || true)
compose() { docker compose -p drevo --env-file "$APP/.env" -f "$1/deploy/docker-compose.yml" "${@:2}"; }

# Копия базы — до того, как что-то меняется (база остановлена — запускаем). Не получилась — дальше не идём.
DUMP=""
if [ -n "$PREV" ] && [ -d "$PREV" ]; then
  say "Копия базы перед обновлением"
  compose "$PREV" up -d --wait db
  DUMP="$APP/backups/drevo-$STAMP-before-update.dump"
  (umask 077; compose "$PREV" exec -T db pg_dump -U drevo -Fc drevo > "$DUMP")
  compose "$PREV" exec -T db pg_restore -l < "$DUMP" >/dev/null || { echo "Копия базы не читается, обновление остановлено: $DUMP"; exit 1; }
  echo "Копия: $DUMP ($(du -h "$DUMP" | cut -f1))"
fi

say "Код -> $APP/releases/$STAMP"
rsync -a --delete --exclude node_modules --exclude web/dist --exclude server/var --exclude deploy/.env "$SRC/" "$APP/releases/$STAMP/"
# Для отката (deploy/rollback.sh): какой выпуск стоял и где его база. Повторная установка того же кода
# точку отката не сдвигает: откат по-прежнему вернёт версию, стоявшую до обновления.
if [ -n "$DUMP" ]; then
  if [ -f "$APP/last-update" ] && diff -rq -x .env "$PREV" "$APP/releases/$STAMP" >/dev/null; then
    echo "Код тот же, что уже стоял: откат, как и раньше, вернёт $(. "$APP/last-update"; echo "$PREV")"
  else
    printf 'PREV=%q\nDUMP=%q\n' "$PREV" "$DUMP" > "$APP/last-update"
  fi
fi
ln -sfn "$APP/releases/$STAMP" "$APP/current"

if [ ! -f "$APP/.env" ]; then
  say "Создаю $APP/.env с паролем базы"
  umask 077
  printf 'POSTGRES_PASSWORD=%s\nPUBLIC_URL=https://%s\n' "$(openssl rand -hex 24)" "$DOMAIN" > "$APP/.env"
  umask 022
fi
ln -sfn "$APP/.env" "$APP/current/deploy/.env"

say "Сборка и запуск контейнеров (первый раз несколько минут); новая версия сама обновит базу"
compose "$APP/current" up -d --build
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:8095/api/health >/dev/null 2>&1 && break
  sleep 2
done
if ! curl -fsS http://127.0.0.1:8095/api/health >/dev/null; then
  compose "$APP/current" logs --tail 50 app
  echo "Приложение не запустилось."
  [ -n "$DUMP" ] && echo "Вернуть прежнюю версию и базу: sudo bash $APP/current/deploy/rollback.sh"
  exit 1
fi
echo "Приложение отвечает на 127.0.0.1:8095"

say "Резервные копии: ежедневно, база — 30 дней, файлы — все"
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

# Свой файл nginx ставится с проверкой: при ошибке возвращается прежний, nginx и «Мы рядом» работают как раньше.
CONF=/etc/nginx/sites-available/drevo.conf
nginx_install() {
  local old=""
  if [ -f "$CONF" ]; then old="$CONF.before-$STAMP"; cp -p "$CONF" "$old"; fi
  cp "$1" "$CONF"
  ln -sfn "$CONF" /etc/nginx/sites-enabled/drevo.conf
  if nginx -t; then
    systemctl reload nginx
    [ -z "$old" ] || rm -f "$old"
  else
    if [ -n "$old" ]; then mv "$old" "$CONF"; else rm -f "$CONF" /etc/nginx/sites-enabled/drevo.conf; fi
    echo "nginx -t не прошёл: прежний файл nginx возвращён, nginx не перезагружался."
    exit 1
  fi
}
if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  nginx_install "$APP/current/deploy/nginx/drevo-acme.conf"
  if [ -n "$EMAIL" ]; then certbot certonly --webroot -w "$APP/acme" -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL"
  else certbot certonly --webroot -w "$APP/acme" -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email; fi
fi
nginx_install "$APP/current/deploy/nginx/drevo.conf"

# Старые выпуски: оставляем пять последних по времени установки (в имени); текущий и тот, на который откатывает
# rollback.sh, не трогаем никогда.
KEEP=$(readlink -f "$APP/current"; [ ! -f "$APP/last-update" ] || (. "$APP/last-update"; echo "$PREV"))
for old in $(find "$APP/releases" -mindepth 1 -maxdepth 1 -type d | sort | head -n -5); do
  grep -qxF "$old" <<<"$KEEP" || rm -rf "$old"
done

say "Готово: https://$DOMAIN"
if [ "$(compose "$APP/current" exec -T db psql -U drevo -d drevo -tAc 'select count(*) from users')" = "0" ]; then
  echo "Первая ссылка для входа владельца (откройте на своём телефоне):"
  compose "$APP/current" exec -T app node bin/invite.js --role owner --name "${OWNER_NAME:-Владелец}"
fi
