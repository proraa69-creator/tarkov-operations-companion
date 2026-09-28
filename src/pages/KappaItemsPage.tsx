import { uiText } from '../i18n/renderText'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, ScanSearch } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { COLLECTOR_CHANGED_EVENT, collectorEntries, findCollectorQuest, loadCollected, saveCollected, scanForCollectorItems } from '../kappa/collector'

export function KappaItemsPage() {
  const { data } = useTarkovData()
  const { raidMode } = useAppState()
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

  const scan = useCallback(async () => {
    setBusy(true)
    setMessage('')
    try {
      const result = await scanForCollectorItems(raidMode, entries)
      if (!result.ok) setMessage('Сканирование работает только в приложении для Windows.')
      else if (!result.gameWindow) setMessage('Окно игры не найдено — распознан весь экран. Откройте игру и повторите.')
      else setMessage(result.added ? `Добавлено предметов: ${result.added}` : result.found ? 'Все найденные предметы уже отмечены.' : 'Нужные предметы на экране не найдены.')
    } catch {
      setMessage('Не удалось распознать экран. Попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }, [entries, raidMode])

  const done = entries.filter(({ item }) => collected.includes(item.id)).length

  return (
    <div className="page kappa-items-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText('Капа · ')}{uiText(raidMode.toUpperCase())}</div>
          <h1 className="page-title">{uiText('Предметы для «Коллекционера»')}</h1>
          <p className="page-subtitle">{uiText('Поместите предметы для квеста в одном экране (схрон или инвентарь), нажмите «Сканировать» — найденные предметы отметятся сами. Остальные можно отметить вручную.')}</p>
        </div>
        <div className="kappa-items-actions">
          <Link className="button ghost" to="/"><ArrowLeft size={14} />{uiText(' Назад')}</Link>
          <button className="button primary" disabled={!desktop || busy || !entries.length} onClick={() => void scan()}><ScanSearch size={14} />{uiText(busy ? ' Сканирую…' : ' Сканировать')}</button>
        </div>
      </header>

      {message && <p className="kappa-items-message" role="status">{uiText(message)}</p>}

      {entries.length === 0 ? (
        <section className="panel"><div className="panel-body">{uiText(quest ? 'В каталоге нет списка предметов этого задания. Обновите данные.' : 'Задание «Коллекционер» не найдено в каталоге. Обновите данные.')}</div></section>
      ) : (
        <>
          <div className="kappa-items-progress"><strong>{uiText(done)} / {uiText(entries.length)}</strong><span>{uiText('предметов собрано')}</span></div>
          <div className="kappa-items-grid">
            {entries.map(({ item, count }) => {
              const has = collected.includes(item.id)
              return (
                <button key={item.id} type="button" className={`kappa-cell${has ? ' is-done' : ''}`} aria-pressed={has} onClick={() => toggle(item.id)} title={uiText(item.name)}>
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
