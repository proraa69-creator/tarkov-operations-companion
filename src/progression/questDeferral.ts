/**
 * Putting quests aside from any place of the app (the map, «Квесты», the Overview's right click), and «Предметы в
 * избранное» (owner, 03.11.2026: «сделай настройку что бы предмет или ключ который требуется для квеста который отложен,
 * сам добавлялся в избранное как напоминание. сделай что бы эту функцию можно было отключить»): the keys and items a
 * quest put aside needs in the raid (questRaidItems, the ones its row in «Отложенные квесты» shows) go into «Избранное».
 * On by default; the switch is on the right of «Отложенные квесты» (components/DeferredQuests.tsx), kept on this device.
 * Only added, at the moment a quest is put aside: the list is the player's, and nothing is taken out of it later.
 */
import { useCallback, useSyncExternalStore } from 'react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { deferQuest, deferQuests, questRaidItems, type DeferTerm } from './deferredQuests'

const FAVORITES_KEY = 'raidos-deferred-favorites-v1'
const FAVORITES_EVENT = 'raidos-deferred-favorites-changed'

/** «Предметы в избранное» is on (storage unavailable: on). */
export function deferredFavoritesOn() {
  try { return localStorage.getItem(FAVORITES_KEY) !== 'off' } catch { return true }
}

export function setDeferredFavorites(on: boolean) {
  try {
    if (on) localStorage.removeItem(FAVORITES_KEY)
    else localStorage.setItem(FAVORITES_KEY, 'off')
  } catch { /* storage unavailable: stays on */ }
  window.dispatchEvent(new Event(FAVORITES_EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === FAVORITES_KEY) listener() }
  window.addEventListener(FAVORITES_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(FAVORITES_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useDeferredFavorites() {
  return useSyncExternalStore(subscribe, deferredFavoritesOn, () => true)
}

/**
 * Puts quests aside in this profile and mode: till «Вернуть» without a term (the map, «Квесты»), for days or until a level
 * with one (the Overview). Then, unless switched off, their keys and items go into «Избранное».
 */
export function useQuestDeferral() {
  const state = useAppState()
  const { data } = useTarkovData()
  const favorites = useDeferredFavorites()
  return useCallback((questIds: readonly string[], term?: DeferTerm) => {
    if (term) deferQuests(state.activeProfile.id, state.raidMode, questIds, term)
    else for (const questId of questIds) deferQuest(state.activeProfile.id, state.raidMode, questId)
    if (!favorites) return
    const itemsById = new Map(data.items.map((item) => [item.id, item]))
    const ids = questIds.flatMap((questId) => {
      const quest = data.quests.find((entry) => entry.id === questId)
      return quest ? questRaidItems(quest, itemsById).map((item) => item.id) : []
    }).filter((id) => !state.favoriteItemIds.includes(id))
    if (ids.length) state.addFavoriteItems(ids)
  }, [data, favorites, state])
}
