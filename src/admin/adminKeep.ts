/**
 * The answers the owner app's screens open with, kept on the phone (owner, 03.11.2026: «долго загружает»): the next
 * start shows them at once while fresh ones load. At most KEEP_LIMIT answers (the oldest go), none larger than
 * KEEP_MAX_CHARS; signing out forgets them all.
 */
const PREFIX = 'raidos-admin-answer:'
const INDEX_KEY = 'raidos-admin-answers-v1'
const KEEP_LIMIT = 40
const KEEP_MAX_CHARS = 200_000

export interface KeptAnswer<T> { at: number; value: T }

function readIndex(): Record<string, number> {
  try {
    const index = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '{}') as unknown
    return index && typeof index === 'object' ? index as Record<string, number> : {}
  } catch { return {} }
}

export function keepAnswer(key: string, value: unknown, at = Date.now()) {
  try {
    const text = JSON.stringify({ at, value })
    if (text.length > KEEP_MAX_CHARS) return
    localStorage.setItem(PREFIX + key, text)
    const index = { ...readIndex(), [key]: at }
    const keys = Object.keys(index).sort((a, b) => index[b]! - index[a]!)
    for (const old of keys.slice(KEEP_LIMIT)) { localStorage.removeItem(PREFIX + old); delete index[old] }
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch { /* storage full or closed: nothing kept */ }
}

export function keptAnswer<T>(key: string): KeptAnswer<T> | null {
  try {
    const kept = JSON.parse(localStorage.getItem(PREFIX + key) ?? 'null') as { at?: unknown; value?: unknown } | null
    return kept && typeof kept.at === 'number' && kept.value !== undefined && kept.value !== null ? { at: kept.at, value: kept.value as T } : null
  } catch { return null }
}

export function forgetKeptAnswers() {
  try {
    for (const key of Object.keys(readIndex())) localStorage.removeItem(PREFIX + key)
    localStorage.removeItem(INDEX_KEY)
  } catch { /* nothing to forget */ }
}
