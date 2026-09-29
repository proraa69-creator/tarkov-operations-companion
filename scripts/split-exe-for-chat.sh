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
  echo 'echo Starting Tarkov Operator ... You can now delete the .part files and this script.'
  # The owner's copy also runs the account server and the website (--enable-local-server) and opens the site;
  # the exe itself stays a plain app when it is sent to someone else.
  echo 'echo Starting the app, the server and the website...'
  echo 'start "" "%TARGET%" --enable-local-server'
  echo 'timeout /t 5 >nul'
} | sed 's/$/\r/' > "$OUT/Join-Tarkov-Operator.cmd"

echo "sha256 $HASH"
ls -la "$OUT"
