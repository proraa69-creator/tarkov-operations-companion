<#
.SYNOPSIS
  Запускает API-сервер и сайт Tarkov Operations Companion на этом компьютере.

.DESCRIPTION
  Два фоновых процесса:
    - API-сервер   http://127.0.0.1:8787  (npm --prefix server start, база SQLite: server\data\companion.sqlite)
    - Сайт         http://localhost:5202  (npm --prefix website run dev)
  Журналы: server\data\logs\. Остановить: .\scripts\start-local.ps1 -Stop
  Совместим с Windows PowerShell 5.1. Подробности: docs\local-server.md

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Stop
#>
[CmdletBinding()]
param(
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root 'server\data'
$logDir = Join-Path $dataDir 'logs'
$pidFile = Join-Path $dataDir 'local-processes.json'
$apiUrl = 'http://127.0.0.1:8787'
$siteUrl = 'http://localhost:5202'

function Test-Port([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(400)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Stop-Started {
  if (-not (Test-Path $pidFile)) {
    Write-Host 'Нет запущенных через этот скрипт процессов.'
    return
  }
  $saved = @((Get-Content -Raw -Path $pidFile | ConvertFrom-Json) | ForEach-Object { $_ })
  foreach ($entry in $saved) {
    if (Get-Process -Id $entry.pid -ErrorAction SilentlyContinue) {
      # /T останавливает и дочерний node.exe, который запускает npm.
      & taskkill.exe /PID $entry.pid /T /F | Out-Null
      Write-Host ("Остановлен: {0} (PID {1})" -f $entry.name, $entry.pid)
    }
  }
  Remove-Item -Force $pidFile
}

if ($Stop) {
  Stop-Started
  return
}

# --- Проверки -------------------------------------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js не найден. Установите Node.js 22.13+ (LTS) и откройте новое окно PowerShell.' }
$nodeVersion = (& node -p "process.versions.node").Trim()
$parts = $nodeVersion.Split('.')
if ([int]$parts[0] -lt 22 -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -lt 13)) {
  throw "Нужен Node.js 22.13 или новее (встроенный node:sqlite). Сейчас: $nodeVersion"
}
if (-not (Test-Path (Join-Path $root 'node_modules'))) { throw 'Нет node_modules в корне проекта. Выполните: npm install' }
if (-not (Test-Path (Join-Path $root 'server\node_modules'))) { throw 'Нет server\node_modules. Выполните: npm --prefix server install' }

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# --- Окружение для дочерних процессов -------------------------------------------------------------------------
# CORS: только локальный сайт и dev-сервер интерфейса приложения. Само приложение ходит на сервер из main-процесса.
$env:WEB_ORIGIN = 'http://localhost:5202,http://127.0.0.1:5202,http://localhost:5173,http://127.0.0.1:5173'
$env:TARKOV_DB_PATH = Join-Path $dataDir 'companion.sqlite'
$env:HOST = '127.0.0.1'
$env:PORT = '8787'
$env:VITE_API_URL = $apiUrl

$started = @()
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Start-Background([string]$Name, [string[]]$NpmArgs, [int]$Port) {
  if (Test-Port $Port) {
    Write-Host ("{0}: порт {1} уже занят, считаю, что уже запущен." -f $Name, $Port) -ForegroundColor Yellow
    return $null
  }
  $out = Join-Path $logDir ("{0}-{1}.log" -f $Name, $stamp)
  $err = Join-Path $logDir ("{0}-{1}.err.log" -f $Name, $stamp)
  $process = Start-Process -FilePath 'npm.cmd' -ArgumentList $NpmArgs -WorkingDirectory $root `
    -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  Write-Host ("{0}: запущен (PID {1}), журнал {2}" -f $Name, $process.Id, $out)
  return @{ name = $Name; pid = $process.Id }
}

$api = Start-Background 'api' @('--prefix', 'server', 'start') 8787
if ($api) { $started += $api }
$site = Start-Background 'website' @('--prefix', 'website', 'run', 'dev') 5202
if ($site) { $started += $site }

if ($started.Count -gt 0) {
  $previous = @()
  if (Test-Path $pidFile) {
    # Скобки разворачивают массив из ConvertFrom-Json (в PowerShell 5.1 он приходит одним объектом).
    $previous = @((Get-Content -Raw -Path $pidFile | ConvertFrom-Json) | ForEach-Object { $_ } |
      Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue } |
      ForEach-Object { @{ name = $_.name; pid = $_.pid } })
  }
  ConvertTo-Json -InputObject @($previous + $started) | Set-Content -Path $pidFile -Encoding UTF8
}

# --- Ожидание готовности ----------------------------------------------------------------------------------------
$deadline = (Get-Date).AddSeconds(40)
$apiReady = $false
while ((Get-Date) -lt $deadline) {
  try {
    $health = Invoke-RestMethod -Uri "$apiUrl/health" -TimeoutSec 2
    if ($health.ok) { $apiReady = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 700
}
$siteReady = $false
while ((Get-Date) -lt $deadline) {
  if (Test-Port 5202) { $siteReady = $true; break }
  Start-Sleep -Milliseconds 700
}

Write-Host ''
if ($apiReady) { Write-Host "API-сервер: $apiUrl" -ForegroundColor Green } else { Write-Host "API-сервер не ответил, смотрите журналы в $logDir" -ForegroundColor Red }
if ($siteReady) { Write-Host "Сайт:       $siteUrl" -ForegroundColor Green } else { Write-Host "Сайт не ответил, смотрите журналы в $logDir" -ForegroundColor Red }
Write-Host "База данных: $env:TARKOV_DB_PATH"
Write-Host 'Остановить: .\scripts\start-local.ps1 -Stop'
