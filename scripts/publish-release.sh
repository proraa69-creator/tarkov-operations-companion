#!/usr/bin/env bash
# Puts one signed release into the private releases repository the server laptop updates itself from
# («Автообновление сервера», electron/selfUpdate.ts, docs/laptop-server.md):
#   scripts/publish-release.sh <parts dir from split-exe-for-chat.sh> <local clone of the releases repository>
#
# The parts dir must hold RaidOS-update.json (made by split-exe-for-chat.sh with the signing key) and every part it
# lists. The script checks the signature with the public key in electron/updateSigningKey.ts and every part's size and
# SHA-256 before it copies anything, then:
#   releases/<build>/RaidOS-update.json, RaidOS.partN, RaidOSClient.partN
#   latest.json  {"build": <build>, "path": "releases/<build>"}   (only moves forward, unless ALLOW_OLDER=1)
# keeps the newest KEEP (default 3) release folders (older ones are removed in the same, normal commit) and commits.
# It never pushes: `git -C <clone> push` afterwards. The repository must stay PRIVATE (the parts are the owner's exe).
set -euo pipefail

PARTS="${1:?parts dir (with RaidOS-update.json)}"
REPO="${2:?local clone of the releases repository}"
KEEP="${KEEP:-3}"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f "$PARTS/RaidOS-update.json" ] || { echo "no RaidOS-update.json in $PARTS (run split-exe-for-chat.sh with RAIDOS_UPDATE_SIGNING_KEY_FILE)" >&2; exit 1; }
git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "not a git clone: $REPO" >&2; exit 1; }
[[ "$KEEP" =~ ^[1-9][0-9]?$ ]] || { echo "KEEP must be 1-99" >&2; exit 1; }

# Signature (embedded public key) and every listed part; prints "<build> <version> <part names…>".
read -r BUILD VERSION FILES < <(node --input-type=module -e '
  import { createHash, verify } from "node:crypto"
  import { readFileSync } from "node:fs"
  import { join } from "node:path"
  const [dir, scripts] = process.argv.slice(1)
  const { embeddedPublicKey } = await import(join(scripts, "sign-client-release.mjs"))
  const { canonicalServerUpdatePayload } = await import(join(scripts, "sign-server-update.mjs"))
  const manifest = JSON.parse(readFileSync(join(dir, "RaidOS-update.json"), "utf8"))
  const { signature, ...fields } = manifest
  if (!verify(null, Buffer.from(canonicalServerUpdatePayload(fields), "utf8"), embeddedPublicKey(), Buffer.from(String(signature ?? ""), "base64"))) {
    console.error("RaidOS-update.json: the signature does not verify with electron/updateSigningKey.ts"); process.exit(1)
  }
  const parts = [...fields.owner.parts, ...(fields.client?.parts ?? [])]
  for (const part of parts) {
    const data = readFileSync(join(dir, part.name))
    if (data.length !== part.size || createHash("sha256").update(data).digest("hex") !== part.sha256) { console.error(`${part.name}: size or SHA-256 differs from RaidOS-update.json`); process.exit(1) }
  }
  console.log([fields.build, fields.version, ...parts.map((part) => part.name)].join(" "))
' "$PARTS" "$SCRIPTS_DIR")
[ -n "${BUILD:-}" ] || { echo "could not read the release" >&2; exit 1; }

TARGET="$REPO/releases/$BUILD"
if [ -e "$TARGET" ]; then echo "already published: releases/$BUILD" >&2; exit 1; fi
CURRENT="$(node -e 'try { const l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(Number(l.build) || 0) } catch { console.log(0) }' "$REPO/latest.json")"
if [ "$BUILD" -le "$CURRENT" ] && [ "${ALLOW_OLDER:-}" != "1" ]; then
  echo "latest.json already points at build $CURRENT; $BUILD is not newer (the laptop never downgrades). ALLOW_OLDER=1 to publish anyway." >&2
  exit 1
fi

mkdir -p "$TARGET"
cp "$PARTS/RaidOS-update.json" "$TARGET/"
for name in $FILES; do cp "$PARTS/$name" "$TARGET/"; done
# The Linux server (scripts/build-linux-server.mjs → <parts>/linux): its signed bundle goes next to the Windows parts,
# its installer to linux/install.sh of the repository (docs/linux-server.md). Only a bundle of this very build.
if [ -f "$PARTS/linux/RaidOS-linux.json" ] && [ -f "$PARTS/linux/raidos-server-$BUILD.tar.gz" ]; then
  cp "$PARTS/linux/RaidOS-linux.json" "$PARTS/linux/raidos-server-$BUILD.tar.gz" "$TARGET/"
  mkdir -p "$REPO/linux" && cp "$PARTS/linux/install.sh" "$REPO/linux/install.sh"
  git -C "$REPO" add linux/install.sh
elif [ -d "$PARTS/linux" ]; then
  echo "warning: $PARTS/linux has no signed bundle of build $BUILD — the Linux server is not updated by this release" >&2
fi
printf '{"build":%s,"path":"releases/%s"}\n' "$BUILD" "$BUILD" > "$REPO/latest.json"
git -C "$REPO" add "releases/$BUILD" latest.json

# Keep the newest $KEEP release folders.
mapfile -t OLD < <(find "$REPO/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -E '^[0-9]+$' | sort -n | head -n "-$KEEP")
for build in "${OLD[@]}"; do
  [ "$build" = "$BUILD" ] && continue
  git -C "$REPO" rm -r -q --ignore-unmatch "releases/$build"
done

git -C "$REPO" commit -q -m "Release $VERSION (build $BUILD)"
echo "Committed releases/$BUILD ($VERSION) and latest.json in $REPO${OLD[*]:+; removed old: ${OLD[*]}}"
echo "Push it: git -C \"$REPO\" push"
