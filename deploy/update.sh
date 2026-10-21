#!/usr/bin/env bash
# Обновление «Древа» одной командой: забрать свежий main из GitHub и поставить его.
#   sudo bash /srv/drevo/src/deploy/update.sh            — поставить, если есть новое
#   sudo bash /srv/drevo/src/deploy/update.sh --force    — поставить заново, даже если нового нет
# Код забирается ключом только для чтения /srv/drevo/deploy_key в /srv/drevo/src (приводится точно к main),
# дальше всё делает deploy/install.sh: копия базы, новый выпуск, nginx. Откат — как раньше:
#   sudo bash /srv/drevo/current/deploy/rollback.sh
# Первая установка (ключ, добавление его в GitHub, первое скачивание) — блок из docs/zapusk.md, раздел 1.
set -euo pipefail

APP=/srv/drevo
SRC=$APP/src
KEY=$APP/deploy_key
KNOWN=$APP/known_hosts
# Сначала обычный порт 22; если он у сервера закрыт — тот же GitHub через порт 443.
URLS="git@github.com:sicihakif36-spec/drevo.git ssh://git@ssh.github.com:443/sicihakif36-spec/drevo.git"
# Ключ сервера GitHub (SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU): чужой сервер под видом GitHub не пройдёт.
GITHUB_KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
# Только этот ключ и этот список серверов; настройки ssh самого root (~/.ssh/config) не читаются и не меняются.
SSH="ssh -F /dev/null -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$KNOWN -o ConnectTimeout=20"

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\n!! %s\n' "$1" >&2; shift; [ $# = 0 ] || printf '   %s\n' "$@" >&2; exit 1; }

# Заголовок изменения: у слияния из GitHub («Merge pull request …») — название запроса из описания.
title() {
  local s b
  s=$(git -C "$SRC" log -1 --format=%s "$1")
  b=$(git -C "$SRC" log -1 --format=%b "$1" | sed -n '/./{p;q}')
  case "$s" in "Merge pull request"*|"Merge branch"*) [ -z "$b" ] || s=$b ;; esac
  printf '  • %s (%s)\n' "$s" "$(git -C "$SRC" log -1 --format=%cd --date=format:%d.%m.%Y "$1")"
}

# Скачать main по первому адресу, который отвечает. Ошибки — понятными словами.
fetch() {
  local url err out="" first
  err=$(mktemp)
  # Сначала адрес, который сработал в прошлый раз: если порт 22 закрыт, не ждать его каждый раз.
  first=$(git -C "$SRC" remote get-url origin 2>/dev/null || true)
  case " $URLS " in *" $first "*) ;; *) first=${URLS%% *} ;; esac
  for url in $first ${URLS/$first/}; do
    if GIT_SSH_COMMAND=$SSH git -C "$SRC" fetch -q "$url" +refs/heads/main:refs/remotes/origin/main 2>"$err"; then
      git -C "$SRC" remote set-url origin "$url"
      rm -f "$err"
      return 0
    fi
    out=$(grep -v -e '^fatal: Could not read' -e '^Please make sure' -e '^and the repository exists' -e '^$' "$err" || true)
    # Ключ не подходит — на другом порту будет то же самое.
    if grep -qiE 'Permission denied|Repository not found|access denied' <<<"$out"; then
      rm -f "$err"
      fail "GitHub не пустил этот сервер: ключ не добавлен в репозиторий (или его удалили)." \
        "Откройте https://github.com/sicihakif36-spec/drevo/settings/keys/new и добавьте ключ:" \
        "  Title: drevo-server" "  Key:   $(cat "$KEY.pub")" \
        "Галочку «Allow write access» не ставьте. Нажмите «Add key» и запустите эту команду ещё раз."
    fi
    if grep -q 'Host key verification failed\|REMOTE HOST IDENTIFICATION HAS CHANGED' <<<"$out"; then
      rm -f "$err"
      fail "Сервер по адресу GitHub представился чужим ключом — код не скачивался." \
        "Возможно, связь перехвачена. Ничего не меняйте и сообщите разработчику:" "$out"
    fi
  done
  rm -f "$err"
  fail "Нет связи с GitHub (пробовал порты 22 и 443). Сайт работает как раньше." \
    "Проверьте интернет на сервере и запустите эту команду ещё раз. Последняя ошибка:" "$out"
}

main() {
  local force=""
  case "${1:-}" in
    "") ;;
    --force) force=1 ;;
    *) fail "Непонятный ключ «$1». Можно: --force — поставить заново, даже если нового нет." ;;
  esac
  [ "$(id -u)" = 0 ] || fail "Запустите через sudo: sudo bash $SRC/deploy/update.sh"
  [ -f "$KEY" ] || fail "Нет ключа для GitHub ($KEY). Сделайте первую установку по памятке docs/zapusk.md, раздел 1."
  command -v git >/dev/null || apt-get install -y git
  command -v ssh >/dev/null || apt-get install -y openssh-client

  mkdir -p "$APP"
  # Два обновления разом не идут.
  exec 9>"$APP/.update.lock"
  flock -n 9 || fail "Обновление уже идёт в другом окне. Дождитесь его конца."

  chmod 600 "$KEY"
  printf 'github.com %s\n[ssh.github.com]:443 %s\n' "$GITHUB_KEY" "$GITHUB_KEY" > "$KNOWN"

  [ -d "$SRC/.git" ] || git init -q "$SRC"
  git -C "$SRC" remote get-url origin >/dev/null 2>&1 || git -C "$SRC" remote add origin "${URLS%% *}"
  git -C "$SRC" config core.sshCommand "$SSH"   # чтобы и git руками в $SRC ходил этим ключом
  say "Забираю свежий код из GitHub"
  fetch
  local new old="" rel="" cur
  new=$(git -C "$SRC" rev-parse origin/main)
  # Что ставилось этой командой в прошлый раз и какой выпуск тогда стал текущим.
  if [ -f "$APP/src-installed" ]; then
    COMMIT="" RELEASE=""
    # shellcheck source=/dev/null
    . "$APP/src-installed"
    old=$COMMIT rel=$RELEASE
  fi
  cur=$(readlink -f "$APP/current" 2>/dev/null || true)

  if [ "$old" = "$new" ] && [ -n "$cur" ] && [ "$cur" = "$rel" ] && [ -z "$force" ]; then
    echo "Нечего обновлять: уже стоит последняя версия от $(git -C "$SRC" log -1 --format=%cd --date=format:%d.%m.%Y "$new")."
    echo "Поставить её заново: sudo bash $SRC/deploy/update.sh --force"
    return 0
  fi

  # Папка исходников — точно как main в GitHub, без чужих правок и лишних файлов.
  git -C "$SRC" checkout -q -f -B main origin/main
  git -C "$SRC" clean -qffdx

  if [ -n "$old" ] && [ "$old" != "$new" ] && git -C "$SRC" merge-base --is-ancestor "$old" "$new" 2>/dev/null; then
    say "Что нового с прошлой установки"
    local n=0 c
    for c in $(git -C "$SRC" rev-list --first-parent "$old..$new"); do
      n=$((n + 1))
      [ "$n" -le 30 ] && title "$c"
    done
    [ "$n" -le 30 ] || echo "  … и ещё $((n - 30))"
  elif [ "$old" = "$new" ] && [ "$cur" != "$rel" ]; then
    say "Эта версия уже ставилась, но сейчас стоит другой выпуск (был откат) — ставлю её снова"
    title "$new"
  elif [ "$old" = "$new" ]; then
    say "Ставлю заново ту же версию"
    title "$new"
  else
    say "Ставлю версию"
    title "$new"
  fi

  say "Запускаю установщик"
  if ! bash "$SRC/deploy/install.sh"; then
    fail "Установка не закончилась — что случилось, написано выше (раздел 5 памятки docs/zapusk.md)." \
      "Когда причина устранена, запустите ещё раз: sudo bash $SRC/deploy/update.sh"
  fi
  printf 'COMMIT=%q\nRELEASE=%q\n' "$new" "$(readlink -f "$APP/current")" > "$APP/src-installed"
  echo "Стоит версия $(git -C "$SRC" log -1 --format='%h от %cd' --date=format:%d.%m.%Y "$new")."
  echo "Следующее обновление: sudo bash $SRC/deploy/update.sh"
}

# Весь скрипт читается до запуска: git ниже перезаписывает этот же файл новой версией.
main "$@"; exit $?
