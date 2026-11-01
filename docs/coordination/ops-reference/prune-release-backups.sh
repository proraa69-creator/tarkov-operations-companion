#!/usr/bin/env bash
# Raid OS VPS: daily removal of old release backups (owner, 02.11.2026).
#
# auto-release.mjs writes /etc/raidos/auto-release-<ms> on every release (database copy, owner exe, replaced
# sources, about 270 MB) and never removes them; on 01.11 they took 37 GB on the two disks. Earlier ones were
# moved to the map disk with a link left in /etc/raidos, so a backup is either a folder or a link to one there.
#
# Kept: the KEEP newest backups and every backup named in state.json (the rollback of the current or the failed
# release). The database copy of each removed backup goes to /var/backups/raidos-db (gzip, the 14 newest stay).
# Runs under the release lock (raidos-backup-prune.service), so never during a release.
set -euo pipefail

KEEP=${KEEP:-3}
KEEP_DB_COPIES=14
STATE=/var/lib/raidos-release/state.json
STORE=/var/lib/raidos/map-mirror/.server-storage/etc/raidos
DB_ARCHIVE=/var/backups/raidos-db

protected=$(grep -oE '/etc/raidos/[A-Za-z0-9._-]+' "$STATE" 2>/dev/null | sort -u || true)
mapfile -t backups < <(find /etc/raidos -maxdepth 1 -mindepth 1 -regextype posix-extended -regex '/etc/raidos/auto-release-[0-9]{13}' \( -type d -o -type l \) -printf '%p\n' | sort -r)

mkdir -p "$DB_ARCHIVE"
chmod 700 "$DB_ARCHIVE"
removed=0
index=0
for path in "${backups[@]}"; do
  index=$((index + 1))
  if [ "$index" -le "$KEEP" ] || printf '%s\n' "$protected" | grep -qx "$path"; then continue; fi
  if [ -L "$path" ]; then
    target=$(readlink -f "$path")
    # A link only ever points to the moved copy on the map disk; anything else is left for the operator.
    case "$target" in "$STORE"/auto-release-[0-9]*) ;; *) echo "Skipped, unexpected link: $path -> $target" >&2; continue ;; esac
  else
    target=$path
  fi
  if [ -f "$target/companion.sqlite" ]; then
    gzip -c "$target/companion.sqlite" > "$DB_ARCHIVE/companion-$(basename "$path").sqlite.gz"
    chmod 600 "$DB_ARCHIVE/companion-$(basename "$path").sqlite.gz"
  fi
  [ -e "$target" ] && rm -rf --one-file-system -- "$target"
  [ -L "$path" ] && rm -f -- "$path"
  removed=$((removed + 1))
  echo "Removed $path"
done
find "$DB_ARCHIVE" -maxdepth 1 -type f -name 'companion-*.sqlite.gz' -printf '%T@ %p\n' | sort -rn | tail -n +$((KEEP_DB_COPIES + 1)) | cut -d' ' -f2- | xargs -r rm -f --
journalctl --vacuum-size=300M >/dev/null 2>&1 || true

echo "Release backups: ${#backups[@]} found, $removed removed; free: / $(df -h --output=avail / | tail -1 | tr -d ' '), map disk $(df -h --output=avail /var/lib/raidos/map-mirror | tail -1 | tr -d ' ')"
