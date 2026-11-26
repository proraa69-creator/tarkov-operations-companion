import { useSyncExternalStore } from 'react'

/**
 * The Overview's first small block (owner, 15.11.2026: «в этом блоке будет кнопка маленькая, квадратная, настроек. И там можно
 * выбрать время в Таркове, сбросов торговцев, таймер рейда… А пресеты оттуда убери… на телефоне оставь еще на выбор пресетов»).
 */
export type InfoCardView = 'tarkov-time' | 'restock' | 'raid-timer' | 'screen'

const VIEW_KEY = 'raidos-overview-info-card'
/**
 * «Боевой пропуск» ticked in the block's gear (owner, 27.11.2026: «это будет добавляться в настройках, что показывать. И можно ставить
 * несколько предметов»): today's battle pass documents, with «−» and «+», under whatever the block shows; on this device.
 */
const DOCUMENTS_KEY = 'raidos-overview-info-documents'
const VIEW_EVENT = 'raidos-overview-info-card-changed'
const VIEWS: readonly InfoCardView[] = ['tarkov-time', 'restock', 'raid-timer', 'screen']

/** The block's view on this device; «screen» only on the phone (the PC's presets left the block). */
export function readInfoCardView(phone: boolean): InfoCardView {
  let saved: string | null = null
  try { saved = localStorage.getItem(VIEW_KEY) } catch { /* storage unavailable */ }
  const view = VIEWS.find((entry) => entry === saved)
  if (view && (phone || view !== 'screen')) return view
  // before a choice: the phone keeps its presets, the PC shows the time in Tarkov
  return phone ? 'screen' : 'tarkov-time'
}

export function setInfoCardView(view: InfoCardView) {
  try { localStorage.setItem(VIEW_KEY, view) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(VIEW_EVENT))
}

function subscribeView(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === VIEW_KEY || event.key === DOCUMENTS_KEY) listener() }
  window.addEventListener(VIEW_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(VIEW_EVENT, listener); window.removeEventListener('storage', onStorage) }
}

export function useInfoCardView(phone: boolean): InfoCardView {
  return useSyncExternalStore(subscribeView, () => readInfoCardView(phone), () => readInfoCardView(phone))
}

export function readInfoCardDocuments() {
  try { return localStorage.getItem(DOCUMENTS_KEY) === 'on' } catch { return false }
}

export function setInfoCardDocuments(on: boolean) {
  try {
    if (on) localStorage.setItem(DOCUMENTS_KEY, 'on')
    else localStorage.removeItem(DOCUMENTS_KEY)
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(VIEW_EVENT))
}

export function useInfoCardDocuments() {
  return useSyncExternalStore(subscribeView, readInfoCardDocuments, () => false)
}

// ── Time in Tarkov ────────────────────────────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
/** Tarkov's clock runs seven times as fast as ours; Moscow time is its base, and the second clock is twelve hours on. */
const TARKOV_RATIO = 7
const MOSCOW_MS = 3 * HOUR_MS
const NIGHT_FROM = 22
const NIGHT_TO = 5

export interface TarkovClock {
  hours: number
  minutes: number
  night: boolean
  /** Real ms until night begins (by day) or ends (by night). */
  untilChange: number
}

/** The two clocks of the raid selection screen (left: the base, right: twelve hours on). */
export function tarkovClocks(now: number): [TarkovClock, TarkovClock] {
  return [clockAt(now, 0), clockAt(now, 12 * HOUR_MS)]
}

function clockAt(now: number, shift: number): TarkovClock {
  const inDay = (MOSCOW_MS + shift + now * TARKOV_RATIO) % DAY_MS
  const hours = Math.floor(inDay / HOUR_MS)
  const minutes = Math.floor((inDay % HOUR_MS) / 60_000)
  const night = hours >= NIGHT_FROM || hours < NIGHT_TO
  const next = night ? NIGHT_TO * HOUR_MS : NIGHT_FROM * HOUR_MS
  const ahead = (next - inDay + DAY_MS) % DAY_MS
  return { hours, minutes, night, untilChange: Math.ceil(ahead / TARKOV_RATIO) }
}

export const formatClock = ({ hours, minutes }: Pick<TarkovClock, 'hours' | 'minutes'>) => `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`

/** «1 ч 05 мин», «12 мин», «40 с» (RU) / «1 h 05 min» (EN). */
export function formatSpan(ms: number, locale: 'ru' | 'en' = 'ru') {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const units = locale === 'en' ? { h: 'h', m: 'min', s: 's' } : { h: 'ч', m: 'мин', s: 'с' }
  if (hours > 0) return `${hours} ${units.h} ${String(minutes).padStart(2, '0')} ${units.m}`
  if (minutes > 0) return `${minutes} ${units.m}`
  return `${total} ${units.s}`
}

// ── Raid timer ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RaidTimer {
  /** Real ms since the raid began. */
  elapsed: number
  /** Real ms left of the map's raid time; none when the map's time is not known. */
  left?: number
}

/** The running raid's time: since it began (the loading start when its beginning is not known yet). */
export function raidTimer(began: number, raidMinutes: number | undefined, now: number): RaidTimer {
  const elapsed = Math.max(0, now - began)
  return { elapsed, ...(raidMinutes && raidMinutes > 0 ? { left: raidMinutes * 60_000 - elapsed } : {}) }
}

/** The raid before: its map (the game's name), when it began and ended. */
export interface LastRaid { location?: string; began: number; ended: number }

const LAST_KEY = 'raidos-last-raid-v1'
const LAST_EVENT = 'raidos-last-raid-changed'

export function readLastRaid(): LastRaid | null {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as LastRaid | null
    return value && Number.isFinite(value.began) && Number.isFinite(value.ended) && value.ended > value.began ? value : null
  } catch {
    return null
  }
}

let lastCache: { raw: string | null; value: LastRaid | null } = { raw: null, value: null }
function lastSnapshot() {
  let raw: string | null = null
  try { raw = localStorage.getItem(LAST_KEY) } catch { /* storage unavailable */ }
  if (raw !== lastCache.raw) lastCache = { raw, value: readLastRaid() }
  return lastCache.value
}

export function rememberLastRaid(raid: LastRaid) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(raid)) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(LAST_EVENT))
}

function subscribeLast(listener: () => void) {
  window.addEventListener(LAST_EVENT, listener)
  return () => window.removeEventListener(LAST_EVENT, listener)
}

export function useLastRaid(): LastRaid | null {
  return useSyncExternalStore(subscribeLast, lastSnapshot, () => null)
}
