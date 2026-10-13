import { useState } from 'react'
import { Check, Copy, FolderOpen, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import { useAppVersion } from '../app/appVersion'
import { profileNickname } from '../account/nicknameBinding'
import { NicknameMissingHelp } from '../account/NicknameMissingHelp'
import { uiLabel } from '../i18n/renderText'
import { LOG_FOLDER_STORAGE_KEY } from '../import/logApply'
import { logSearchReportText, modeLines, type LogSearchReport } from '../import/logSearchReport'
import { updateLogStatus, useLogStatus } from '../import/logStatus'
import type { DesktopLogScan } from '../electron'
import { useAppState } from '../state/AppState'
import '../styles/gameLogs.css'

/**
 * Settings → «Журналы игры» in the PC app (owner, 13.10.2026: a Steam player's logs were «still not found», and the app
 * had no place that said what it read or let the player choose the folder): the Logs folder in use, the game launches
 * read, whether the logs showed each mode's game account, the nickname; «Найти снова», «Выбрать папку Logs» and «Где
 * искали журналы» with a report to copy for support.
 */
export function GameLogsSettings() {
  const desktop = window.tarkovDesktop
  const status = useLogStatus()
  const state = useAppState()
  const version = useAppVersion()
  const [busy, setBusy] = useState<'find' | 'pick' | 'report' | null>(null)
  const [report, setReport] = useState<LogSearchReport | null>(null)
  const [copied, setCopied] = useState(false)
  if (!desktop?.autoFindAndScanLogs || desktop.serverMode) return null
  const nickname = profileNickname(state.activeProfile)

  // A folder found or picked: the app reads it from now on (the main process sends its scan to AppShell, which applies it).
  const adopt = async (found: DesktopLogScan | null) => {
    if (!found) return false
    try { localStorage.setItem(LOG_FOLDER_STORAGE_KEY, found.folder) } catch { /* storage blocked */ }
    updateLogStatus({ folder: found.folder, scan: found, notFound: false })
    await desktop.startWatchingLogs(found.folder).catch(() => false)
    return true
  }
  const showReport = async () => {
    setBusy('report')
    try { setReport(await desktop.logSearchReport?.().catch(() => null) ?? null) } finally { setBusy(null) }
  }
  const findAgain = async () => {
    setBusy('find')
    let saved: string | undefined
    try { saved = localStorage.getItem(LOG_FOLDER_STORAGE_KEY) ?? undefined } catch { saved = undefined }
    const found = await desktop.autoFindAndScanLogs(saved).catch(() => null)
    setBusy(null)
    if (!await adopt(found)) {
      updateLogStatus({ notFound: true })
      await showReport()
    }
  }
  const pick = async () => {
    setBusy('pick')
    try { await adopt(await desktop.scanLogs().catch(() => null)) } finally { setBusy(null) }
  }
  const text = report ? logSearchReportText(report, version, status, nickname) : ''
  const copy = () => void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }).catch(() => {})

  return (
    <section className="panel game-logs" aria-labelledby="game-logs-title">
      <div className="panel-header">
        <div className="panel-title" id="game-logs-title">{uiLabel('Журналы игры')}</div>
        <span className={`tag ${status.scan ? 'green' : status.notFound ? 'danger' : ''}`}>{uiLabel(status.scan ? 'читаются' : status.notFound ? 'не найдены' : 'ищем')}</span>
      </div>
      <div className="panel-body">
        <div className="setting-row game-logs-row">
          <span>
            <strong>{uiLabel('Папка журналов')}</strong>
            <small className={status.folder ? 'game-logs-path' : undefined}>{status.folder ?? uiLabel(status.notFound ? 'Папка Logs не найдена. Выберите её: для Steam-версии это папка игры (в Steam: Управление → Просмотреть локальные файлы).' : 'Ищем папку Logs…')}</small>
          </span>
        </div>
        {status.scan && (
          <div className="setting-row game-logs-row">
            <span>
              <strong>{uiLabel('Прочитано запусков игры')}: {status.scan.sessionCount}</strong>
              <small>{modeLines(status).join(' · ')}</small>
            </span>
          </div>
        )}
        <div className="setting-row game-logs-row">
          <span>
            <strong>{uiLabel('Ник')}: {nickname ?? uiLabel('не найден')}</strong>
            {!nickname && <NicknameMissingHelp />}
          </span>
        </div>
        <div className="game-logs-actions">
          <button type="button" className="button small primary" disabled={busy !== null} onClick={() => void findAgain()}>
            {busy === 'find' ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}{uiLabel('Найти снова')}
          </button>
          <button type="button" className="button small" disabled={busy !== null} onClick={() => void pick()}>
            {busy === 'pick' ? <LoaderCircle size={13} className="spin" /> : <FolderOpen size={13} />}{uiLabel('Выбрать папку Logs')}
          </button>
          {desktop.logSearchReport && (
            <button type="button" className="button small ghost" disabled={busy !== null} aria-expanded={Boolean(report)} onClick={() => (report ? setReport(null) : void showReport())}>
              {busy === 'report' ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}{uiLabel('Где искали журналы')}
            </button>
          )}
        </div>
        {report && (
          <div className="game-logs-report" role="region" aria-label={uiLabel('Где искали журналы')}>
            <pre>{text}</pre>
            <div className="game-logs-report-foot">
              <small>{uiLabel('Если журналы так и не нашлись, скопируйте отчёт и пришлите его в поддержку.')}</small>
              <button type="button" className="button small" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}{uiLabel(copied ? 'Скопировано' : 'Скопировать отчёт')}</button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

