import { useSyncExternalStore } from 'react'

/**
 * «Настройки отряда» (owner, 14.11.2026: «В блоке отряд у нас будет настройка отряда… включить передачу зарисовок и включить
 * передачу местоположения тиммейтов… Еще можно включить отображение квестов тиммейта»). The same on every device of the account (sync/playerStateStores.ts
 * `prefs`; owner, 15.11.2026: «все должно везде дублироваться»).
 *
 * - `location`: this app sends the player's place from each game screenshot to the squad, and shows the mates who send theirs.
 * - `sketches`: a drawing kept with ✓ goes to the squad, and the mates' drawings show on the map.
 * - `quests`: the map has the button «Квесты отряда», which shows the mates' quest points in their colours.
 * The first two send something, so they are off until the player turns them on; the quests were on the map before, so on.
 */
export interface SquadSettings { location: boolean; sketches: boolean; quests: boolean }

export const SQUAD_SETTINGS_DEFAULTS: SquadSettings = { location: false, sketches: false, quests: true }
const KEY = 'raidos-squad-settings-v1'
const EVENT = 'raidos-squad-settings-changed'
/** «Настройки отряда» and the mates' drawings taken off the map travel to the account's other devices (sync/playerStateStores.ts). */
export const SQUAD_SETTINGS_SYNC = { key: KEY, event: EVENT } as const
/** A mate's drawing taken off this player's map (squad/squadLive.ts hideSquadSketch): off on the PC, off on the phone too. */
export const SQUAD_SKETCH_HIDDEN_SYNC = { key: 'raidos-squad-sketch-hidden-v1', event: 'raidos-squad-sketch-hidden' } as const
let cache: { raw: string | null; value: SquadSettings } | undefined

export function readSquadSettings(): SquadSettings {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { /* storage unavailable */ }
  if (cache?.raw === raw) return cache.value
  let value = SQUAD_SETTINGS_DEFAULTS
  try {
    const stored = raw ? JSON.parse(raw) as Partial<Record<keyof SquadSettings, unknown>> : null
    if (stored && typeof stored === 'object') {
      value = {
        location: typeof stored.location === 'boolean' ? stored.location : SQUAD_SETTINGS_DEFAULTS.location,
        sketches: typeof stored.sketches === 'boolean' ? stored.sketches : SQUAD_SETTINGS_DEFAULTS.sketches,
        quests: typeof stored.quests === 'boolean' ? stored.quests : SQUAD_SETTINGS_DEFAULTS.quests,
      }
    }
  } catch { /* a broken value: the defaults */ }
  cache = { raw, value }
  return value
}

export function setSquadSetting(key: keyof SquadSettings, on: boolean) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readSquadSettings(), [key]: on })) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useSquadSettings() {
  return useSyncExternalStore(subscribe, readSquadSettings, () => SQUAD_SETTINGS_DEFAULTS)
}
