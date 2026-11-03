import { useMemo } from 'react'
import { ScanSearch } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { hideoutNeeds } from '../hideout/hideoutNeeds'
import { uiText } from '../i18n/renderText'
import { number, span, StashPicture, stashRows } from '../pages/HideoutStashPage'
import { useAppState } from '../state/AppState'
import { RemoteScanButton } from './RemoteScanButton'
import { useStashSeen } from './stashSeen'
import { screenSyncTargets, useScreenSync } from './useScreenSync'
import '../styles/hideoutStash.css'

export interface UnneededItem { itemId: string; count: number }

/**
 * The items of the stash nothing wants any more (pure): seen by the last scan, and no unbuilt hideout level, no quest still
 * to do and no Collector item asks for them. Pieces put aside for a level or a quest still to come are wanted — they are
 * not listed. Most pieces first.
 */
export function unneededItems(seen: ReadonlyMap<string, number>, wanted: { hideout: ReadonlyMap<string, number>; quests: ReadonlyMap<string, number>; kappa: ReadonlySet<string> }): UnneededItem[] {
  return [...seen]
    .filter(([id, count]) => count > 0 && !(wanted.hideout.get(id) ?? 0) && !(wanted.quests.get(id) ?? 0) && !wanted.kappa.has(id))
    .map(([itemId, count]) => ({ itemId, count }))
    .sort((a, b) => b.count - a.count || a.itemId.localeCompare(b.itemId))
}

/**
 * «Не нужные предметы» (owner, 31.10.2026: «сделай отдельно кнопку не нужные предметы… возле синхронизации, при нажатии
 * открывается новая страница с не нужными предметами»): from the last «Синхронизация по экрану» (stashScan/stashSeen.ts;
 * the PC's scan reaches the phone through the account), this mode and profile only, laid out like the hideout's stash.
 */
export function UnneededItemsPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const mode = state.raidMode
  const seen = useStashSeen(state.activeProfile.id, mode)
  const screenSync = useScreenSync('Синхронизация по экрану')
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const list = useMemo(() => {
    const targets = screenSyncTargets(data, state)
    // Every piece the unbuilt levels need in all, whether marked found or not.
    const hideout = new Map(hideoutNeeds(targets.stations, targets.built, new Map()).items.map((need) => [need.itemId, need.total]))
    return unneededItems(seen, { hideout, quests: targets.quests ?? new Map(), kappa: new Set(targets.kappa.map(({ item }) => item.id)) })
  }, [data, state, seen])
  const pieces = list.reduce((sum, entry) => sum + entry.count, 0)

  return <div className="page hideout-stash unneeded-page">
    <header className="page-header hs-header">
      <div>
        <div className="eyebrow">{uiText('Схрон · ')}{mode === 'seasonal' ? uiText('Сезон') : mode.toUpperCase()}</div>
        <h1 className="page-title">{uiText('Не нужные предметы')}</h1>
        <p className="page-subtitle">{uiText('Предметы из схрона, которые уже не нужны ни убежищу, ни квестам, ни «Коллекционеру». Список — по последней «Синхронизации по экрану»: откройте схрон и пролистайте его.')}</p>
        {screenSync.available ? <div className="hs-photo-sync">
          <button type="button" className="button primary" onClick={() => void screenSync.run()}>
            <ScanSearch size={14} aria-hidden="true" />{uiText(screenSync.busy ? ` Остановить (${screenSync.passes})` : ' Синхронизация по экрану')}
          </button>
        </div> : <RemoteScanButton />}
        {screenSync.message && <p className="hs-sync-message" role="status">{uiText(screenSync.message)}</p>}
      </div>
      {list.length > 0 && <div className="hs-progress" aria-label={uiText('Не нужны')}>
        <div className="hs-progress-numbers"><strong>{number(pieces)}</strong><span> {uiText('шт.')} · {list.length} {uiText('поз.')}</span></div>
      </div>}
    </header>

    {!seen.size
      ? <p className="dim hs-empty">{uiText('Сканирования ещё не было. Нажмите «Синхронизация по экрану» и пролистайте схрон — здесь появятся предметы, которые больше никуда не нужны.')}</p>
      : !list.length
        ? <p className="dim hs-empty">{uiText('В схроне нет лишнего: всё, что нашёл скан, ещё пригодится.')}</p>
        : <div className="hs-stash" role="list" aria-label={uiText('Не нужные предметы')}>
          {list.map(({ itemId, count }) => {
            const item = items.get(itemId)
            return <div key={itemId} role="listitem" className="hs-item" style={{ gridColumn: `span ${span(item?.width, 3)}`, gridRow: `span ${stashRows(item, 3)}` }}>
              <div className="hs-item-face" title={item?.name ?? itemId}>
                <StashPicture id={itemId} item={item} />
                <span className="hs-item-name">{item?.shortName ?? '?'}</span>
                <span className="hs-item-count">×{count}</span>
              </div>
            </div>
          })}
        </div>}
  </div>
}
