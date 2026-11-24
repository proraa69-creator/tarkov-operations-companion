#!/bin/bash
# «Отчёты» (docs/reports-agent.md): what the two limited SSH keys of the agent need on the server. Run as root, by hand; the
# publisher does not touch any of it. Safe to run again: it replaces the two keys' lines and the files, and nothing else.
#
#   bash install-reports-agent.sh <triage.pub> <work.pub> <reports-agent-gate.mjs> <reports-agent-cli.sh>
#
# After it: `raidos-reports` has no password and no shell a key can reach, owns nothing, and may start one file as `raidos-api`.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Run as root' >&2; exit 1; }
triage_pub=$1; work_pub=$2; gate=$3; cli=$4
key_line() { # A single ed25519 public key, or nothing goes in.
  local key
  key=$(tr -d '\r' < "$1")
  [[ "$key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ [A-Za-z0-9._@-]+)?$ ]] || { echo "Not one ed25519 public key: $1" >&2; exit 1; }
  printf 'restrict,command="/usr/bin/node /usr/local/lib/raidos-reports/gate.mjs %s" %s\n' "$2" "$key"
}
triage_line=$(key_line "$triage_pub" triage)
work_line=$(key_line "$work_pub" work)

id raidos-reports >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /home/raidos-reports --shell /bin/sh raidos-reports
install -d -o root -g root -m 755 /home/raidos-reports /home/raidos-reports/.ssh /usr/local/lib/raidos-reports

# Line ends from a Windows checkout would break the first line of a script.
tr -d '\r' < "$gate" > /usr/local/lib/raidos-reports/gate.mjs
tr -d '\r' < "$cli" > /usr/local/lib/raidos-reports/cli
chown root:root /usr/local/lib/raidos-reports/gate.mjs /usr/local/lib/raidos-reports/cli
chmod 644 /usr/local/lib/raidos-reports/gate.mjs
chmod 755 /usr/local/lib/raidos-reports/cli

printf '%s\n%s\n' "$triage_line" "$work_line" > /home/raidos-reports/.ssh/authorized_keys
chown root:root /home/raidos-reports/.ssh/authorized_keys
chmod 644 /home/raidos-reports/.ssh/authorized_keys

# A broken file in sudoers.d would break sudo for everybody, so it is checked before it goes in.
sudoers=$(mktemp)
cat > "$sudoers" <<'SUDOERS'
# «Отчёты»: docs/reports-agent.md
Defaults:raidos-reports !use_pty
raidos-reports ALL=(raidos-api) NOPASSWD: /usr/local/lib/raidos-reports/cli
SUDOERS
visudo -cf "$sudoers" >/dev/null
install -o root -g root -m 440 "$sudoers" /etc/sudoers.d/raidos-reports
rm -f "$sudoers"
visudo -c >/dev/null
echo 'Installed'
