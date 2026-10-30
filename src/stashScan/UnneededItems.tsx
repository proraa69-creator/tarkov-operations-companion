import { useMemo } from 'react'
import { PackageX } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import type { Item } from '../domain/types'
import { hideoutNeeds } from '../hideout/hideoutNeeds'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { useStashSeen } from './stashSeen'
import { screenSyncTargets } from './useScreenSync'

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
 * «Не нужны» on the right of «Убежище» and «Квесты» (owner, 31.10.2026: «колонка справа которая показывает какие предметы
 * в схроне уже не нужны, и никуда не пригодятся, показываются и в квестах и в убежище»): from the last «Синхронизация по
 * экрану» (stashScan/stashSeen.ts, the PC's scan reaches the phone through the account), this mode and profile only.
 */
export function UnneededItems() {
  const { data } = useTarkovData()
  const state = useAppState()
  const seen = useStashSeen(state.activeProfile.id, state.raidMode)
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const list = useMemo(() => {
    const targets = screenSyncTargets(data, state)
    // Every piece the unbuilt levels need in all, whether marked found or not.
    const hideout = new Map(hideoutNeeds(targets.stations, targets.built, new Map()).items.map((need) => [need.itemId, need.total]))
    return unneededItems(seen, { hideout, quests: targets.quests ?? new Map(), kappa: new Set(targets.kappa.map(({ item }) => item.id)) })
  }, [data, state, seen])

  return <aside className="panel hs-unneeded" aria-label={uiText('Не нужны')}>
    <h3><PackageX size={13} aria-hidden="true" /> {uiText('Не нужны')}{list.length > 0 && <span className="hs-unneeded-count">{list.length}</span>}</h3>
    {!seen.size
      ? <p className="dim">{uiText('Нажмите «Синхронизация по экрану» и пролистайте схрон — здесь появятся предметы, которые больше никуда не нужны.')}</p>
      : !list.length
        ? <p className="dim">{uiText('В схроне нет лишнего: всё, что нашёл скан, ещё пригодится.')}</p>
        : <ul className="hs-unneeded-list">{list.map(({ itemId, count }) => <UnneededRow key={itemId} item={items.get(itemId)} itemId={itemId} count={count} />)}</ul>}
  </aside>
}

function UnneededRow({ item, itemId, count }: { item?: Item; itemId: string; count: number }) {
  return <li title={item?.name ?? itemId}>
    {item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" decoding="async" /> : <span className="hs-unneeded-dot" />}
    <span className="hs-unneeded-name">{item?.shortName ?? item?.name ?? itemId}</span>
    <b className="mono">×{count}</b>
  </li>
}
