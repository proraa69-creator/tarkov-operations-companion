#!/usr/bin/env bash
# Splits a built exe into <=25 MB parts (chat upload limit is 30 MB) and writes a
# one-click Windows script that joins them into the exe on the user's Desktop.
# Usage: scripts/split-exe-for-chat.sh "<owner exe>" <new empty output dir> ["<client exe>" "<client build-info.json>"]
#
# Two editions (electron/buildEdition.ts, scripts/write-build-info.mjs):
#   - the owner exe (OWNER_BUILD=1 OWNER_EMAILS=…): the owner's gaming PC (Join-Raid-OS.cmd, signs in to raidos.app) and the server laptop
#     (Server-Laptop-Setup.cmd). Parts: RaidOS.part*
#   - the client exe (default build): what players download from the site. Parts: RaidOSClient.part*
#     Server-Laptop-Setup.cmd puts it into %LOCALAPPDATA%\TarkovOperatorServer\client\ with version.json (from the
#     client's dist-electron/build-info.json, saved right after the client build), and the laptop's site then serves
#     it for «Скачать для Windows» and auto-update (electron/localServer.ts). Join-Raid-OS-Client.cmd only
#     puts the client exe on the desktop (to test it or send it to someone).
#     version.json is signed (scripts/sign-client-release.mjs): players' copies install only a build whose manifest
#     verifies with the key built into the app. The private key comes from RAIDOS_UPDATE_SIGNING_KEY_FILE (path to the
#     Ed25519 PEM) or RAIDOS_UPDATE_SIGNING_KEY (the PEM, or base64 of it). Without a key the script refuses to make
#     the client parts, unless ALLOW_UNSIGNED=1 (then the site still offers the download, but no player auto-updates).
set -euo pipefail

EXE="${1:?path to exe}"
OUT="${2:?output dir (must not exist or be empty)}"
CLIENT_EXE="${3:-}"
CLIENT_INFO="${4:-}"
PART_SIZE="${PART_SIZE:-25M}"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f "$EXE" ] || { echo "exe not found: $EXE" >&2; exit 1; }
if [ -n "$CLIENT_EXE" ]; then
  [ -f "$CLIENT_EXE" ] || { echo "client exe not found: $CLIENT_EXE" >&2; exit 1; }
  [ -f "$CLIENT_INFO" ] || { echo "client build-info.json not found: $CLIENT_INFO (copy dist-electron/build-info.json right after the client build)" >&2; exit 1; }
  if [ -n "${RAIDOS_UPDATE_SIGNING_KEY:-}" ] || [ -n "${RAIDOS_UPDATE_SIGNING_KEY_FILE:-}" ]; then
    # One line of signed JSON; the script refuses anything that is not a client build or a key the app does not know.
    CLIENT_VERSION_JSON="$(node "$SCRIPTS_DIR/sign-client-release.mjs" "$CLIENT_EXE" "$CLIENT_INFO")"
  elif [ "${ALLOW_UNSIGNED:-}" = "1" ]; then
    {
      echo '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
      echo '!! ALLOW_UNSIGNED=1: the players version is published WITHOUT a signature.'
      echo '!! The site still offers it for download, but NO PLAYER WILL AUTO-UPDATE to it'
      echo '!! (their apps install only builds signed with RAIDOS_UPDATE_SIGNING_KEY).'
      echo '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
    } >&2
    CLIENT_VERSION_JSON="$(node -e '
      const info = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
      if (info.edition !== "client") { console.error("not a client build-info.json (edition: " + info.edition + ")"); process.exit(1) }
      const safe = (value) => String(value ?? "").replace(/[^0-9A-Za-z._-]/g, "")
      process.stdout.write(JSON.stringify({ version: safe(info.version), build: Number(info.build) || 0, commit: safe(info.commit) }))
    ' "$CLIENT_INFO")"
  else
    echo "refusing to publish the players version unsigned: set RAIDOS_UPDATE_SIGNING_KEY_FILE=<path to the update signing key PEM>" >&2
    echo "(or RAIDOS_UPDATE_SIGNING_KEY), or ALLOW_UNSIGNED=1 to publish it without auto-update for players" >&2
    exit 1
  fi
  # cmd.exe echoes this line into version.json: only characters it leaves alone (no % ^ & | < > ! spaces or newlines).
  node -e 'process.exit(/^[A-Za-z0-9{}":,._+\/=-]+$/.test(process.argv[1]) ? 0 : 1)' "$CLIENT_VERSION_JSON" \
    || { echo "unexpected characters in the players version.json: $CLIENT_VERSION_JSON" >&2; exit 1; }
fi
mkdir -p "$OUT"
if [ -n "$(ls -A "$OUT")" ]; then echo "output dir is not empty: $OUT" >&2; exit 1; fi

NAME="$(basename "$EXE")"
HASH="$(sha256sum "$EXE" | cut -d' ' -f1)"
split -b "$PART_SIZE" -d -a 1 "$EXE" "$OUT/RaidOS.part"

PARTS=()
for f in "$OUT"/RaidOS.part*; do PARTS+=("$(basename "$f")"); done
JOIN="$(IFS=+; echo "${PARTS[*]}")"

# ASCII-only, CRLF: cmd.exe misreads UTF-8 and LF-only batch files.
{
  echo '@echo off'
  echo 'setlocal'
  echo 'cd /d "%~dp0"'
  echo "title Raid OS - join exe"
  for p in "${PARTS[@]}"; do
    echo "if not exist \"$p\" ( echo Missing file: $p - download all parts into this folder. & pause & exit /b 1 )"
  done
  # the owner's desktop first; else the Desktop Windows reports (OneDrive too); else %USERPROFILE%\Desktop
  echo 'set "DESK="'
  echo "if exist \"${DESKTOP_HINT:-C:\\Users\\BANGKOK PC\\Desktop}\\\" set \"DESK=${DESKTOP_HINT:-C:\\Users\\BANGKOK PC\\Desktop}\""
  echo 'if not defined DESK for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)"`) do set "DESK=%%D"'
  echo 'if not defined DESK set "DESK=%USERPROFILE%\Desktop"'
  echo "set \"TARGET=%DESK%\\$NAME\""
  echo 'echo Joining parts into "%TARGET%" ...'
  echo "copy /b /y $JOIN \"%TARGET%\" >nul"
  echo 'if errorlevel 1 ( echo Join failed. Close the running app if it is open and try again. & pause & exit /b 1 )'
  echo 'echo Checking SHA256 ...'
  echo "powershell -NoProfile -Command \"if ((Get-FileHash -Algorithm SHA256 -LiteralPath \$env:TARGET).Hash -ieq '$HASH') { exit 0 } else { exit 1 }\""
  echo 'if errorlevel 1 ( echo HASH MISMATCH - a part is damaged, download the parts again. & pause & exit /b 1 )'
  echo 'echo OK: "%TARGET%"'
  echo 'echo You can now delete the .part files and this script.'
  # The owner's gaming PC: just the app. It signs in to the owner's server at https://raidos.app (the server laptop,
  # Server-Laptop-Setup.cmd with --server-mode); it no longer turns on a second, empty local server here
  # (--enable-local-server), where the owner's account would not exist.
  if [ "${JOIN_LAUNCH:-1}" = "0" ]; then
    # Test builds for friends: only put the exe on the desktop (starting it here would use up one of its launches).
    echo 'echo The exe is on your desktop. Send this file to the tester, do not start it here.'
    echo 'pause'
  else
    echo 'echo Starting the app...'
    echo 'start "" "%TARGET%"'
    echo 'timeout /t 5 >nul'
  fi
} | sed 's/$/\r/' > "$OUT/Join-Raid-OS.cmd"

if [ -n "$CLIENT_EXE" ]; then
  CLIENT_NAME="$(basename "$CLIENT_EXE")"
  CLIENT_HASH="$(sha256sum "$CLIENT_EXE" | cut -d' ' -f1)"
  split -b "$PART_SIZE" -d -a 1 "$CLIENT_EXE" "$OUT/RaidOSClient.part"
  CLIENT_PARTS=()
  for f in "$OUT"/RaidOSClient.part*; do CLIENT_PARTS+=("$(basename "$f")"); done
  CLIENT_JOIN="$(IFS=+; echo "${CLIENT_PARTS[*]}")"

  # The players' exe on the desktop, not started (to test it or to send it to someone).
  {
    echo '@echo off'
    echo 'setlocal'
    echo 'cd /d "%~dp0"'
    echo "title Raid OS (players) - join exe"
    for p in "${CLIENT_PARTS[@]}"; do
      echo "if not exist \"$p\" ( echo Missing file: $p - download all parts into this folder. & pause & exit /b 1 )"
    done
    echo 'set "DESK="'
    echo 'for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)"`) do set "DESK=%%D"'
    echo 'if not defined DESK set "DESK=%USERPROFILE%\Desktop"'
    echo "set \"TARGET=%DESK%\\$CLIENT_NAME\""
    echo "copy /b /y $CLIENT_JOIN \"%TARGET%\" >nul"
    echo 'if errorlevel 1 ( echo Join failed. & pause & exit /b 1 )'
    echo "powershell -NoProfile -Command \"if ((Get-FileHash -Algorithm SHA256 -LiteralPath \$env:TARGET).Hash -ieq '$CLIENT_HASH') { exit 0 } else { exit 1 }\""
    echo 'if errorlevel 1 ( echo HASH MISMATCH - a part is damaged, download the parts again. & pause & exit /b 1 )'
    echo 'echo OK: "%TARGET%" (players version, not started)'
    echo 'pause'
  } | sed 's/$/\r/' > "$OUT/Join-Raid-OS-Client.cmd"
fi

# The laptop that keeps the server on (docs/laptop-server.md): the owner exe, installed to a fixed folder and started
# with --server-mode (server + site + public link only). Running it again is the update: it stops the old copy first.
# With a client exe it also publishes the players' version for the site's «Скачать для Windows».
{
  echo '@echo off'
  echo 'setlocal'
  echo 'cd /d "%~dp0"'
  echo "title Raid OS - server laptop setup / update"
  for p in "${PARTS[@]}"; do
    echo "if not exist \"$p\" ( echo Missing file: $p - download all parts into this folder. & pause & exit /b 1 )"
  done
  if [ -n "$CLIENT_EXE" ]; then
    for p in "${CLIENT_PARTS[@]}"; do
      echo "if not exist \"$p\" ( echo Missing file: $p - download all parts into this folder. & pause & exit /b 1 )"
    done
  fi
  # The folder keeps its name from before the rename to «Raid OS» (the server data itself is in %APPDATA%\Tarkov Operator).
  echo 'set "DIR=%LOCALAPPDATA%\TarkovOperatorServer"'
  # A laptop set up before the rename keeps its «Tarkov Operator Server.exe» (an autostart shortcut may point to it).
  echo 'set "TARGET=%DIR%\Raid OS Server.exe"'
  echo 'if exist "%DIR%\Tarkov Operator Server.exe" set "TARGET=%DIR%\Tarkov Operator Server.exe"'
  echo 'if not exist "%DIR%" mkdir "%DIR%"'
  echo 'echo Stopping the running server copy (if any) ...'
  # The portable stub (<name> Server.exe) runs the app unpacked under the product name: «Raid OS.exe», or
  # «Tarkov Operator.exe» for a copy from before the rename. Close its window normally (the database is closed
  # cleanly), then make sure the stub is gone so its file can be replaced.
  echo 'taskkill /im "Raid OS.exe" >nul 2>&1'
  echo 'taskkill /im "Tarkov Operator.exe" >nul 2>&1'
  echo 'timeout /t 6 >nul'
  echo 'taskkill /im "Raid OS Server.exe" /f >nul 2>&1'
  echo 'taskkill /im "Tarkov Operator Server.exe" /f >nul 2>&1'
  echo 'timeout /t 2 >nul'
  echo 'echo Joining parts into "%TARGET%" ...'
  echo "copy /b /y $JOIN \"%TARGET%\" >nul"
  echo 'if errorlevel 1 ( echo Join failed. Close the server app and try again. & pause & exit /b 1 )'
  echo 'echo Checking SHA256 ...'
  echo "powershell -NoProfile -Command \"if ((Get-FileHash -Algorithm SHA256 -LiteralPath \$env:TARGET).Hash -ieq '$HASH') { exit 0 } else { exit 1 }\""
  echo 'if errorlevel 1 ( echo HASH MISMATCH - a part is damaged, download the parts again. & pause & exit /b 1 )'
  if [ -n "$CLIENT_EXE" ]; then
    echo 'set "CLIENT=%DIR%\client"'
    echo 'if not exist "%CLIENT%" mkdir "%CLIENT%"'
    echo 'del /f /q "%CLIENT%\*.exe" >nul 2>&1'
    echo "set \"CLIENT_TARGET=%CLIENT%\\$CLIENT_NAME\""
    echo 'echo Publishing the players version for the website ...'
    echo "copy /b /y $CLIENT_JOIN \"%CLIENT_TARGET%\" >nul"
    echo 'if errorlevel 1 ( echo Join of the players version failed. & pause & exit /b 1 )'
    echo "powershell -NoProfile -Command \"if ((Get-FileHash -Algorithm SHA256 -LiteralPath \$env:CLIENT_TARGET).Hash -ieq '$CLIENT_HASH') { exit 0 } else { exit 1 }\""
    echo 'if errorlevel 1 ( echo HASH MISMATCH in the players version - download the parts again. & pause & exit /b 1 )'
    echo ">\"%CLIENT%\\version.json\" echo $CLIENT_VERSION_JSON"
  fi
  echo 'echo Starting the server, the website and the public link ...'
  echo 'start "" "%TARGET%" --server-mode --enable-tunnel'
  echo 'echo Done. The database is kept between updates. You can delete the .part files and this script.'
  echo 'timeout /t 8 >nul'
} | sed 's/$/\r/' > "$OUT/Server-Laptop-Setup.cmd"

echo "sha256 $HASH"
[ -n "$CLIENT_EXE" ] && echo "client sha256 $CLIENT_HASH · $CLIENT_VERSION_JSON"
ls -la "$OUT"
