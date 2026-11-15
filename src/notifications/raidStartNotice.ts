import { useSyncExternalStore } from 'react'

/**
 * «Рейд начался» (owner, 15.11.2026: «человек свернул игру и ждет, пока у него идет загрузка. Как только рейд начинается, должно
 * всплывать уведомление… бывает, что где-то залипнут, видос смотрят и забывают»). On by default; a switch in «Настройки» turns it
 * off on this device. No sound for now («пока без звука»).
 */
const KEY = 'raidos-raid-start-notice'
const ANNOUNCED_KEY = 'raidos-raid-start-announced'
const EVENT = 'raidos-raid-start-notice-changed'
/** A raid that began longer ago than this is not news: the app was started in the middle of it, or the phone woke up late. */
export const RAID_START_FRESH_MS = 10 * 60 * 1000

export function raidStartNoticeOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}

export function setRaidStartNotice(on: boolean) {
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 'off') } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', onStorage) }
}

export function useRaidStartNotice(): boolean {
  return useSyncExternalStore(subscribe, raidStartNoticeOn, () => true)
}

function lastAnnounced(): number | null {
  try {
    const value = Number(localStorage.getItem(ANNOUNCED_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * Whether the raid that began at `begun` is to be announced now: once per raid (kept on the device, so a restart of the app does
 * not say it again), only while it is fresh, and only with the switch on. Marks it announced when it says yes.
 */
export function takeRaidStart(begun: number | undefined, now = Date.now()): boolean {
  if (!begun || !raidStartNoticeOn()) return false
  if (lastAnnounced() === begun) return false
  if (now - begun > RAID_START_FRESH_MS || begun - now > RAID_START_FRESH_MS) return false
  try { localStorage.setItem(ANNOUNCED_KEY, String(begun)) } catch { /* storage unavailable */ }
  return true
}
