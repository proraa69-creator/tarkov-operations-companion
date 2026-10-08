#!/usr/bin/env bash
# Raid OS VPS: what takes the disk, and a careful cleanup of old release backups.
#
#   sudo bash /opt/tarkov-operations-companion/scripts/server-disk-cleanup.sh            # report only, changes nothing
#   sudo bash /opt/tarkov-operations-companion/scripts/server-disk-cleanup.sh --clean    # report, list, ask «ДА», then clean
#   add --swap to create a 2 GB swap file when the server has none (4 GB RAM, no swap: builds can run out of memory)
#
# Why: the automatic release (docs/coordination/ops-reference/auto-release.mjs) writes /etc/raidos/auto-release-<ms>
# on every release (database copy, owner exe, replaced sources) and never removes them; builds and old site/API copies
# it already keeps at 2. The one-off repair backups of 08.10 and /opt/raidos-repair-20261008 are not used any more.
#
# Kept always: the 3 newest auto-release backups and any backup named in /var/lib/raidos-release/state.json (the
# rollback of the current release), the live database, the current site, API, downloads and the release mirror.
# The database copy of every removed backup is moved to /var/backups/raidos-db (gzip, the 14 newest are kept).
set -euo pipefail

CLEAN=0
SWAP=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --swap) SWAP=1 ;;
    *) echo "Неизвестный параметр: $arg" >&2; exit 2 ;;
  esac
done
if [ "$(id -u)" -ne 0 ]; then echo "Запустите через sudo (нужен root)." >&2; exit 1; fi

KEEP_RELEASE_BACKUPS=3
KEEP_DB_COPIES=14
STATE=/var/lib/raidos-release/state.json
DB_ARCHIVE=/var/backups/raidos-db

size() { du -sh "$1" 2>/dev/null | cut -f1; }
line() { printf '%-58s %8s\n' "$1" "$2"; }

echo "=== Диск и память ==="
df -h / | sed 1d | awk '{printf "Диск /: занято %s из %s (%s), свободно %s\n", $3, $2, $5, $4}'
free -h | awk '/^Mem:/ {printf "Память: занято %s из %s\n", $3, $2} /^Swap:/ {printf "Подкачка: %s\n", ($2=="0B"?"нет":$2)}'
echo
echo "=== Что занимает место ==="
for path in /etc/raidos /opt/raidos-builds /opt/raidos-repair-20261008 /opt/tarkov-operations-companion /opt/raidos-private \
  /opt/raidos-release-mirror.git /var/lib/raidos /var/lib/raidos-build/.cache /var/cache/raidos /var/backups/raidos-db \
  /var/log/journal /var/cache/apt /root/.npm /root/.cache; do
  [ -e "$path" ] && line "$path" "$(size "$path")"
done
echo

# Backups named by the release state (rollback of the current or the failed release) are never removed.
protected=""
if [ -f "$STATE" ]; then
  protected=$(grep -oE '/etc/raidos/[A-Za-z0-9._-]+' "$STATE" | sort -u || true)
fi

mapfile -t release_backups < <(find /etc/raidos -maxdepth 1 -mindepth 1 -type d -regextype posix-extended -regex '/etc/raidos/auto-release-[0-9]{13}' -printf '%f\n' 2>/dev/null | sort -r)
remove=()
echo "=== Резервные копии выпусков (/etc/raidos/auto-release-*): ${#release_backups[@]} шт. ==="
index=0
for name in "${release_backups[@]}"; do
  path="/etc/raidos/$name"
  stamp=$(date -d "@$(( ${name#auto-release-} / 1000 ))" '+%d.%m %H:%M' 2>/dev/null || echo '?')
  if [ "$index" -lt "$KEEP_RELEASE_BACKUPS" ] || printf '%s\n' "$protected" | grep -qx "$path"; then
    line "  оставить  $name ($stamp)" "$(size "$path")"
  else
    line "  удалить   $name ($stamp)" "$(size "$path")"
    remove+=("$path")
  fi
  index=$((index + 1))
done

# One-off backups of the manual repairs on 08.10: superseded by the automatic releases since.
for pattern in 'paired-release-' 'releases-before-recognition-repair-' 'weapon-story-before-'; do
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if printf '%s\n' "$protected" | grep -qx "$path"; then continue; fi
    line "  удалить   ${path#/etc/raidos/} (разовый ремонт 08.10)" "$(size "$path")"
    remove+=("$path")
  done < <(find /etc/raidos -maxdepth 1 -mindepth 1 -type d -name "${pattern}*" 2>/dev/null | sort)
done
if [ -d /opt/raidos-repair-20261008 ]; then
  line "  удалить   /opt/raidos-repair-20261008 (сборки ремонта 08.10)" "$(size /opt/raidos-repair-20261008)"
  remove+=(/opt/raidos-repair-20261008)
fi
echo
echo "Также при очистке: журналы systemd ужимаются до 300 МБ, очищается кэш apt."
[ "$SWAP" -eq 1 ] && echo "И создаётся файл подкачки 2 ГБ (/swapfile), если подкачки нет."

if [ "$CLEAN" -ne 1 ]; then
  echo
  echo "Это только отчёт, ничего не удалено. Для очистки: sudo bash $0 --clean --swap"
  exit 0
fi

echo
read -r -p "Удалить отмеченное «удалить»? Введите ДА: " answer
if [ "$answer" != "ДА" ]; then echo "Отменено, ничего не изменено."; exit 0; fi

mkdir -p "$DB_ARCHIVE"
chmod 700 "$DB_ARCHIVE"
for path in "${remove[@]}"; do
  # Exact, expected locations only — nothing else is ever removed.
  case "$path" in
    /etc/raidos/auto-release-*|/etc/raidos/paired-release-*|/etc/raidos/releases-before-recognition-repair-*|/etc/raidos/weapon-story-before-*|/opt/raidos-repair-20261008) ;;
    *) echo "Пропущено (неожиданный путь): $path" >&2; continue ;;
  esac
  [ -d "$path" ] && [ ! -L "$path" ] || continue
  if [ -f "$path/companion.sqlite" ]; then
    gzip -c "$path/companion.sqlite" > "$DB_ARCHIVE/companion-$(basename "$path").sqlite.gz"
    chmod 600 "$DB_ARCHIVE/companion-$(basename "$path").sqlite.gz"
  fi
  rm -rf --one-file-system -- "$path"
  echo "Удалено: $path"
done
# The newest database copies stay.
find "$DB_ARCHIVE" -maxdepth 1 -type f -name 'companion-*.sqlite.gz' -printf '%T@ %p\n' | sort -rn | tail -n +$((KEEP_DB_COPIES + 1)) | cut -d' ' -f2- | xargs -r rm -f --

journalctl --vacuum-size=300M >/dev/null 2>&1 || true
apt-get clean >/dev/null 2>&1 || true

if [ "$SWAP" -eq 1 ] && ! swapon --show --noheadings | grep -q .; then
  avail_kb=$(df --output=avail / | tail -1)
  if [ "$avail_kb" -gt $((6 * 1024 * 1024)) ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "Подкачка 2 ГБ включена."
  else
    echo "Подкачка не создана: на диске меньше 6 ГБ свободного места."
  fi
fi

echo
df -h / | sed 1d | awk '{printf "Готово. Диск /: занято %s из %s (%s), свободно %s\n", $3, $2, $5, $4}'
