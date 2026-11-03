/**
 * Putting quests aside from any place of the app (the map, «Квесты», the Overview's right click), and «Предметы в
 * избранное» (owner, 03.11.2026: «сделай настройку что бы предмет или ключ который требуется для квеста который отложен,
 * сам добавлялся в избранное как напоминание. сделай что бы эту функцию можно было отключить»): the keys and items a
 * quest put aside needs in the raid (questRaidItems, the ones its row in «Отложенные квесты» shows) go into «Избранное».
 * On by default; the switch is on the right of «Отложенные квесты» (components/DeferredQuests.tsx), kept on this device.
 * Added at the moment a quest is put aside; when it comes back, what was added for it and no other quest put aside needs
 * leaves «Избранное» again (owner, 03.11.2026: «когда убираешь квест из отложенных, предметы добавленые в избранное должны
 * удаляться»; progression/autoFavorites.ts). What the player starred himself stays.
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { recordAutoFavorites } from './autoFavorites'
import { deferQuest, deferQuests, questRaidItems, readDeferredQuests, type DeferTerm } from './deferredQuests'

const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

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
 * with one (the Overview). Then, unless switched off, their keys and items go into «Избранное», each kept there by every
 * quest put aside that needs it — in any mode, and the ones put aside earlier too — until the last of them comes back.
 */
export function useQuestDeferral() {
  const state = useAppState()
  const { data } = useTarkovData()
  const favorites = useDeferredFavorites()
  return useCallback((questIds: readonly string[], term?: DeferTerm) => {
    const profileId = state.activeProfile.id
    const mode = state.raidMode
    if (term) deferQuests(profileId, mode, questIds, term)
    else for (const questId of questIds) deferQuest(profileId, mode, questId)
    const itemsById = new Map(data.items.map((item) => [item.id, item]))
    const needs = (questId: string) => {
      const quest = data.quests.find((entry) => entry.id === questId)
      return quest ? questRaidItems(quest, itemsById).map((item) => item.id) : []
    }
    const these = questIds.map((questId) => ({ mode, questId, itemIds: needs(questId) }))
    // Switched off: nothing new goes in, yet these quests still keep what the feature put there for others.
    const added = favorites ? [...new Set(these.flatMap((entry) => entry.itemIds))].filter((id) => !state.favoriteItemIds.includes(id)) : []
    const others = added.length
      ? MODES.flatMap((otherMode) => [...readDeferredQuests(profileId, otherMode).keys()]
        .filter((questId) => otherMode !== mode || !questIds.includes(questId))
        .map((questId) => ({ mode: otherMode, questId, itemIds: needs(questId).filter((id) => added.includes(id)) })))
        .filter((entry) => entry.itemIds.length)
      : []
    recordAutoFavorites(profileId, [...these, ...others], added)
    if (added.length) state.addFavoriteItems(added)
  }, [data, favorites, state])
}
