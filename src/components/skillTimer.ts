import { useSyncExternalStore } from 'react'

/**
 * A plain manual countdown on the PC map (player report 155): the player starts it himself to time the pause a skill
 * needs to shed its fatigue. It reads nothing from the game and makes no sound. Off until turned on in the map's gear menu
 * (owner, 15.11.2026), 200 s unless another length is picked there.
 */

export const SKILL_TIMER_DEFAULT = 200
export const SKILL_TIMER_MIN = 5
export const SKILL_TIMER_MAX = 3600

const ENABLED_KEY = 'raidos-map-skill-timer-on-v1'
const DURATION_KEY = 'raidos-map-skill-timer-seconds-v1'
const EVENT = 'raidos-map-skill-timer-changed'
const ENDS_AT_KEY = 'raidos-map-skill-timer-ends-at-v1'

/** Whole seconds in range; anything unreadable falls back to 200. */
export function clampTimerSeconds(value: unknown): number {
  const number = typeof value === 'string' ? Number(value.trim()) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(number) || number <= 0) return SKILL_TIMER_DEFAULT
  return Math.min(SKILL_TIMER_MAX, Math.max(SKILL_TIMER_MIN, Math.round(number)))
}

/** `m:ss`, so 200 reads 3:20 and an idle timer 0:00. */
export function formatTimerClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Seconds left until `endsAt` (ms); 0 when idle or over. */
export function timerSecondsLeft(endsAt: number | null, now: number): number {
  if (endsAt === null) return 0
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const store = (): Store | null => { try { return window.localStorage } catch { return null } }

export function loadTimerSeconds(storage: Store | null = store()): number {
  try { return clampTimerSeconds(storage?.getItem(DURATION_KEY) ?? SKILL_TIMER_DEFAULT) } catch { return SKILL_TIMER_DEFAULT }
}

export function saveTimerSeconds(seconds: number, storage: Store | null = store()) {
  try { storage?.setItem(DURATION_KEY, String(clampTimerSeconds(seconds))) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

export function isSkillTimerEnabled(storage: Store | null = store()): boolean {
  try { return storage?.getItem(ENABLED_KEY) === '1' } catch { return false }
}

export function setSkillTimerEnabled(enabled: boolean, storage: Store | null = store()) {
  try { storage?.setItem(ENABLED_KEY, enabled ? '1' : '0') } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === ENABLED_KEY || event.key === DURATION_KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export const useSkillTimerEnabled = () => useSyncExternalStore(subscribe, () => isSkillTimerEnabled(), () => false)
export const useSkillTimerSeconds = () => useSyncExternalStore(subscribe, () => loadTimerSeconds(), () => SKILL_TIMER_DEFAULT)

/** A running countdown survives leaving the map page and an interface reload. */
export function loadTimerEndsAt(now: number, storage: Store | null = store()): number | null {
  try {
    const value = Number(storage?.getItem(ENDS_AT_KEY))
    return Number.isFinite(value) && value > now ? value : null
  } catch { return null }
}

export function saveTimerEndsAt(endsAt: number | null, storage: Store | null = store()) {
  try {
    if (endsAt === null) storage?.removeItem(ENDS_AT_KEY)
    else storage?.setItem(ENDS_AT_KEY, String(endsAt))
  } catch { /* storage unavailable */ }
}
