# Builds the Windows portable exe and copies it to the desktop.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-exe-to-desktop.ps1 [-Desktop "C:\path"] [-SkipInstall] [-Client]
# Default: the owner's build (OWNER_BUILD=1: «Аккаунт сервера», the «Сервер» button) for this PC.
# -Client: the players' build (account sign-in, «Личный кабинет», server https://raidos.app), see electron/buildEdition.ts.
param(
  [string]$Desktop = "C:\Users\BANGKOK PC\Desktop",
  [switch]$SkipInstall,
  [switch]$Client
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm не найден. Установите Node.js и перезапустите терминал.'
}

if (-not $SkipInstall -and -not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host '== npm install'
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install завершился с ошибкой.' }
}

if ($Client) { Remove-Item Env:OWNER_BUILD -ErrorAction SilentlyContinue; Write-Host '== версия для игроков (client)' }
else { $env:OWNER_BUILD = '1'; Write-Host '== версия владельца (owner)' }
Write-Host '== npm run dist:win'
$buildStart = Get-Date
npm run dist:win
$buildExit = $LASTEXITCODE
Remove-Item Env:OWNER_BUILD -ErrorAction SilentlyContinue
if ($buildExit -ne 0) { throw 'Сборка exe завершилась с ошибкой.' }

$exe = Get-ChildItem -Path (Join-Path $root 'release') -Filter '*.exe' -File |
  Where-Object { $_.LastWriteTime -ge $buildStart.AddSeconds(-5) } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $exe) { throw 'Сборка прошла, но новый exe в папке release не найден.' }

# The desktop may be redirected (for example to OneDrive); fall back to the real one.
if (-not (Test-Path -LiteralPath $Desktop -PathType Container)) {
  $fallback = [Environment]::GetFolderPath('Desktop')
  Write-Host "Папка $Desktop не найдена, использую $fallback"
  $Desktop = $fallback
}

$target = Join-Path $Desktop $exe.Name
try {
  # Only this one file is replaced; nothing else on the desktop is touched.
  Copy-Item -LiteralPath $exe.FullName -Destination $target -Force
} catch {
  throw "Не удалось скопировать exe на рабочий стол: $target. Если старая версия приложения запущена, закройте её и повторите. ($($_.Exception.Message))"
}

$sizeMb = [math]::Round((Get-Item -LiteralPath $target).Length / 1MB, 1)
Write-Host "== Готово: $target ($sizeMb МБ)"
