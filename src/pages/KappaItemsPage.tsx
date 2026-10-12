import { uiText } from '../i18n/renderText'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, ScanSearch } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { KappaCongrats } from '../components/KappaCongrats'
import { COLLECTOR_CHANGED_EVENT, collectorEntries, findCollectorQuest, loadCollected, saveCollected, scanForCollectorItems } from '../kappa/collector'

/** One press scans for this long, so a whole stash can be scrolled through. */
const SCAN_WINDOW_MS = 45_000
/** Rest between passes, so the game keeps the processor (a pass reads only labels new on screen: electron/collectorScan.ts). */
const PASS_PAUSE_MS = 600
const WAIT_PAUSE_MS = 1000

export function KappaItemsPage() {
  const { data } = useTarkovData()
  const { raidMode, activeProfile } = useAppState()
  const entries = useMemo(() => collectorEntries(data.quests, data.items), [data.quests, data.items])
  const quest = useMemo(() => findCollectorQuest(data.quests), [data.quests])
  const [collected, setCollected] = useState(() => loadCollected(raidMode))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const desktop = Boolean(window.tarkovDesktop)

  useEffect(() => {
    const reload = () => setCollected(loadCollected(raidMode))
    reload()
    window.addEventListener(COLLECTOR_CHANGED_EVENT, reload)
    return () => window.removeEventListener(COLLECTOR_CHANGED_EVENT, reload)
  }, [raidMode])

  const toggle = (id: string) => saveCollected(raidMode, collected.includes(id) ? collected.filter((entry) => entry !== id) : [...collected, id])

  // Scanning runs pass after pass while you scroll the stash, adding whatever shows up.
  const scanning = useRef(false)
  const [passes, setPasses] = useState(0)
  const [fresh, setFresh] = useState<string[]>([])
  const stop = useCallback(() => { scanning.current = false }, [])
  useEffect(() => stop, [stop])

  const scan = useCallback(async () => {
    if (scanning.current) { stop(); return }
    scanning.current = true
    setBusy(true)
    setMessage('')
    setPasses(0)
    const started = Date.now()
    let addedTotal = 0
    let sawGame = false
    try {
      for (let pass = 0; scanning.current && Date.now() - started < SCAN_WINDOW_MS; pass += 1) {
        const result = await scanForCollectorItems(raidMode, entries, { restart: pass === 0 })
        if (!result.ok) { setMessage('Сканирование работает только в приложении для Windows.'); break }
        setPasses((count) => count + 1)
        if (result.added.length) {
          addedTotal += result.added.length
          setFresh((current) => [...current, ...result.added])
        }
        if (result.gameWindow) sawGame = true
        setMessage(result.waiting
          ? 'Откройте игру со схроном: сканирование идёт, пока окно игры видно на экране.'
          : `Найдено новых: ${addedTotal}. Листайте схрон — сканирование идёт.`)
        await new Promise((resolve) => setTimeout(resolve, result.waiting ? WAIT_PAUSE_MS : PASS_PAUSE_MS))
      }
      if (scanning.current) {
        setMessage(!sawGame
          ? 'Окно игры не найдено. Откройте схрон в игре и нажмите «Сканировать» ещё раз.'
          : addedTotal ? `Готово. Добавлено предметов: ${addedTotal}` : 'Готово. Новых предметов не найдено.')
      }
    } catch {
      setMessage('Не удалось распознать экран. Попробуйте ещё раз.')
    } finally {
      scanning.current = false
      setBusy(false)
    }
  }, [entries, raidMode, stop])

  const done = entries.filter(({ item }) => collected.includes(item.id)).length
  // read from storage for this very mode: right after a mode switch `collected` still holds the previous mode's list
  const complete = useMemo(() => {
    const stored = loadCollected(raidMode)
    return entries.length > 0 && entries.every(({ item }) => stored.includes(item.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collected, raidMode, entries])

  return (
    <div className="page kappa-items-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText('Капа · ')}{uiText(raidMode.toUpperCase())}</div>
          <h1 className="page-title">{uiText('Предметы для «Коллекционера»')}</h1>
          <p className="page-subtitle">{uiText(desktop ? 'Откройте схрон и нажмите «Сканировать». Все предметы должны быть в одном контейнере.' : 'Отметьте собранные предметы — список общий с приложением для ПК через аккаунт сервера.')}</p>
        </div>
        <div className="kappa-items-actions">
          <Link className="button ghost" to="/"><ArrowLeft size={14} />{uiText(' Назад')}</Link>
          {desktop && <button className="button primary" disabled={!entries.length} onClick={() => void scan()}><ScanSearch size={14} />{uiText(busy ? ` Остановить (${passes})` : ' Сканировать')}</button>}
        </div>
      </header>

      {message && <p className="kappa-items-message" role="status">{uiText(message)}</p>}

      {entries.length === 0 ? (
        <section className="panel"><div className="panel-body">{uiText(quest ? 'В каталоге нет списка предметов этого задания. Обновите данные.' : 'Задание «Коллекционер» не найдено в каталоге. Обновите данные.')}</div></section>
      ) : (
        <>
          <KappaCongrats profileId={activeProfile.id} mode={raidMode} complete={complete} total={entries.length} />
          <div className="kappa-items-progress"><strong>{uiText(done)} / {uiText(entries.length)}</strong><span>{uiText('предметов собрано')}</span></div>
          <div className="kappa-items-grid">
            {entries.map(({ item, count }) => {
              const has = collected.includes(item.id)
              return (
                <button key={item.id} type="button" className={`kappa-cell${has ? ' is-done' : ''}${fresh.includes(item.id) ? ' is-fresh' : ''}`} aria-pressed={has} onClick={() => toggle(item.id)} title={uiText(item.name)}>
                  {item.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="kappa-cell-fallback">{uiText(item.shortName)}</span>}
                  <span className="kappa-cell-name">{uiText(item.shortName || item.name)}{count > 1 ? ` ×${count}` : ''}</span>
                  {has && <span className="kappa-cell-check"><Check size={13} /></span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
