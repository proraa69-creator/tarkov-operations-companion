import { useSyncExternalStore } from 'react'
import news from '../data/playerNews.json'

/**
 * «Новости обновлений» (owner, 05.11.2026: «Сделать публичный новостной ChangeLog… с метками Прочитано / Не прочитано… если он
 * прочитал, уведомление у него уходит. Если не прочитал, то висит»). Each version players can see has an entry in
 * src/data/playerNews.json: new functions, what changed, what got better, in a line each, nothing about how it was made. What has
 * been read is kept on this device. The first look counts only the newest entry as unread: nobody meets a badge of ten.
 */
export type NewsKind = 'added' | 'changed' | 'improved'
export interface NewsItem { kind: NewsKind; ru: string; en: string }
export interface NewsEntry { version: string; date: string; items: NewsItem[] }

export const NEWS = news as NewsEntry[]

const KEY = 'raidos-news-read-v1'
const EVENT = 'raidos-news-changed'
const NOTHING: ReadonlySet<string> = new Set()

let cached: { raw: string | null; list: readonly NewsEntry[] | null; read: ReadonlySet<string> } = { raw: null, list: null, read: NOTHING }

function parse(raw: string | null, list: readonly NewsEntry[]): ReadonlySet<string> {
  if (raw !== null) {
    try {
      const stored: unknown = JSON.parse(raw)
      if (Array.isArray(stored)) return new Set(stored.filter((entry): entry is string => typeof entry === 'string'))
    } catch { /* a damaged value reads as the first look */ }
  }
  return new Set(list.slice(1).map((entry) => entry.version))
}

/** The versions marked as read; before the first look, every entry but the newest. */
export function readNews(list: readonly NewsEntry[] = NEWS): ReadonlySet<string> {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { /* storage unavailable */ }
  // The same answer object until something changes: React re-renders whenever a store hands it a new one.
  if (raw !== cached.raw || list !== cached.list) cached = { raw, list, read: parse(raw, list) }
  return cached.read
}

function write(read: ReadonlySet<string>) {
  try { localStorage.setItem(KEY, JSON.stringify([...read])) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

/** Keeps the first look's verdict: an entry left unread stays unread when the next version comes. */
export function rememberFirstLook(list: readonly NewsEntry[] = NEWS) {
  try {
    if (localStorage.getItem(KEY) === null) localStorage.setItem(KEY, JSON.stringify([...readNews(list)]))
  } catch { /* storage unavailable */ }
}

export function markAllNewsRead(list: readonly NewsEntry[] = NEWS) {
  write(new Set(list.map((entry) => entry.version)))
}

export function unreadNews(read: ReadonlySet<string>, list: readonly NewsEntry[] = NEWS) {
  return list.filter((entry) => !read.has(entry.version))
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

export function useReadNews() {
  return useSyncExternalStore(subscribe, () => readNews(), () => NOTHING)
}
