#!/usr/bin/env bash
# Splits a built exe into <=25 MB parts (chat upload limit is 30 MB) and writes a
# one-click Windows script that joins them into the exe on the user's Desktop.
# Usage: scripts/split-exe-for-chat.sh "<path to exe>" <new empty output dir>
set -euo pipefail

EXE="${1:?path to exe}"
OUT="${2:?output dir (must not exist or be empty)}"
PART_SIZE="${PART_SIZE:-25M}"

[ -f "$EXE" ] || { echo "exe not found: $EXE" >&2; exit 1; }
mkdir -p "$OUT"
if [ -n "$(ls -A "$OUT")" ]; then echo "output dir is not empty: $OUT" >&2; exit 1; fi

NAME="$(basename "$EXE")"
HASH="$(sha256sum "$EXE" | cut -d' ' -f1)"
split -b "$PART_SIZE" -d -a 1 "$EXE" "$OUT/TarkovOperator.part"

PARTS=()
for f in "$OUT"/TarkovOperator.part*; do PARTS+=("$(basename "$f")"); done
JOIN="$(IFS=+; echo "${PARTS[*]}")"

# ASCII-only, CRLF: cmd.exe misreads UTF-8 and LF-only batch files.
{
  echo '@echo off'
  echo 'setlocal'
  echo 'cd /d "%~dp0"'
  echo "title Tarkov Operator - join exe"
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
  # The owner's copy also runs the account server and the website (--enable-local-server) and opens the site;
  # the exe itself stays a plain app when it is sent to someone else.
  if [ "${JOIN_LAUNCH:-1}" = "0" ]; then
    # Test builds for friends: only put the exe on the desktop (starting it here would use up one of its launches).
    echo 'echo The exe is on your desktop. Send this file to the tester, do not start it here.'
    echo 'pause'
  else
    echo 'echo Starting the app, the server and the website...'
    echo 'start "" "%TARGET%" --enable-local-server'
    echo 'timeout /t 5 >nul'
  fi
} | sed 's/$/\r/' > "$OUT/Join-Tarkov-Operator.cmd"

# The laptop that keeps the server on (docs/laptop-server.md): the same exe, installed to a fixed folder and started
# with --server-mode (server + site + public link only). Running it again is the update: it stops the old copy first.
{
  echo '@echo off'
  echo 'setlocal'
  echo 'cd /d "%~dp0"'
  echo "title Tarkov Operator - server laptop setup / update"
  for p in "${PARTS[@]}"; do
    echo "if not exist \"$p\" ( echo Missing file: $p - download all parts into this folder. & pause & exit /b 1 )"
  done
  echo 'set "DIR=%LOCALAPPDATA%\TarkovOperatorServer"'
  echo 'set "TARGET=%DIR%\Tarkov Operator Server.exe"'
  echo 'if not exist "%DIR%" mkdir "%DIR%"'
  echo 'echo Stopping the running server copy (if any) ...'
  # The portable stub (Tarkov Operator Server.exe) runs the app unpacked as «Tarkov Operator.exe»: close its window
  # normally (the database is closed cleanly), then make sure the stub is gone so its file can be replaced.
  echo 'taskkill /im "Tarkov Operator.exe" >nul 2>&1'
  echo 'timeout /t 6 >nul'
  echo 'taskkill /im "Tarkov Operator Server.exe" /f >nul 2>&1'
  echo 'timeout /t 2 >nul'
  echo 'echo Joining parts into "%TARGET%" ...'
  echo "copy /b /y $JOIN \"%TARGET%\" >nul"
  echo 'if errorlevel 1 ( echo Join failed. Close the server app and try again. & pause & exit /b 1 )'
  echo 'echo Checking SHA256 ...'
  echo "powershell -NoProfile -Command \"if ((Get-FileHash -Algorithm SHA256 -LiteralPath \$env:TARGET).Hash -ieq '$HASH') { exit 0 } else { exit 1 }\""
  echo 'if errorlevel 1 ( echo HASH MISMATCH - a part is damaged, download the parts again. & pause & exit /b 1 )'
  echo 'echo Starting the server, the website and the public link ...'
  echo 'start "" "%TARGET%" --server-mode --enable-tunnel'
  echo 'echo Done. The database is kept between updates. You can delete the .part files and this script.'
  echo 'timeout /t 8 >nul'
} | sed 's/$/\r/' > "$OUT/Server-Laptop-Setup.cmd"

echo "sha256 $HASH"
ls -la "$OUT"
