#!/usr/bin/env bash
# Обновление с первой версии на правдоподобных данных — заново набирает данные для server/test/upgrade.test.js.
# Поднимает первую версию (коммит 8b36643) во временной папке на базе drevo_v1, наполняет её через API
# (seed-v1.mjs), снимает дамп данных и файлы. Нужны git, Node 22, PostgreSQL (как для тестов) и ffmpeg.
#   bash tools/upgrade/check.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/server/test/fixtures/v1"
WORK=$(mktemp -d)
PGURL=${PGURL:-postgres://drevo:drevo@127.0.0.1:5432}
trap 'kill $(cat "$WORK/pid" 2>/dev/null) 2>/dev/null || true; git -C "$ROOT" worktree remove --force "$WORK/v1" 2>/dev/null || true; rm -rf "$WORK"' EXIT

git -C "$ROOT" worktree add --detach "$WORK/v1" 8b36643 >/dev/null
(cd "$WORK/v1/server" && npm ci --no-audit --no-fund >/dev/null)
psql "$PGURL/drevo" -qc 'drop database if exists drevo_v1' -c 'create database drevo_v1'
export DATABASE_URL="$PGURL/drevo_v1"

mkdir -p "$WORK/data" "$WORK/img"
i=0
for c in tomato seagreen steelblue orange; do
  ffmpeg -loglevel error -f lavfi -i "color=c=$c:s=640x480" -frames:v 1 "$WORK/img/$(printf "\\x$(printf %x $((97 + i)))").jpg"
  i=$((i + 1))
done

cd "$WORK/v1/server"
LINK=$(node bin/invite.js --role owner --name Сергей | tail -1)
DATA_DIR="$WORK/data" PORT=8096 SECURE_COOKIES=false node src/index.js > "$WORK/v1.log" 2>&1 &
echo $! > "$WORK/pid"
for _ in $(seq 1 50); do curl -fsS http://127.0.0.1:8096/api/health >/dev/null 2>&1 && break; sleep 0.2; done
node "$ROOT/tools/upgrade/seed-v1.mjs" http://127.0.0.1:8096 "$LINK" "$WORK/img" > "$WORK/state.json"
kill "$(cat "$WORK/pid")"

rm -rf "$OUT" && mkdir -p "$OUT/media"
pg_dump "$DATABASE_URL" --data-only --inserts --no-owner --exclude-table=schema_migrations | grep -vE '^(--|SET |SELECT pg_catalog.set_config|\\)' | grep -v '^$' > "$OUT/data.sql"
cp "$WORK/state.json" "$OUT/state.json"
# Фото — одни и те же четыре снимка; в тесте подставляются по номеру файла.
cp "$WORK"/data/media/* "$OUT/media/"
echo "Готово: $OUT ($(wc -l < "$OUT/data.sql") строк данных, $(ls "$OUT/media" | wc -l) фото)"
