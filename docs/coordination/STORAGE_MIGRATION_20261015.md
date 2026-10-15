# Storage maintenance completed, 2026-10-15

Owner authorized Codex to free the system disk by safely moving inactive data to the secondary NVMe.

Moved 65 directories, 19,294,015,488 allocated bytes (about 18 GiB): 55 historical release backups, three repair backups and seven legacy build-artifact directories. Destination: `/var/lib/raidos/map-mirror/.server-storage`, root-owned 0700. Original paths are symlinks; each copy passed rsync checksum and metadata comparison before removal of the original directory. No user data or credentials were exported.

Root `/dev/sda1`: 84% used / 7.8 GiB free -> 46% used / 26 GiB free. Secondary `/dev/sdb`: 78% used / 6.2 GiB free after migration. Mount UUID remains `38702325-71f1-44be-9a49-018257ebbf27` at `/var/lib/raidos/map-mirror`. No formatting or fstab changes.

Kept current database/code/website/downloads, `/opt/raidos-builds`, and latest three rollback backups on root. Release-state-protected paths were excluded. Used release flock to exclude concurrent deployment; lock available afterward, release timer active. API PID stayed 380411, restart count zero. Website/cabinet HTTP 200, API/database healthy, client byte-range download MZ. Verified all 65 symlinks resolve; no source-directory migration remnants.

Published version observed: `0.6.0-39`, build `1792025733732`, commit label `c1a7ae4c4fdfd95a9d911062192c357ca0876fba-production`; signature field present, signature not cryptographically reverified in this task. No release/deployment performed.

Root-only audit: `/var/lib/raidos/map-mirror/.server-storage/migration-20261015.tsv`. Script: `/root/raidos-storage-migration-20261015.sh`. Archive paths require the existing secondary mount. Keep at least 6 GiB free there; leave active builds on root. Future releases still create backups on root. Cleanup scripts selecting physical directories skip migrated symlinks; inspect this archive separately before cleanup. No new backup redundancy or recurring storage policy was introduced.

The old source snapshot was not refreshed. This operation updates storage evidence only.
