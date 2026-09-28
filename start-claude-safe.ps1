$ErrorActionPreference = "Stop"

$claudeExe = "C:\Users\BANGKOK PC\AppData\Local\Microsoft\WinGet\Packages\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\claude.exe"
$projectRoot = "C:\Users\BANGKOK PC\Documents\Codex\2026-09-25\escape-from-tarkov"

if (-not (Test-Path -LiteralPath $claudeExe)) {
  Write-Error "Claude Code was not found at: $claudeExe"
}

if (-not (Test-Path -LiteralPath $projectRoot)) {
  Write-Error "Project folder was not found at: $projectRoot"
}

Set-Location -LiteralPath $projectRoot

& $claudeExe `
  --permission-mode manual `
  --add-dir "C:\Users\BANGKOK PC\Documents\Codex" `
  --add-dir "C:\Users\BANGKOK PC\Documents\Codex\2026-09-25\escape-from-tarkov" `
  --add-dir "C:\Users\BANGKOK PC\Documents\ChatGPT\Бетховен" `
  --add-dir "C:\Users\BANGKOK PC\AIPASS" `
  --add-dir "C:\Users\BANGKOK PC\ai-media-bot" `
  --add-dir "C:\Users\BANGKOK PC\CoreThree" `
  --add-dir "C:\Users\BANGKOK PC\vibe-site" `
  --add-dir "C:\Users\BANGKOK PC\Documents\Codex\2026-09-27\new-chat"

