import { uiText } from '../i18n/renderText'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, ScanSearch } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { KappaCongrats } from '../components/KappaCongrats'
import { COLLECTOR_CHANGED_EVENT, collectorEntries, findCollectorQuest, loadCollected, saveCollected } from '../kappa/collector'
import { setKappaBadgeMissingOnly, useKappaBadgeMissingOnly } from '../kappa/kappaBadgeSetting'
import { isMobileLayout } from '../platform'
import { PhotoSyncButton, type PhotoPick } from '../stashPhoto/PhotoSyncButton'
import { useScreenSync } from '../stashScan/useScreenSync'
import { RemoteScanButton } from '../stashScan/RemoteScanButton'

export function KappaItemsPage() {
  const { data } = useTarkovData()
  const { raidMode, activeProfile } = useAppState()
  const entries = useMemo(() => collectorEntries(data.quests, data.items), [data.quests, data.items])
  const quest = useMemo(() => findCollectorQuest(data.quests), [data.quests])
  const [collected, setCollected] = useState(() => loadCollected(raidMode))
  const missingOnly = useKappaBadgeMissingOnly()

  useEffect(() => {
    const reload = () => setCollected(loadCollected(raidMode))
    reload()
    window.addEventListener(COLLECTOR_CHANGED_EVENT, reload)
    return () => window.removeEventListener(COLLECTOR_CHANGED_EVENT, reload)
  }, [raidMode])

  const toggle = (id: string) => saveCollected(raidMode, collected.includes(id) ? collected.filter((entry) => entry !== id) : [...collected, id])

  // Scanning runs pass after pass while you scroll the stash: Collector items are ticked here, the pieces the hideout
  // still needs go to «Убежище» (one scan for both, src/stashScan/screenSync.ts).
  const [fresh, setFresh] = useState<string[]>([])
  const markFresh = useCallback((ids: string[]) => setFresh((current) => [...current, ...ids]), [])
  const { available: desktop, busy, passes, message, run: scan, setMessage } = useScreenSync('Сканировать', markFresh)

  // «Синхронизация по фото» (phone): only the items not collected yet are searched for in the photo.
  const phone = isMobileLayout()
  const photoItems = useMemo(() => entries.filter(({ item }) => !collected.includes(item.id))
    .map(({ item }) => ({ id: item.id, shortName: item.shortName, name: item.name, iconUrl: item.iconUrl, width: item.width ?? 1, height: item.height ?? 1 })), [entries, collected])
  const catalogNames = useMemo(() => data.items.map((item) => item.shortName).filter(Boolean), [data.items])
  const addFromPhoto = (picks: PhotoPick[]) => {
    const ids = picks.map((pick) => pick.id)
    saveCollected(raidMode, [...new Set([...loadCollected(raidMode), ...ids])])
    setFresh((current) => [...current, ...ids])
    setMessage(ids.length ? `Добавлено по фото: ${ids.length}` : '')
  }

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
          <p className="page-subtitle">{uiText(desktop ? 'Откройте схрон и нажмите «Сканировать». Все предметы должны быть в одном контейнере.' : 'Отметьте собранные предметы или сфотографируйте схрон на экране — список общий с приложением для ПК через аккаунт сервера.')}</p>
        </div>
        <div className="kappa-items-actions">
          <Link className="button ghost" to="/"><ArrowLeft size={14} />{uiText(' Назад')}</Link>
          {desktop && <button className="button primary" disabled={!entries.length} onClick={() => void scan()}><ScanSearch size={14} />{uiText(busy ? ` Остановить (${passes})` : ' Сканировать')}</button>}
          {phone && !desktop && <PhotoSyncButton items={photoItems} catalogNames={catalogNames} onApply={addFromPhoto} />}
        </div>
      </header>
      {/* The phone and the website: the PC's scan started from here (owner, 31.10.2026). */}
      {!desktop && <RemoteScanButton />}

      {message && <p className="kappa-items-message" role="status">{uiText(message)}</p>}

      {entries.length === 0 ? (
        <section className="panel"><div className="panel-body">{uiText(quest ? 'В каталоге нет списка предметов этого задания. Обновите данные.' : 'Задание «Коллекционер» не найдено в каталоге. Обновите данные.')}</div></section>
      ) : (
        <>
          <KappaCongrats profileId={activeProfile.id} mode={raidMode} complete={complete} total={entries.length} />
          <div className="kappa-items-progress">
            <strong>{uiText(done)} / {uiText(entries.length)}</strong><span>{uiText('предметов собрано')}</span>
            {/* The in-raid item card exists in the Windows app only (owner, 13.10.2026: a switch like «Дым за боссами»). */}
            {desktop && <label className="kappa-badge-switch" title={uiText('Уже отмеченные здесь предметы карточка в рейде не помечает. Выключите — значок будет на всех предметах для «Коллекционера».')}>
              <span>{uiText('Значок «Каппа» в рейде только на недостающих')}</span>
              <button type="button" role="switch" aria-checked={missingOnly} className={`toggle ${missingOnly ? 'on' : ''}`} onClick={() => setKappaBadgeMissingOnly(!missingOnly)}><span /></button>
            </label>}
          </div>
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
