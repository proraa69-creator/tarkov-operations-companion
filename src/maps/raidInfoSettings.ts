import { useSyncExternalStore } from 'react'
import type { MapMarker } from '../domain/types'
import { flareExitsOn } from '../raidprep/exitFlares'
import { isUncertainExit } from './raidExtracts'

/**
 * Report 239 (player, 25.11.2026: «таймер рейда и сколько осталось до конца рейда… выходы активные на карту… так как в основном
 * открыта всегда карта, когда играешь»), owner 25.11.2026: over the map, under «Отложенные квесты», the time in Tarkov and what
 * is left of the raid, red under 10 minutes — «Оставшееся время рейда» in «Настройки карты»; and under «Ключи» a «Выходы» button
 * whose list stays open until pressed again — «Список выходов»: the exits the game listed (double O), the ones a flare opens
 * and the car exit, there or not.
 */

/** Under this much time left the raid's time turns red (owner: «когда остается меньше 10 минут… подсвечиваются красным»). */
export const RAID_LATE_MS = 10 * 60_000

/** A switch kept on this device, on until turned off. */
function deviceSwitchOn(key: string) {
  const event = `${key}-changed`
  const read = () => { try { return localStorage.getItem(key) !== 'off' } catch { return true } }
  const set = (on: boolean) => {
    try { if (on) localStorage.removeItem(key); else localStorage.setItem(key, 'off') } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(event))
  }
  const subscribe = (listener: () => void) => {
    const onStorage = (change: StorageEvent) => { if (change.key === null || change.key === key) listener() }
    window.addEventListener(event, listener)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener(event, listener); window.removeEventListener('storage', onStorage) }
  }
  return { read, set, use: () => useSyncExternalStore(subscribe, read, () => true) }
}

/** «Оставшееся время рейда»: the time in Tarkov and the raid's time under «Отложенные квесты». */
const raidClock = deviceSwitchOn('raidos-map-raid-clock-v1')
export const setRaidClockOn = raidClock.set
export const useRaidClockOn = raidClock.use

/** «Список выходов»: the «Выходы» button under «Ключи». */
const exitsList = deviceSwitchOn('raidos-map-exits-list-v1')
export const setExitsListOn = exitsList.set
export const useExitsListOn = exitsList.use

/** The list opened by «Выходы» stays open until «Выходы» is pressed again, on this device. */
const listOpen = (() => {
  const key = 'raidos-map-exits-list-open-v1'
  const event = `${key}-changed`
  const read = () => { try { return localStorage.getItem(key) === 'open' } catch { return false } }
  const set = (open: boolean) => {
    try { if (open) localStorage.setItem(key, 'open'); else localStorage.removeItem(key) } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(event))
  }
  const subscribe = (listener: () => void) => { window.addEventListener(event, listener); return () => window.removeEventListener(event, listener) }
  return { set, use: () => useSyncExternalStore(subscribe, read, () => false) }
})()
export const setExitsListOpen = listOpen.set
export const useExitsListOpen = listOpen.use

/** One line of «Выходы». `state`: the game listed it (`open`), did not (`closed`), or nothing was read this raid (`unknown`). */
export interface RaidExitRow {
  id: string
  title: string
  state: 'open' | 'closed' | 'unknown'
  /** Opened by a flare: the player takes one along. */
  flare: boolean
  /** The paid car exit (V-Ex): always on the list, there or not. */
  car: boolean
}

const TRAIN = /бронепоезд|armou?red train/i
const FLARE_TITLE = /\((?:Сигнал|Flare)\)/i

/**
 * The lines of «Выходы» for `side`'s raid on `mapId`. After the game's list was read this raid (`states`, raidExtracts.ts
 * exitHighlights): the exits it named, every flare exit and the car exit whatever it said. Nothing read yet: every exit of the
 * side, none known. Named exits first, then by name; a PMC's exit and its Scav twin are one line.
 */
export function raidExitRows(markers: readonly MapMarker[], mapId: string, side: 'pmc' | 'scav', states: { lit: ReadonlySet<string>; dim: ReadonlySet<string> } | null): RaidExitRow[] {
  const flareIds = new Set(flareExitsOn(markers, mapId).map((marker) => marker.extractId ?? marker.id))
  const seen = new Set<string>()
  const rows: RaidExitRow[] = []
  for (const marker of markers) {
    if (marker.mapId !== mapId || marker.type !== 'extract' || marker.layerId === 'transit') continue
    const faction = marker.extractFaction ?? 'pmc'
    if (side === 'scav' ? faction === 'pmc' : faction === 'scav') continue
    const key = `${marker.extractId ?? marker.id}|${marker.title.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const car = isUncertainExit(marker.title) && !TRAIN.test(marker.title)
    const flare = flareIds.has(marker.extractId ?? marker.id) || FLARE_TITLE.test(marker.title)
    const state: RaidExitRow['state'] = !states ? 'unknown' : states.lit.has(marker.id) ? 'open' : 'closed'
    if (states && state === 'closed' && !car && !flare) continue
    rows.push({ id: marker.id, title: marker.title, state, flare, car })
  }
  const rank = (row: RaidExitRow) => (row.state === 'open' ? 0 : 1)
  return rows.sort((a, b) => rank(a) - rank(b) || Number(a.car) - Number(b.car) || a.title.localeCompare(b.title, 'ru'))
}
