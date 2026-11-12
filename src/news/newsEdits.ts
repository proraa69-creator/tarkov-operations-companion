import { useMemo, useSyncExternalStore } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { useAppVersion } from '../app/appVersion'
import { installedNews, NEWS, type NewsEntry, type NewsItem } from './newsState'
import { appStoreRules, storeSafeNews } from './storeSafe'
import { hidesPayments } from '../platform'

/**
 * «Обновление» as the owner left it (owner, 06.11.2026: «моментально этот текст должен поменяться и у всех пользователей, без обновления
 * приложения»): his lines over the app's own, per release (server/src/routes/playerNews.ts). Asked when the app starts and each
 * time the window opens, and again while it is open when the server says something changed; the last answer is kept on this device for a
 * start without network. A release this app does not know yet is not shown, and one left with no lines is not listed.
 */
export type NewsEdits = Record<string, NewsItem[]>

const KEY = 'raidos-news-edits-v1'
const KINDS: ReadonlySet<string> = new Set(['added', 'changed', 'improved'])

/** `{ edits }` of the server, shape-checked; null when the answer is not that. */
export function parseNewsEdits(value: unknown): NewsEdits | null {
  const edits = (value as { edits?: unknown } | null)?.edits
  if (!edits || typeof edits !== 'object') return null
  const result: NewsEdits = {}
  for (const [version, items] of Object.entries(edits)) {
    if (!Array.isArray(items)) continue
    result[version] = items.flatMap((item: Partial<NewsItem> | null) => (item && typeof item.ru === 'string' && item.ru && KINDS.has(item.kind ?? '')
      ? [{ kind: item.kind!, ru: item.ru, en: typeof item.en === 'string' ? item.en : '' }]
      : []))
  }
  return result
}

export function applyNewsEdits(list: readonly NewsEntry[], edits: NewsEdits): NewsEntry[] {
  return list.map((entry) => (edits[entry.version] ? { ...entry, items: edits[entry.version]! } : entry)).filter((entry) => entry.items.length > 0)
}

function stored(): NewsEdits {
  try { return parseNewsEdits({ edits: JSON.parse(localStorage.getItem(KEY) ?? 'null') }) ?? {} } catch { return {} }
}

let print = ''
let shown: NewsEntry[] = NEWS
let loaded = false
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function load() {
  if (loaded) return
  loaded = true
  const edits = stored()
  print = JSON.stringify(edits)
  shown = applyNewsEdits(NEWS, edits)
}

/** New lines from the server, or the owner's own save: kept, and every open window shows them at once. */
export function setNewsEdits(edits: NewsEdits) {
  load()
  const next = JSON.stringify(edits)
  if (next === print) return
  print = next
  shown = applyNewsEdits(NEWS, edits)
  try { localStorage.setItem(KEY, next) } catch { /* kept for this run */ }
  for (const listener of listeners) listener()
}

/** The list as players read it now: the releases this copy has installed. */
export function useNewsList() {
  load()
  const list = useSyncExternalStore(subscribe, () => shown, () => shown)
  const running = useAppVersion()
  // the iPhone app: nothing about paying (news/storeSafe.ts)
  return useMemo(() => { const news = installedNews(list, running); return appStoreRules() || hidesPayments() ? storeSafeNews(news) : news }, [list, running])
}

export async function refreshNewsEdits() {
  const request = serviceClient()
  if (!request) return
  try {
    const edits = parseNewsEdits(await request('GET', '/v1/player-news'))
    if (edits) setNewsEdits(edits)
  } catch { /* the last known text stays */ }
}

/** For the tests: a fresh start of the app. */
export function reloadNewsEditsForTests() {
  loaded = false
  load()
  for (const listener of listeners) listener()
}
