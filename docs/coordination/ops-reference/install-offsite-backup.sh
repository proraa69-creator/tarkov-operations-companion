#!/bin/bash
# Installs the off-server database copy: the newest daily copy, encrypted on the server, to the owner's S3 storage once a day
set -euo pipefail
command -v rclone >/dev/null || DEBIAN_FRONTEND=noninteractive timeout 600 apt-get install -y -o DPkg::Lock::Timeout=300 rclone >/tmp/rclone-install.log 2>&1
mkdir -p /usr/local/lib/raidos-backup
cat > /usr/local/lib/raidos-backup/offsite-copy.sh <<'EOF'
#!/bin/bash
# Raid OS (27.11.2026): the newest daily database copy, encrypted here (AES-256, the server's own /etc/raidos/backup-pass),
# to the owner's S3 storage; 30 days kept there. Waits quietly until /etc/raidos/backup-s3.env exists (the owner writes it).
set -euo pipefail
ENV=/etc/raidos/backup-s3.env
[ -f "$ENV" ] || { echo "no $ENV yet: nothing sent"; exit 0; }
while IFS= read -r line; do
  line=${line%$'\r'}
  if [[ "$line" =~ ^(S3_[A-Z_]+)=\'([^\']*)\'$ ]]; then declare "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"; fi
done < "$ENV"
for name in S3_ENDPOINT S3_REGION S3_BUCKET S3_KEY_ID S3_SECRET; do [ -n "${!name:-}" ] || { echo "$name missing in $ENV" >&2; exit 1; }; done
PASS=/etc/raidos/backup-pass
if [ ! -s "$PASS" ]; then (umask 077; openssl rand -base64 48 > "$PASS"); chmod 600 "$PASS"; fi
DIR=/var/lib/raidos/map-mirror/.server-storage/var/backups/raidos-db-daily
latest=$(ls -1t "$DIR"/companion-*.sqlite.gz 2>/dev/null | head -1 || true)
[ -n "$latest" ] || { echo "no daily copy yet" >&2; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf -- "$tmp"' EXIT
name="$(basename "$latest").enc"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass file:"$PASS" -in "$latest" -out "$tmp/$name"
export RCLONE_CONFIG_RAIDOS_TYPE=s3 RCLONE_CONFIG_RAIDOS_PROVIDER=Other RCLONE_CONFIG_RAIDOS_ENDPOINT="$S3_ENDPOINT" \
  RCLONE_CONFIG_RAIDOS_REGION="$S3_REGION" RCLONE_CONFIG_RAIDOS_ACCESS_KEY_ID="$S3_KEY_ID" RCLONE_CONFIG_RAIDOS_SECRET_ACCESS_KEY="$S3_SECRET"
rclone copy "$tmp/$name" "raidos:$S3_BUCKET/raidos-db/" --s3-no-check-bucket
rclone delete "raidos:$S3_BUCKET/raidos-db/" --min-age 30d --s3-no-check-bucket || true
echo "offsite copy $name, $(stat -c %s "$tmp/$name") bytes"
EOF
chmod 755 /usr/local/lib/raidos-backup/offsite-copy.sh
# the encryption pass exists from the start, so the owner can keep it off the server before the first copy
[ -s /etc/raidos/backup-pass ] || (umask 077; openssl rand -base64 48 > /etc/raidos/backup-pass)
chmod 600 /etc/raidos/backup-pass
echo "backup pass: $(stat -c "%s bytes, %a" /etc/raidos/backup-pass)"
cat > /etc/systemd/system/raidos-db-offsite.service <<'EOF'
[Unit]
Description=Raid OS encrypted database copy to the owner's S3 storage
After=raidos-db-copy.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Nice=10
IOSchedulingClass=idle
ExecStart=/usr/local/lib/raidos-backup/offsite-copy.sh
EOF
cat > /etc/systemd/system/raidos-db-offsite.timer <<'EOF'
[Unit]
Description=Raid OS encrypted database copy to S3 (03:00 UTC, after the daily copy)

[Timer]
OnCalendar=*-*-* 03:00:00 UTC
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now raidos-db-offsite.timer >/dev/null 2>&1
echo "rclone: $(rclone version 2>/dev/null | head -1)"
systemctl start raidos-db-offsite.service; journalctl -u raidos-db-offsite.service -n 2 --no-pager -o cat | tail -1
systemctl list-timers raidos-db-offsite.timer --no-pager --no-legend | cut -c1-80
