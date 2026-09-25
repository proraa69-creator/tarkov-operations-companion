import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronRight, FileArchive, FolderSearch, ListChecks, LoaderCircle, Search, ShieldCheck } from 'lucide-react'
import { unzipSync } from 'fflate'
import { useNavigate } from 'react-router-dom'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { eventsToProgressRecords, mergeParseResults, parseEftLog, type LogParseResult } from '../import/logParser'

type Stage = 'source' | 'scanning' | 'preview' | 'manual' | 'done'
const LOG_FOLDER_STORAGE_KEY = 'tarkov-operations-log-folder-v1'

export function ImportProgressPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('source')
  const [result, setResult] = useState<(LogParseResult & { folder?: string }) | null>(null)
  const [error, setError] = useState('')
  const [manualQuery, setManualQuery] = useState('')
  const [manualIds, setManualIds] = useState<Set<string>>(new Set())
  const knownIds = useMemo(() => new Set(data.quests.map((quest) => quest.id)), [data.quests])
  const summary = useMemo(() => {
    const events = result?.events ?? []
    return {
      completed: events.filter((event) => event.status === 'completed' && knownIds.has(event.taskId)).length,
      active: events.filter((event) => event.status === 'active' && knownIds.has(event.taskId)).length,
      failed: events.filter((event) => event.status === 'failed' && knownIds.has(event.taskId)).length,
      unknown: events.filter((event) => !knownIds.has(event.taskId)).length,
    }
  }, [knownIds, result])
  const modeConflict = Boolean(result?.detectedModes.length && !result.detectedModes.includes(state.raidMode)) || (result?.detectedModes.length ?? 0) > 1
  const manualTasks = data.quests.filter((quest) => `${quest.name} ${quest.trader}`.toLowerCase().includes(manualQuery.toLowerCase())).slice(0, 250)

  const scanDesktop = async () => {
    if (!window.tarkovDesktop) return
    setStage('scanning')
    setError('')
    try {
      const parsed = await window.tarkovDesktop.scanLogs()
      if (!parsed) return setStage('source')
      setResult(parsed)
      setStage('preview')
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Не удалось прочитать журналы')
      setStage('source')
    }
  }

  const scanBrowserFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setStage('scanning')
    setError('')
    try {
      const results: LogParseResult[] = []
      for (const file of [...files]) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
          for (const [name, bytes] of Object.entries(archive)) {
            if (name.toLowerCase().endsWith('.log')) results.push(parseEftLog(new TextDecoder().decode(bytes)))
          }
        } else results.push(parseEftLog(await file.text()))
      }
      setResult(mergeParseResults(results))
      setStage('preview')
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Не удалось разобрать выбранные файлы')
      setStage('source')
    }
  }

  const applyImport = async () => {
    if (!result || modeConflict) return
    state.applyTaskRecords(eventsToProgressRecords(result.events.filter((event) => knownIds.has(event.taskId))))
    if (result.folder && window.tarkovDesktop) {
      localStorage.setItem(LOG_FOLDER_STORAGE_KEY, result.folder)
      await window.tarkovDesktop.startWatchingLogs(result.folder)
    }
    setStage('done')
  }

  const applyManual = () => {
    const updatedAt = new Date().toISOString()
    state.applyTaskRecords([...manualIds].map((taskId) => ({ taskId, status: 'completed', source: 'manual', updatedAt })))
    setStage('done')
  }

  return <div className="page import-page">
    <header className="page-header"><div><div className="eyebrow">Профиль · {state.activeProfile.displayName} · {state.raidMode.toUpperCase()}</div><h1 className="page-title">Перенос прогресса</h1><p className="page-subtitle">Журналы обрабатываются только на этом компьютере. Перед применением вы увидите все найденные изменения.</p></div><span className="tag green"><ShieldCheck size={12} /> локально и безопасно</span></header>
    <div className="import-steps"><span className={stage !== 'source' ? 'done' : 'active'}>1. Источник</span><ChevronRight /><span className={stage === 'preview' || stage === 'manual' ? 'active' : stage === 'done' ? 'done' : ''}>2. Проверка</span><ChevronRight /><span className={stage === 'done' ? 'active' : ''}>3. Готово</span></div>

    {error && <div className="panel import-warning"><AlertTriangle size={18} /> {error}</div>}

    {stage === 'source' && <div className="import-source-grid">
      <button className="panel import-source-card" onClick={window.tarkovDesktop ? scanDesktop : () => fileInput.current?.click()}><FolderSearch size={32} /><span><strong>Найти прогресс в журналах EFT</strong><small>{window.tarkovDesktop ? 'Выберите папку Battlestate Games → EFT → Logs' : 'Выберите файлы notification/output или ZIP'}</small></span><ChevronRight /></button>
      <button className="panel import-source-card" onClick={() => setStage('manual')}><ListChecks size={32} /><span><strong>Быстрая ручная отметка</strong><small>Найдите и отметьте уже выполненные задания списком</small></span><ChevronRight /></button>
      <input ref={fileInput} hidden type="file" multiple accept=".log,.txt,.zip" onChange={(event) => void scanBrowserFiles(event.target.files)} />
    </div>}

    {stage === 'scanning' && <section className="panel import-center"><LoaderCircle className="spin" size={38} /><h2>Читаю журналы</h2><p>Ищу только события начала, завершения и провала заданий…</p></section>}

    {stage === 'preview' && result && <section className="panel import-preview">
      <div className="panel-header"><div><div className="eyebrow">Предварительный просмотр</div><div className="panel-title">Найденные изменения</div></div><span className="tag">{result.events.length} событий</span></div>
      <div className="import-stat-grid"><div><strong>{summary.completed}</strong><span>выполнено</span></div><div><strong>{summary.active}</strong><span>начато</span></div><div><strong>{summary.failed}</strong><span>провалено</span></div><div><strong>{summary.unknown}</strong><span>неизвестно</span></div></div>
      {modeConflict && <div className="import-warning"><AlertTriangle size={17} /><span>Режим журналов не совпадает с выбранным {state.raidMode.toUpperCase()} или в файлах смешаны режимы. Переключите режим сверху либо выберите журналы одного персонажа.</span></div>}
      {result.ignoredRecords > 0 && <div className="import-note">Пропущено повреждённых записей: {result.ignoredRecords}. Остальные данные не изменялись.</div>}
      <div className="import-event-list">{result.events.filter((event) => knownIds.has(event.taskId)).slice(0, 120).map((event) => { const quest = data.quests.find((entry) => entry.id === event.taskId)!; return <div key={`${event.taskId}-${event.timestamp}`}><span className={`import-event-state ${event.status}`}>{event.status === 'completed' ? <Check /> : event.status === 'failed' ? <AlertTriangle /> : <FileArchive />}</span><span><strong>{quest.name}</strong><small>{quest.trader} · {event.status === 'completed' ? 'выполнено' : event.status === 'failed' ? 'провалено' : 'начато'}</small></span></div> })}</div>
      <div className="import-actions"><button className="button ghost" onClick={() => setStage('source')}>Назад</button><button className="button primary" disabled={modeConflict || !result.events.length} onClick={() => void applyImport()}><Check size={16} /> Применить изменения</button></div>
    </section>}

    {stage === 'manual' && <section className="panel import-preview">
      <div className="panel-header"><div><div className="eyebrow">Массовая отметка</div><div className="panel-title">Что уже выполнено?</div></div><span className="tag brass">Выбрано: {manualIds.size}</span></div>
      <div className="filter-row"><div style={{ position: 'relative', flex: 1 }}><Search size={14} style={{ position: 'absolute', left: 12, top: 13 }} /><input className="input" style={{ width: '100%', paddingLeft: 35 }} value={manualQuery} onChange={(event) => setManualQuery(event.target.value)} placeholder="Название или торговец…" /></div><button className="button small" onClick={() => setManualIds(new Set(manualTasks.map((quest) => quest.id)))}>Выбрать найденные</button><button className="button small ghost" onClick={() => setManualIds(new Set())}>Очистить</button></div>
      <div className="manual-task-list">{manualTasks.map((quest) => <label key={quest.id}><input type="checkbox" checked={manualIds.has(quest.id)} onChange={() => setManualIds((current) => { const next = new Set(current); if (next.has(quest.id)) next.delete(quest.id); else next.add(quest.id); return next })} /><span><strong>{quest.name}</strong><small>{quest.trader} · ур. {quest.level}</small></span></label>)}</div>
      <div className="import-actions"><button className="button ghost" onClick={() => setStage('source')}>Назад</button><button className="button primary" disabled={!manualIds.size} onClick={applyManual}><Check size={16} /> Отметить {manualIds.size} выполненными</button></div>
    </section>}

    {stage === 'done' && <section className="panel import-center success"><span className="success-seal"><Check size={32} /></span><h2>Прогресс обновлён</h2><p>Выполненные задания сохранены в профиле {state.activeProfile.displayName}. Доступные цепочки уже пересчитаны.</p><button className="button primary" onClick={() => navigate('/quests')}>Показать актуальные задания <ChevronRight size={15} /></button></section>}
  </div>
}
