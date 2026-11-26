import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'

/**
 * The daily limit of battle pass documents (report №194, owner 19.11.2026: «счетчик дневного лимита документов… сколько нажали
 * «Нашел», такой будет лимит… 1 из 40… когда будет найдено 40 документов, он пишет, что дневной лимит документов исчерпан»).
 *
 * The game counts the documents a character picks up in a day, all modes together, up to the limit of the mode played: Season
 * 40, PvP 25, PvE 15 (escapefromtarkov.fandom.com/wiki/BattlePass, 19.11.2026: 15 picked up in PvE leave 25 for Season). No
 * reset time is published; players report the day ends 24 hours after its first document (senseos.gg guide) — so it is here.
 * The app counts the presses of «Нашёл», per profile on this device: a press is a document picked up.
 */
export const DOCUMENT_DAILY_LIMIT: Record<RaidMode, number> = { seasonal: 40, pvp: 25, pve: 15 }
export const DOCUMENT_DAY_MS = 24 * 60 * 60 * 1000

const KEY_PREFIX = 'raidos-document-day-v1:'
const EVENT = 'raidos-document-day-changed'

export interface DocumentDay { count: number; since: number }
const EMPTY: DocumentDay = { count: 0, since: 0 }

function stored(profileId: string): DocumentDay {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY_PREFIX + profileId) ?? 'null')
    if (value && typeof value === 'object') {
      const { count, since } = value as Partial<DocumentDay>
      if (typeof count === 'number' && typeof since === 'number' && Number.isFinite(count) && Number.isFinite(since)) return { count, since }
    }
  } catch { /* storage unavailable or damaged: a new day */ }
  return EMPTY
}

/** Today's documents of the profile: none once the day (24 hours from its first document) is over. */
export function readDocumentDay(profileId: string, now = Date.now()): DocumentDay {
  const day = stored(profileId)
  return day.count > 0 && now - day.since < DOCUMENT_DAY_MS ? day : EMPTY
}

function writeDocumentDay(profileId: string, day: DocumentDay) {
  try { localStorage.setItem(KEY_PREFIX + profileId, JSON.stringify(day)) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
  return day
}

/** A press of «Нашёл»: one document more today (the first one starts the day). */
export function countDocumentFound(profileId: string, now = Date.now()) {
  return addDocumentsFound(profileId, 1, now)
}

/**
 * Documents more today: «+» of «Документы» in «Время в Таркове» adds one, the window after a raid as many as were brought out
 * (owner, 27.11.2026: «Сколько вынес за рейд, столько и добавляешь»); the first one starts the day.
 */
export function addDocumentsFound(profileId: string, count: number, now = Date.now()) {
  const day = readDocumentDay(profileId, now)
  const amount = Math.max(0, Math.floor(count))
  if (!amount) return day
  return writeDocumentDay(profileId, day.count > 0 ? { count: day.count + amount, since: day.since } : { count: amount, since: now })
}

/** «−» of «Документы» (owner, 27.11.2026: «ставишь плюсик или минус»): one less today, never under none; the last one ends the day. */
export function takeBackDocument(profileId: string, now = Date.now()) {
  const day = readDocumentDay(profileId, now)
  if (day.count <= 0) return day
  return writeDocumentDay(profileId, day.count > 1 ? { count: day.count - 1, since: day.since } : EMPTY)
}

/** «Удалить все данные». */
export function clearDocumentDays() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    for (const key of keys) if (key?.startsWith(KEY_PREFIX)) localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}

/** «10/40», or that the limit is reached. */
export function documentDayText(count: number, mode: RaidMode) {
  const limit = DOCUMENT_DAILY_LIMIT[mode]
  return count >= limit ? 'Дневной лимит документов исчерпан' : `${count}/${limit}`
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(KEY_PREFIX)) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Today's count, live: a press here or on another window, and the day's end (checked each minute). */
export function useDocumentDay(profileId: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const read = useCallback(() => JSON.stringify(readDocumentDay(profileId, now)), [profileId, now])
  const raw = useSyncExternalStore(subscribe, read, () => JSON.stringify(EMPTY))
  return JSON.parse(raw) as DocumentDay
}
