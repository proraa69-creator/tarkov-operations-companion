#!/usr/bin/env bash
# Raid OS server on Ubuntu (docs/linux-server.md). Run as root on the VPS:
#   bash install.sh --check        only report the machine's state (changes nothing)
#   bash install.sh                install / repair: Node 22, Caddy (HTTPS), the raidos-api / raidos-site services,
#                                  the auto-update timer and the newest signed server bundle from raidos-releases
# Settings (environment): RAIDOS_GITHUB_TOKEN (read-only token for raidos-releases; asked for when missing),
#   RAIDOS_DOMAIN (raidos.app), RAIDOS_OWNER_EMAILS (proraa69@gmail.com), RAIDOS_IMPORT_DB (a companion.sqlite to take
#   over on the first install), RAIDOS_IMPORT_KEY (its entitlement-ed25519.pem), RAIDOS_RELEASES_REPO.
# Never deletes data: an existing /var/lib/raidos database and /etc/raidos settings are kept as they are.
set -euo pipefail

DOMAIN="${RAIDOS_DOMAIN:-raidos.app}"
OWNERS="${RAIDOS_OWNER_EMAILS:-proraa69@gmail.com}"
REPO="${RAIDOS_RELEASES_REPO:-proraa69-creator/raidos-releases}"
HOME_DIR=/opt/raidos
DATA_DIR=/var/lib/raidos
ETC_DIR=/etc/raidos
STATE_DIR=/var/lib/raidos-updater
UPDATE_PUBLIC_KEY='-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAftYz8I2p4LRKazNh5xV9lKxpJXC9VJK7mdOa6qAQ9Zs=
-----END PUBLIC KEY-----'

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

port_owner() { ss -Hltnp "sport = :$1" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -1; }

report() {
  say "Сервер"
  . /etc/os-release 2>/dev/null && echo "Система: ${PRETTY_NAME:-?}"
  echo "Ядро: $(uname -r)   Процессоры: $(nproc)"
  free -h | sed -n '1,2p'
  df -h / | tail -1 | awk '{print "Диск /: всего " $2 ", занято " $3 ", свободно " $4}'
  echo "Node.js: $(node -v 2>/dev/null || echo 'не установлен')   Caddy: $(caddy version 2>/dev/null | cut -d' ' -f1 || echo 'не установлен')"
  for p in 80 443 5202 8787; do echo "Порт $p: $(port_owner "$p" || true)"; done | sed 's/: $/: свободен/'
  for s in raidos-api raidos-site raidos-update.timer caddy nginx apache2 cloudflared docker pm2-root; do
    systemctl list-unit-files "$s*" >/dev/null 2>&1 && st=$(systemctl is-active "$s" 2>/dev/null || true) && [ "$st" != "inactive" ] && echo "Служба $s: $st"
  done || true
  command -v pm2 >/dev/null && { echo "pm2:"; pm2 ls 2>/dev/null | head -20; }
  echo "Raid OS: $( [ -f $HOME_DIR/current/build-info.json ] && cat $HOME_DIR/current/build-info.json || echo 'не установлен')"
  echo "Базы companion.sqlite на диске:"
  timeout 30 find /root /home /opt /srv /var/lib /var/www /usr/local -maxdepth 8 -name 'companion.sqlite' -not -path '*/node_modules/*' 2>/dev/null | while read -r f; do echo "  $f ($(du -h "$f" | cut -f1), изменена $(date -r "$f" '+%F %T'))"; done || true
  echo "DNS $DOMAIN → $(timeout 5 getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')   IP этого сервера: $(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || echo '?')"
}

[ "$(id -u)" = 0 ] || die "Запустите от root: sudo bash install.sh"
if [ "${1:-}" = "--check" ]; then report; exit 0; fi
report

# ---- conflicts: never take over a port another server uses ----
for p in 80 443; do
  owner=$(port_owner "$p" || true)
  [ -z "$owner" ] || [ "$owner" = caddy ] || die "Порт $p занят программой «$owner». Это, скорее всего, ваш прежний веб-сервер: остановите его (или пришлите вывод --check), затем запустите установку снова."
done
for p in 5202 8787; do
  owner=$(port_owner "$p" || true)
  if [ -n "$owner" ] && ! systemctl is-active --quiet raidos-api raidos-site 2>/dev/null; then
    die "Порт $p занят программой «$owner» (не службой raidos). Остановите прежний запуск сервера, затем запустите установку снова. Его базу можно перенести: RAIDOS_IMPORT_DB=/путь/companion.sqlite"
  fi
done

if [ -z "${RAIDOS_GITHUB_TOKEN:-}" ] && [ -f $ETC_DIR/updater.env ]; then RAIDOS_GITHUB_TOKEN=$(sed -n 's/^RAIDOS_GITHUB_TOKEN=//p' $ETC_DIR/updater.env); fi
if [ -z "${RAIDOS_GITHUB_TOKEN:-}" ]; then
  read -r -s -p "Токен GitHub для чтения raidos-releases (ввод не виден): " RAIDOS_GITHUB_TOKEN </dev/tty; echo
fi
[ -n "$RAIDOS_GITHUB_TOKEN" ] || die "Нужен токен GitHub (только чтение репозитория $REPO)"

gh_raw() { curl -fsSL --retry 3 -H "Authorization: Bearer $RAIDOS_GITHUB_TOKEN" -H 'Accept: application/vnd.github.raw+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO/contents/$1"; }
gh_raw latest.json >/dev/null || die "Токен не открывает $REPO (проверьте, что у него есть доступ Contents: Read к этому репозиторию)"

# ---- packages ----
say "Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg tar gzip openssl sqlite3 debian-keyring debian-archive-keyring apt-transport-https >/dev/null
node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; }
if ! node_ok; then
  say "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node_ok || die "Не удалось поставить Node.js 22.13+"
if ! command -v caddy >/dev/null; then
  say "Caddy (HTTPS)"
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

# ---- user, folders, settings ----
say "Папки и настройки"
id raidos >/dev/null 2>&1 || useradd --system --home-dir $DATA_DIR --shell /usr/sbin/nologin raidos
install -d -o root -g root -m 755 $HOME_DIR $HOME_DIR/releases
install -d -o raidos -g raidos -m 750 $DATA_DIR
install -d -o root -g root -m 755 $DATA_DIR/client
install -d -o root -g raidos -m 750 $ETC_DIR
install -d -o root -g root -m 700 $STATE_DIR

umask 077
printf 'RAIDOS_GITHUB_TOKEN=%s\nRAIDOS_RELEASES_REPO=%s\n' "$RAIDOS_GITHUB_TOKEN" "$REPO" > $ETC_DIR/updater.env
chmod 600 $ETC_DIR/updater.env
if [ ! -f $ETC_DIR/raidos.env ]; then
  cat > $ETC_DIR/raidos.env <<EOF
# Raid OS API settings (docs/linux-server.md). After a change: systemctl restart raidos-api
TARKOV_OWNER_EMAILS=$OWNERS
TARKOV_PUBLIC_URL=https://$DOMAIN
WEB_ORIGIN=https://$DOMAIN,https://www.$DOMAIN,capacitor://localhost,https://localhost
TARKOV_ADMIN_TOKEN=$(openssl rand -hex 32)
# ЮKassa (личный кабинет ЮKassa → Интеграция → Ключи API). Цена месяца в рублях.
#YOOKASSA_SHOP_ID=
#YOOKASSA_SECRET_KEY=
#TARKOV_PRICE_MONTH_RUB=300
#YOOKASSA_RECEIPTS=1
#YOOKASSA_AUTOPAY=0
#TARKOV_STREAMER_PERCENT=10
# Письма (Resend): провайдер, ключ, адрес отправителя
#TARKOV_EMAIL_PROVIDER=resend
#TARKOV_EMAIL_API_KEY=
#TARKOV_EMAIL_FROM=Raid OS <noreply@$DOMAIN>
EOF
fi
chown root:raidos $ETC_DIR/raidos.env && chmod 640 $ETC_DIR/raidos.env
umask 022

# ---- data takeover (first install only; an existing database is never replaced) ----
if [ -n "${RAIDOS_IMPORT_DB:-}" ]; then
  [ -f "$RAIDOS_IMPORT_DB" ] || die "Нет файла $RAIDOS_IMPORT_DB"
  if [ -f $DATA_DIR/companion.sqlite ]; then
    warn "$DATA_DIR/companion.sqlite уже есть — перенос пропущен (база на сервере не заменяется)"
  else
    say "Перенос базы $RAIDOS_IMPORT_DB"
    sqlite3 "$RAIDOS_IMPORT_DB" "PRAGMA integrity_check;" | grep -qx ok || die "Файл $RAIDOS_IMPORT_DB повреждён (integrity_check)"
    sqlite3 "$RAIDOS_IMPORT_DB" ".backup '$DATA_DIR/companion.sqlite'"
    chown raidos:raidos $DATA_DIR/companion.sqlite && chmod 600 $DATA_DIR/companion.sqlite
  fi
fi
if [ -n "${RAIDOS_IMPORT_KEY:-}" ] && [ ! -f $DATA_DIR/entitlement-ed25519.pem ]; then
  grep -q 'PRIVATE KEY' "$RAIDOS_IMPORT_KEY" || die "$RAIDOS_IMPORT_KEY — не ключ"
  install -o raidos -g raidos -m 600 "$RAIDOS_IMPORT_KEY" $DATA_DIR/entitlement-ed25519.pem
fi

# ---- services ----
say "Службы"
cat > /etc/systemd/system/raidos-api.service <<EOF
[Unit]
Description=Raid OS API
After=network-online.target
Wants=network-online.target

[Service]
User=raidos
Group=raidos
EnvironmentFile=$ETC_DIR/raidos.env
EnvironmentFile=-$HOME_DIR/current/build.env
Environment=HOST=127.0.0.1 PORT=8787 TARKOV_DB_PATH=$DATA_DIR/companion.sqlite NODE_ENV=production
ExecStart=/usr/bin/node $HOME_DIR/current/api/server.cjs
Restart=always
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/raidos-site.service <<EOF
[Unit]
Description=Raid OS website
After=network-online.target raidos-api.service

[Service]
User=raidos
Group=raidos
Environment=SITE_PORT=5202 API_PORT=8787 SITE_ROOT=$HOME_DIR/current/site/www CLIENT_DIR=$DATA_DIR/client NODE_ENV=production
ExecStart=/usr/bin/node $HOME_DIR/current/site/site-server.cjs
Restart=always
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/raidos-update.service <<EOF
[Unit]
Description=Raid OS auto-update (signed releases from GitHub)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=$ETC_DIR/updater.env
Environment=RAIDOS_HOME=$HOME_DIR CLIENT_DIR=$DATA_DIR/client RAIDOS_UPDATER_STATE=$STATE_DIR
ExecStart=/usr/bin/node $HOME_DIR/current/bin/raidos-update.cjs
TimeoutStartSec=30min
EOF
cat > /etc/systemd/system/raidos-update.timer <<EOF
[Unit]
Description=Check for a new Raid OS release every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=30
Persistent=true

[Install]
WantedBy=timers.target
EOF

# ---- the first bundle (later ones: the timer). Checked here with the system's Node, not with code from the bundle ----
if [ ! -f $HOME_DIR/current/build-info.json ]; then
  say "Последняя версия сервера"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  gh_raw latest.json > "$tmp/latest.json"
  path=$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(!/^releases\/\d+$/.test(p.path))process.exit(1);console.log(p.path)' "$tmp/latest.json") || die "latest.json испорчен"
  gh_raw "$path/RaidOS-linux.json" > "$tmp/m.json" || die "В последнем релизе ещё нет сборки для Linux"
  name=$(UPDATE_PUBLIC_KEY="$UPDATE_PUBLIC_KEY" node -e '
    const fs=require("fs"),c=require("crypto");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const b=m.bundle||{};
    if(!/^raidos-server-\d+\.tar\.gz$/.test(b.name)||b.name!==`raidos-server-${m.build}.tar.gz`)process.exit(1);
    const text=["raidos-linux-server-v1",`version=${m.version}`,`build=${m.build}`,`commit=${m.commit}`,`bundle=${b.name} ${b.size} ${b.sha256}`].join("\n");
    if(!c.verify(null,Buffer.from(text),c.createPublicKey(process.env.UPDATE_PUBLIC_KEY),Buffer.from(String(m.signature),"base64")))process.exit(2);
    console.log(b.name)' "$tmp/m.json") || die "Подпись RaidOS-linux.json не сходится — установка остановлена"
  gh_raw "$path/$name" > "$tmp/$name"
  node -e '
    const fs=require("fs"),c=require("crypto");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const d=fs.readFileSync(process.argv[2]);
    process.exit(d.length===m.bundle.size&&c.createHash("sha256").update(d).digest("hex")===m.bundle.sha256?0:1)' "$tmp/m.json" "$tmp/$name" || die "Архив не совпадает с подписанным SHA-256"
  build=${name#raidos-server-}; build=${build%.tar.gz}
  rm -rf "$HOME_DIR/releases/$build" && mkdir -p "$HOME_DIR/releases/$build"
  tar -xzf "$tmp/$name" -C "$HOME_DIR/releases/$build" --no-same-owner
  ln -sfn "releases/$build" $HOME_DIR/current.next && mv -T $HOME_DIR/current.next $HOME_DIR/current
fi

# ---- HTTPS ----
say "Caddy: https://$DOMAIN"
CADDY_FILE=/etc/caddy/Caddyfile
if [ -f $CADDY_FILE ] && ! grep -q 'Raid OS' $CADDY_FILE; then cp $CADDY_FILE "$CADDY_FILE.bak-$(date +%Y%m%d%H%M%S)"; fi
cat > $CADDY_FILE <<EOF
# Raid OS (written by install.sh). Cloudflare's edge addresses are trusted for the visitor's address (CF-Connecting-IP).
{
	servers {
		trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
		client_ip_headers CF-Connecting-IP X-Forwarded-For
	}
}

$DOMAIN, www.$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:5202 {
		header_up CF-Connecting-IP {client_ip}
	}
}
EOF
caddy validate --config $CADDY_FILE --adapter caddyfile >/dev/null || die "Caddyfile не прошёл проверку"

systemctl daemon-reload
systemctl enable --now raidos-api raidos-site >/dev/null
systemctl restart raidos-api raidos-site
systemctl enable --now raidos-update.timer >/dev/null
systemctl enable caddy >/dev/null && systemctl reload-or-restart caddy

say "Проверка"
ok=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8787/health >/dev/null && curl -fsS --max-time 3 http://127.0.0.1:5202/ >/dev/null; then ok=1; break; fi
  sleep 2
done
[ $ok = 1 ] || { journalctl -u raidos-api -n 40 --no-pager; die "Сервер не ответил за минуту (журнал выше)"; }
echo "API: $(curl -fsS http://127.0.0.1:8787/health)"
echo "Версия: $(cat $HOME_DIR/current/build-info.json)"
# The players' exe (≈160 MB) and later versions: the updater, in the background.
systemctl start --no-block raidos-update.service

cat <<EOF

Готово. Дальше:
  1. DNS: запись A для $DOMAIN и www.$DOMAIN → IP этого сервера (через Cloudflare — можно с оранжевым облаком).
  2. Настройки оплаты и писем: nano $ETC_DIR/raidos.env, затем systemctl restart raidos-api
  3. ЮKassa → HTTP-уведомления: https://$DOMAIN/v1/payments/yookassa/webhook
Журналы: journalctl -u raidos-api -f  ·  обновления: cat $STATE_DIR/update.log  ·  состояние: bash install.sh --check
EOF
