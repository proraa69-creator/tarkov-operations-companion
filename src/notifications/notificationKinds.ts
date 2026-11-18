import { useSyncExternalStore } from 'react'

/**
 * The switches of «Уведомления» → «Настроить» (owner, 18.11.2026: «Любое уведомление можно поставить включить, выключить… например,
 * у нас уведомление по коллекционеру… кому-то надо, кому-то нет… рейд начался… должна быть кнопка, чтобы включить звуковой
 * сигнал или нет»). The notifications that had a switch of their own keep it (raid start, restocks, «Торговля», quest keys) and the
 * window turns that one; the others are kept here, all on until turned off, and travel with the account
 * (sync/playerStateStores.ts).
 */
export type NotificationKind = 'collector' | 'support' | 'app-updated' | 'raid-start-sound'
const KINDS: readonly NotificationKind[] = ['collector', 'support', 'app-updated', 'raid-start-sound']

const KEY = 'raidos-notification-kinds-v1'
const EVENT = 'raidos-notification-kinds-changed'
/** The account's other devices keep this too: sync/playerStateStores.ts reads and writes it in this format. */
export const NOTIFICATION_KINDS_SYNC = { key: KEY, event: EVENT } as const

type Kinds = Readonly<Record<NotificationKind, boolean>>
const ALL_ON: Kinds = { collector: true, support: true, 'app-updated': true, 'raid-start-sound': true }
let cachedRaw: string | null | undefined
let cached: Kinds = ALL_ON

/** Every kind on unless it was turned off: `{ collector: false }` is all that is stored for one turned off. */
export function readNotificationKinds(): Kinds {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { /* storage unavailable */ }
  if (raw === cachedRaw) return cached
  cachedRaw = raw
  let stored: Record<string, unknown> = {}
  try { stored = raw ? JSON.parse(raw) as Record<string, unknown> : {} } catch { stored = {} }
  cached = Object.fromEntries(KINDS.map((kind) => [kind, stored?.[kind] !== false])) as unknown as Kinds
  return cached
}

export const notificationOn = (kind: NotificationKind) => readNotificationKinds()[kind]

export function setNotificationOn(kind: NotificationKind, on: boolean) {
  const off = Object.fromEntries(KINDS.filter((entry) => (entry === kind ? !on : !readNotificationKinds()[entry])).map((entry) => [entry, false]))
  try {
    if (Object.keys(off).length) localStorage.setItem(KEY, JSON.stringify(off))
    else localStorage.removeItem(KEY)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', onStorage) }
}

export const useNotificationKinds = () => useSyncExternalStore(subscribe, readNotificationKinds, () => ALL_ON)
