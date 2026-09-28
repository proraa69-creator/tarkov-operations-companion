import { uiText } from '../i18n/renderText'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, FileArchive, FolderOpen, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'
import { unzipSync } from 'fflate'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { buildScanResult, readLogSignals, type LogSignal, type ModeLogScanResult } from '../import/eftLogTimeline'
import { applyScanToModes } from '../import/logApply'
import type { RaidMode } from '../domain/types'

const LOG_FOLDER_STORAGE_KEY = 'tarkov-operations-log-folder-v1'
const MODES: Array<{ id: RaidMode; label: string }> = [
  { id: 'pvp', label: 'PvP' },
  { id: 'pve', label: 'PvE' },
  { id: 'seasonal', label: 'Сезон' },
]
const STATUS_ORDER = { active: 0, completed: 1, failed: 2 } as const

type ScanResult = ModeLogScanResult & { folder?: string }

export function ImportProgressPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const fileInput = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const questById = useMemo(() => new Map(data.quests.map((quest) => [quest.id, quest])), [data.quests])
  const desktop = Boolean(window.tarkovDesktop)

  const apply = (scan: ScanResult) => {
    setResult(scan)
    applyScanToModes(scan, (mode) => state.activeProfile.modes[mode].registration, state.applyLogStateForMode)
  }

  const scan = async (manual: boolean) => {
    if (!window.tarkovDesktop) return
    setBusy(true)
    setError('')
    try {
      const found = manual ? await window.tarkovDesktop.scanLogs() : await window.tarkovDesktop.autoFindAndScanLogs()
      if (!found) {
        if (!manual) setError('Папка Logs не найдена автоматически. Укажите её вручную.')
        return
      }
      apply(found)
      localStorage.setItem(LOG_FOLDER_STORAGE_KEY, found.folder)
      await window.tarkovDesktop.startWatchingLogs(found.folder)
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Не удалось прочитать журналы')
    } finally {
      setBusy(false)
    }
  }

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setError('')
    try {
      const signals: LogSignal[] = []
      for (const file of [...files]) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          for (const [name, bytes] of Object.entries(unzipSync(new Uint8Array(await file.arrayBuffer())))) {
            if (name.toLowerCase().endsWith('.log')) signals.push(...readLogSignals(new TextDecoder().decode(bytes)))
          }
        } else signals.push(...readLogSignals(await file.text()))
      }
      apply(buildScanResult(signals, 1))
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Не удалось разобрать файлы')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!window.tarkovDesktop) return
    const unsubscribe = window.tarkovDesktop.onLogsUpdated((next) => setResult((current) => ({ ...next, folder: current?.folder })))
    const timer = window.setTimeout(() => void scan(false), 0)
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedEvents = [...(result?.eventsByMode[state.raidMode] ?? [])]
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.timestamp.localeCompare(a.timestamp))

  return <div className="page import-page">
    <header className="page-header"><div><div className="eyebrow">{uiText("Профиль · ")}{uiText(state.activeProfile.displayName)}</div><h1 className="page-title">{uiText("Синхронизация по журналам")}</h1><p className="page-subtitle">{uiText("Задания читаются из журналов Escape from Tarkov. PvP, PvE и Сезон раскладываются отдельно — по режиму сессии, серверу и профилю.")}</p></div><span className="tag green"><ShieldCheck size={12} />{uiText(" только чтение, локально")}</span></header>

    {uiText(error && <div className="panel import-warning"><AlertTriangle size={18} /> {uiText(error)}</div>)}

    <section className="panel">
      <div className="panel-header">
        <div><div className="eyebrow">{uiText("Источник")}</div><div className="panel-title">{uiText(result?.folder ?? (desktop ? 'Папка Logs ещё не найдена' : 'Файлы журналов'))}</div></div>
        <div className="filter-row" style={{ margin: 0 }}>
          {uiText(desktop && <button className="button primary" disabled={busy} onClick={() => void scan(false)}>{uiText(busy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />)}{uiText(" Обновить")}</button>)}
          {uiText(desktop && <button className="button ghost" disabled={busy} onClick={() => void scan(true)}><FolderOpen size={15} />{uiText(" Выбрать папку Logs")}</button>)}
          {uiText(!desktop && <button className="button primary" disabled={busy} onClick={() => fileInput.current?.click()}><FileArchive size={15} />{uiText(" Выбрать файлы журналов")}</button>)}
          <input ref={fileInput} hidden type="file" multiple accept=".log,.txt,.zip" onChange={(event) => void readFiles(event.target.files)} />
        </div>
      </div>
      {uiText(result && <div className="panel-body">
        <div className="import-note">{uiText("Прочитано игровых сессий: ")}{uiText(result.sessionCount)}. {uiText(desktop ? 'Программа следит за журналами и обновляет задания сама, пока вы играете.' : '')}</div>
        <div className="import-mode-grid">
          {uiText(MODES.map((mode) => {
            const summary = result.summaryByMode[mode.id]
            const events = result.eventsByMode[mode.id]
            const count = (status: string) => events.filter((event) => event.status === status && questById.has(event.taskId)).length
            return <button type="button" key={mode.id} className={`import-mode-card ${state.raidMode === mode.id ? 'active' : ''}`} onClick={() => state.setRaidMode(mode.id)}>
              <strong>{uiText(mode.label)}</strong>
              {uiText(summary.lastActivityAt
                ? <>
                  <span>{uiText("Текущих: ")}{uiText(count('active'))}{uiText(" · выполнено: ")}{uiText(count('completed'))}{uiText(count('failed') ? ` · провалено: ${count('failed')}` : '')}</span>
                  <small className="dim">{uiText("Профиль …")}{uiText(summary.profileId?.slice(-6) ?? '—')}{uiText(" · играли ")}{uiText(formatDate(summary.lastActivityAt))}</small>
                  {uiText(summary.resetAt && <small className="dim"><RotateCcw size={11} />{uiText(" Сброс профиля ")}{uiText(formatDate(summary.resetAt))}{uiText(" — учитываются события после него")}</small>)}
                </>
                : <span className="dim">{uiText("В журналах нет этого режима")}</span>)}
            </button>
          }))}
        </div>
      </div>)}
      {uiText(!result && busy && <div className="panel-body import-center"><LoaderCircle className="spin" size={30} /><p>{uiText("Читаю журналы…")}</p></div>)}
    </section>

    {uiText(result && <section className="panel import-preview">
      <div className="panel-header"><div><div className="eyebrow">{uiText("Режим ")}{uiText(state.raidMode.toUpperCase())}</div><div className="panel-title">{uiText("Задания из журналов")}</div></div><span className="tag">{uiText(selectedEvents.length)}</span></div>
      <div className="import-note">{uiText("«Принято» — задание текущее. «Выполнено» — сдано торговцу. Сюжетные главы игра в журналы не пишет: они подхватываются, когда в игре открыта вкладка сюжета.")}</div>
      <div className="import-event-list">{uiText(selectedEvents.map((event) => {
        const quest = questById.get(event.taskId)
        return <div key={`${event.taskId}-${event.timestamp}`}>
          <span className={`import-event-state ${event.status}`}>{uiText(event.status === 'completed' ? <Check /> : event.status === 'failed' ? <AlertTriangle /> : <FileArchive />)}</span>
          <span><strong>{uiText(quest?.name ?? `Неизвестное задание ${event.taskId.slice(-6)}`)}</strong><small>{uiText(quest ? `${quest.trader} · ` : '')}{uiText(event.status === 'completed' ? 'выполнено' : event.status === 'failed' ? 'провалено' : 'принято')} · {uiText(formatDate(event.timestamp))}</small></span>
        </div>
      }))}</div>
      {uiText(!selectedEvents.length && <p className="dim">{uiText("В журналах режима ")}{uiText(state.raidMode.toUpperCase())}{uiText(" нет событий заданий.")}</p>)}
    </section>)}
  </div>
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
