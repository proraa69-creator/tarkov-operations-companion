import { useSyncExternalStore } from 'react'
import type { MapMarker, Quest } from '../domain/types'
import { keysOfPoint } from './neededKeys'

/**
 * «Ключи рядом» (owner, 19.11.2026): in a raid, a key a current quest needs and the player has not, whose spawn lies near any point
 * of a current quest on this map — «недалеко от вашего квеста есть спавн вот этого ключа, проверьте». Only in a raid; «Закрыть»
 * ends it for that raid, «Свернуть» keeps the spawns on the map. Switched in «Настройки карты».
 */
export const NEARBY_KEY_METRES = 50
/** Spawns this far above or below a quest point are another storey. */
const SAME_STOREY_METRES = 6

export interface NearbyKey { keyId: string; quests: Quest[]; spots: MapMarker[] }

const distance = (a: MapMarker, b: MapMarker) => Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1])
const sameStorey = (a: MapMarker, b: MapMarker) => typeof a.height !== 'number' || typeof b.height !== 'number' || Math.abs(a.height - b.height) <= SAME_STOREY_METRES

/**
 * The needed keys whose spawns lie within `metres` of a point of a current quest, each with those spawns. `keySpots`: this map's
 * loose key spots; `questPoints`: this map's points of the quests in progress; `needed`: key id → the quests that need it.
 */
export function nearbyKeys(keySpots: readonly MapMarker[], questPoints: readonly MapMarker[], needed: ReadonlyMap<string, { quests: Quest[] }>, metres = NEARBY_KEY_METRES): NearbyKey[] {
  const byKey = new Map<string, NearbyKey>()
  for (const spot of keySpots) {
    const wanted = keysOfPoint(spot).filter((id) => needed.has(id))
    if (!wanted.length) continue
    if (!questPoints.some((point) => sameStorey(spot, point) && distance(spot, point) <= metres)) continue
    for (const keyId of wanted) {
      const entry = byKey.get(keyId) ?? { keyId, quests: needed.get(keyId)!.quests, spots: [] }
      entry.spots.push(spot)
      byKey.set(keyId, entry)
    }
  }
  return [...byKey.values()]
}

// ------------------------------------------------------------------------------------------------------------
// The switch («Настройки карты» → «Показывать уведомления о ближайших ключах») and «Закрыть» for this raid
// ------------------------------------------------------------------------------------------------------------

const KEY = 'raidos-nearby-keys-v1'
const CLOSED_KEY = 'raidos-nearby-keys-closed'
const FOLDED_KEY = 'raidos-nearby-keys-folded'
const EVENT = 'raidos-nearby-keys-changed'
/** The account's other devices keep the switch too: sync/playerStateStores.ts reads and writes it in this format. */
export const NEARBY_KEYS_SYNC = { key: KEY, event: EVENT } as const

const read = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key: string, value: string | null) => {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export const nearbyKeysOn = () => read(KEY) !== 'off'
export const setNearbyKeysOn = (on: boolean) => write(KEY, on ? null : 'off')
/** The raid (by its start) whose «Ключи рядом» was closed. */
export const nearbyKeysClosedFor = () => Number(read(CLOSED_KEY)) || 0
export const closeNearbyKeys = (raidSince: number) => write(CLOSED_KEY, String(raidSince))
/** The raid (by its start) whose «Ключи рядом» was folded: its spawns stay on the map, unlit, until the raid ends. */
export const nearbyKeysFoldedFor = () => Number(read(FOLDED_KEY)) || 0
export const foldNearbyKeys = (raidSince: number | null) => write(FOLDED_KEY, raidSince === null ? null : String(raidSince))

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY || event.key === CLOSED_KEY || event.key === FOLDED_KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', onStorage) }
}

export const useNearbyKeysOn = () => useSyncExternalStore(subscribe, nearbyKeysOn, () => true)
export const useNearbyKeysClosedFor = () => useSyncExternalStore(subscribe, nearbyKeysClosedFor, () => 0)
export const useNearbyKeysFoldedFor = () => useSyncExternalStore(subscribe, nearbyKeysFoldedFor, () => 0)
