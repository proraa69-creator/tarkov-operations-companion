# Raid OS server on a Linux VPS (Ubuntu)

The server and the website run on an Ubuntu VPS (Timeweb Cloud) instead of the owner's Windows laptop. The same
release that updates the laptop carries a signed Linux bundle; the VPS installs it by itself.

## What runs where

| Part | Service | Address |
| --- | --- | --- |
| API (`server/`, bundled `api/server.cjs`) | `raidos-api` (user `raidos`) | `127.0.0.1:8787` |
| Website + `/v1` proxy + downloads (`electron/linux/siteServer.ts`) | `raidos-site` | `127.0.0.1:5202` |
| HTTPS for `raidos.app` / `www.raidos.app` | `caddy` | `:80`, `:443` |
| Auto-update (`electron/linux/updater.ts`) | `raidos-update.timer`, every 5 minutes | — |

Folders: `/opt/raidos/releases/<build>` and `/opt/raidos/current` (the running build), `/var/lib/raidos`
(`companion.sqlite`, `entitlement-ed25519.pem`, `backups/`, `client/` with the players' exe), `/etc/raidos/raidos.env`
(API settings: owner e-mails, public address, ЮKassa, e-mail), `/etc/raidos/updater.env` (read-only GitHub token),
`/var/lib/raidos-updater/update.log`.

## Install (once, in the VPS console as root)

The installer lives in the private `raidos-releases` repository (`linux/install.sh`), so it is fetched with a
**read-only** fine-grained GitHub token (Repository access: only `raidos-releases`, Permissions: Contents → Read).
The token is typed on the VPS only — never into a chat.

```bash
read -rsp 'GitHub token: ' T; echo; curl -fsSL -H "Authorization: Bearer $T" -H 'Accept: application/vnd.github.raw+json' \
  https://api.github.com/repos/proraa69-creator/raidos-releases/contents/linux/install.sh -o install.sh && \
  bash install.sh --check && RAIDOS_GITHUB_TOKEN="$T" bash install.sh
```

`--check` only reports (system, memory, disk, Node, ports 80/443/5202/8787, services, `companion.sqlite` files, DNS).
The install stops instead of taking over a port another program uses. Taking over the laptop's data on the first
install: `RAIDOS_IMPORT_DB=/root/companion.sqlite RAIDOS_IMPORT_KEY=/root/entitlement-ed25519.pem bash install.sh`
(an existing `/var/lib/raidos/companion.sqlite` is never replaced).

## Updates

Every release the build session publishes (`scripts/publish-release.sh`) contains `RaidOS-linux.json` and
`raidos-server-<build>.tar.gz` (`scripts/build-linux-server.mjs`). The timer checks `latest.json`; a new build is
installed only when `RaidOS-linux.json` verifies with the update key built into the updater and the bundle has
exactly the signed size and SHA-256. After the switch both services must answer `/health` within a minute, or the
previous build is restored and the new one is skipped (`/var/lib/raidos-updater/skipped.json`; retry:
`node /opt/raidos/current/bin/raidos-update.cjs --force` with the updater environment). The players' exe for
«Скачать для Windows» and their auto-update comes from the same release (`RaidOS-update.json`, verified part by part).

## Day to day

- Logs: `journalctl -u raidos-api -f`, `journalctl -u raidos-site -f`, `cat /var/lib/raidos-updater/update.log`
- Settings: `nano /etc/raidos/raidos.env`, then `systemctl restart raidos-api`. YooKassa uses
  `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `TARKOV_PRICE_MONTH_RUB=300`, `TARKOV_PUBLIC_URL=https://raidos.app`
  and `YOOKASSA_PAYMENT_METHODS=sbp,sberbank,tinkoff_bank`. List only methods actually enabled for the shop;
  unknown or unlisted methods are rejected by the API. Set `YOOKASSA_AUTOPAY=1` only after YooKassa enables saved
  payment methods and recurring charges for the shop. Keep it unset otherwise.
- Check now: `systemctl start raidos-update.service`
- ЮKassa HTTP notifications: `https://raidos.app/v1/payments/yookassa/webhook`

Not on Linux (owner-app features of the Windows laptop): the admin panel's «Обновление» card and the payment settings
form — on the VPS updates are automatic and payment settings live in `/etc/raidos/raidos.env`.
