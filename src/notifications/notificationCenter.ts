import { useSyncExternalStore } from 'react'

/**
 * «Уведомления» (owner, 07.11.2026: «Все уведомления в приложении не должны открываться поверх игры… кнопку, чтобы можно было
 * просмотреть уведомления… если уведомление не прочитаны, они тоже подсвечиваются цифрами»). Everything the app told the player, so
 * nothing is lost while the game is in front: the system message is then not shown at all (electron/main.ts app:notify).
 * Kept on this device; nothing goes to the server.
 */
export interface AppNotification {
  id: string
  title: string
  text: string
  at: number
  /** Where a press on it leads. */
  open?: string
  read?: boolean
}

const STORAGE_KEY = 'raidos-notifications-v1'
/** The newest this many: older ones have no use. */
export const MAX_NOTIFICATIONS = 50
const EVENT = 'raidos-notifications-changed'
const NONE: readonly AppNotification[] = []

let raw: string | null | undefined
let list: readonly AppNotification[] = NONE

function parse(value: string | null): readonly AppNotification[] {
  if (!value) return NONE
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return NONE
    return parsed.filter((entry: Partial<AppNotification> | null): entry is AppNotification => Boolean(entry) && typeof entry!.id === 'string' && typeof entry!.title === 'string' && typeof entry!.text === 'string' && typeof entry!.at === 'number')
  } catch {
    return NONE
  }
}

function read(): readonly AppNotification[] {
  let stored: string | null
  // No storage: only what this visit wrote.
  try { stored = localStorage.getItem(STORAGE_KEY) } catch { return list }
  if (stored !== raw) {
    raw = stored
    list = parse(stored)
  }
  return list
}

function write(next: readonly AppNotification[]) {
  list = next
  try {
    raw = next.length ? JSON.stringify(next) : null
    if (raw === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, raw)
  } catch { /* no storage: for this visit */ }
  window.dispatchEvent(new Event(EVENT))
}

/** The newest first; only the newest {@link MAX_NOTIFICATIONS} stay. */
export function addNotification(entry: { title: string; text: string; open?: string }, at = Date.now()) {
  const before = read()
  const id = `${at}-${before.length}-${entry.title.length}${entry.text.length}`
  write([{ id, title: entry.title, text: entry.text, at, ...(entry.open ? { open: entry.open } : {}) }, ...before].slice(0, MAX_NOTIFICATIONS))
}

export function markNotificationsRead() {
  const before = read()
  if (before.some((entry) => !entry.read)) write(before.map((entry) => (entry.read ? entry : { ...entry, read: true })))
}

export function clearNotifications() {
  if (read().length) write([])
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export const useNotifications = () => useSyncExternalStore(subscribe, read, () => NONE)
export const unreadNotifications = (entries: readonly AppNotification[]) => entries.filter((entry) => !entry.read).length
