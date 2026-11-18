import { useMemo, useSyncExternalStore } from 'react'
import type { MapMarker } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { hideoutNeeds } from '../hideout/hideoutNeeds'
import { useHideoutFound } from '../hideout/hideoutFound'
import { withSeasonFoundInRaid } from '../hideout/seasonFoundInRaid'
import { questNeeds } from '../quests/questItemNeeds'
import { useQuestFound } from '../quests/questFound'
import { questAvailabilityOf } from '../quests/questReadModel'
import { keysOfPoint } from './neededKeys'

/**
 * «Показывать только нужные спавны» (owner, 19.11.2026, «Настройки карты»): the loot spots the map shows are those where something
 * still needed may lie — what «Что собрать для убежища» and «Предметы для квестов» have not counted yet, and the keys the current
 * quests need. A spot is known by its items (loose loot, key spots); a container's contents are in no data, so containers stay
 * as they are.
 */
const KEY = 'raidos-needed-spawns-only-v1'
const EVENT = 'raidos-needed-spawns-changed'
export const NEEDED_SPAWNS_SYNC = { key: KEY, event: EVENT } as const

const read = () => { try { return localStorage.getItem(KEY) === 'on' } catch { return false } }
export function setNeededSpawnsOnly(on: boolean) {
  try { if (on) localStorage.setItem(KEY, 'on'); else localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}
function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', onStorage) }
}
export const useNeededSpawnsOnly = () => useSyncExternalStore(subscribe, read, () => false)

/** The items still to find for the hideout and the quests in this mode (what their pages show as not collected). */
export function useNeededLootIds(): ReadonlySet<string> {
  const { data } = useTarkovData()
  const state = useAppState()
  const mode = state.raidMode
  const profileId = state.activeProfile.id
  const progress = state.activeProfile.modes[mode]
  const hideoutFound = useHideoutFound(profileId, mode)
  const questFound = useQuestFound(profileId, mode)
  return useMemo(() => {
    const stations = withSeasonFoundInRaid([...data.hideout].filter((entry) => entry.levels?.length), mode)
    const hideout = hideoutNeeds(stations, progress.hideoutLevels, hideoutFound)
    const rounds = new Set(data.items.filter((item) => item.category === 'Боеприпас' || item.types?.includes('ammo')).map((item) => item.id))
    const quests = questNeeds(data.quests, progress, questAvailabilityOf(data.quests, progress), questFound, undefined, rounds)
    return new Set([...hideout.items, ...quests.items].filter((need) => need.remaining > 0).map((need) => need.itemId))
  }, [data.hideout, data.items, data.quests, mode, progress, hideoutFound, questFound])
}

/** Whether a loot spot is shown with «только нужные» on: a spot of known items holds one still needed; any other spot stays. */
export function spotIsNeeded(marker: Pick<MapMarker, 'lootIds' | 'keyIds' | 'itemId' | 'layerId'>, needed: ReadonlySet<string>, neededKeys: { has(id: string): boolean }) {
  const loot = marker.lootIds ?? []
  const keys = marker.layerId === 'loot.key' ? keysOfPoint(marker) : []
  if (!loot.length && !keys.length) return true
  return loot.some((id) => needed.has(id)) || keys.some((id) => neededKeys.has(id) || needed.has(id))
}
