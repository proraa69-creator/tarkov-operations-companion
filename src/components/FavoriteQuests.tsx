import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Hourglass, Undo2, X } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import type { Item } from '../domain/types'
import { useTraderLoyalty } from '../gunsmith/useGunsmithAccess'
import { uiText } from '../i18n/renderText'
import { deferredQuestRows, restoreDeferredQuests, useDeferredQuests, type DeferredQuestRow } from '../progression/deferredQuests'
import { isCurrentTrackedQuest } from '../progression/requirementEngine'
import { useAppState } from '../state/AppState'
import { usePopupMenu } from './usePopupMenu'
import './deferredQuests.css'

/**
 * «Избранное» tied to the quests put aside (a player's report through the owner, 05.11.2026: «лежат у меня в избранном камеры, а
 * у меня 3 отложеных квеста по ним, к какому квесту и локации они мне нужны надо ходить искать по отложкам», «что бы я по предмету
 * правой нажал и вернул связанный квест в активные», «Кнопочку "Убрать из избранного" надо»). Worked out from what each quest of
 * this mode needs, so a star the player set by hand shows its quests too.
 */
function useFavoriteQuests(): ReadonlyMap<string, DeferredQuestRow[]> {
  const state = useAppState()
  const { data } = useTarkovData()
  const progress = state.activeProfile.modes[state.raidMode]
  const loyalty = useTraderLoyalty()
  const deferred = useDeferredQuests(state.activeProfile.id, state.raidMode, progress.playerLevel, loyalty)
  return useMemo(() => {
    const links = new Map<string, DeferredQuestRow[]>()
    if (!deferred.size) return links
    const current = data.quests.filter((quest) => isCurrentTrackedQuest(quest, progress))
    const itemsById = new Map(data.items.map((item) => [item.id, item]))
    for (const row of deferredQuestRows(current, deferred, { maps: data.maps, itemsById })) {
      for (const item of row.items) links.set(item.id, [...(links.get(item.id) ?? []), row])
    }
    return links
  }, [data, deferred, progress])
}

interface FavoriteMenu { x: number; y: number; item: Pick<Item, 'id' | 'name'>; rows: DeferredQuestRow[] }

/** For a list of favourites: the quests of an item, its right-click menu, and that menu to render once on the page. */
export function useFavoriteActions() {
  const links = useFavoriteQuests()
  const [menu, setMenu] = useState<FavoriteMenu | null>(null)
  const close = useCallback(() => setMenu(null), [])
  const open = useCallback((item: Pick<Item, 'id' | 'name'>, event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, item, rows: links.get(item.id) ?? [] })
  }, [links])
  const questsOf = useCallback((itemId: string) => links.get(itemId) ?? [], [links])
  return { questsOf, open, menu: <FavoriteItemMenu menu={menu} onClose={close} /> }
}

/** Under the item: its quest put aside and where. A click opens the menu too: a phone has no right click. */
export function FavoriteQuestLine({ rows, onOpen }: { rows: readonly DeferredQuestRow[]; onOpen: (event: MouseEvent) => void }) {
  const first = rows[0]
  if (!first) return null
  return (
    <button type="button" className="favorite-quest-line" title={rows.map((row) => `${uiText(row.quest.name)} · ${uiText(row.place)}`).join('\n')} onClick={onOpen}>
      <Hourglass size={11} aria-hidden="true" />
      <span>{uiText(first.quest.name)} · {uiText(first.place)}</span>
      {rows.length > 1 && <b>+{rows.length - 1}</b>}
    </button>
  )
}

/** The right click on a favourite: its quests put aside, each with «Вернуть», and «Убрать из избранного». */
function FavoriteItemMenu({ menu, onClose }: { menu: FavoriteMenu | null; onClose: () => void }) {
  const state = useAppState()
  const ref = usePopupMenu(menu, onClose)
  if (!menu) return null
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 268))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 86 - menu.rows.length * 46))
  return createPortal(
    <div ref={ref} className="point-menu quest-defer-menu favorite-item-menu" role="menu" aria-label={uiText('Меню предмета')} style={{ left, top }} onContextMenu={(event) => event.preventDefault()}>
      <div className="point-menu-title">{uiText(menu.item.name)}</div>
      {menu.rows.map(({ quest, detail }) => (
        <button key={quest.id} type="button" role="menuitem" onClick={() => { onClose(); restoreDeferredQuests(state.activeProfile.id, state.raidMode, [quest.id]) }}>
          <Undo2 size={13} aria-hidden="true" />
          <span className="favorite-item-menu-quest"><span>{uiText('Вернуть')}: {uiText(quest.name)}</span><small>{uiText(detail)}</small></span>
        </button>
      ))}
      <button type="button" role="menuitem" onClick={() => { onClose(); if (state.favoriteItemIds.includes(menu.item.id)) state.toggleFavoriteItem(menu.item.id) }}>
        <X size={13} aria-hidden="true" />{uiText('Убрать из избранного')}
      </button>
    </div>,
    document.body,
  )
}
