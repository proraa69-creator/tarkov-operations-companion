/**
 * The owner's notice over every app (owner, 13.10.2026: «окно уведомления сверху… пока я не отключу его… что ведутся
 * технические работы»; «сделай просто разовое уведомление… с разбросом несколько минут что бы не было разовой
 * нагрузки»). The app asks GET /v1/announcement (server/src/routes/announcement.ts) once at start and then once every
 * 3–6 minutes, the moment drawn at random for each check, so the apps never ask all at once and no connection is held
 * open. Offline: the last notice stays on screen until the next answer.
 *
 * The same answer carries the owner's switches for every app (src/announcement/features.ts: the minimap, 14.10.2026).
 * So that a switch shows soon, the app also asks when its window gets the focus back and when the Mini Map page opens
 * (`checkAnnouncementNow`), never more often than FOCUS_GAP_MS for the focus.
 *
 * It also carries the owner's Overview for everybody («Админ панель» → «Блоки», `overview`,
 * src/overview/overviewDefaultsStore.ts): the default order, hidden blocks and the owner's headings.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { usesWebAccount } from '../sync/serverSync'
import { webServiceRequest } from '../sync/webAccount'
import { parseFeatures, sendRemoteFeaturesToMain, setRemoteFeatures } from './features'
import { parseOverviewAnswer, setOverviewDefaults } from '../overview/overviewDefaultsStore'

export interface AnnouncementView { text: string; updatedAt: string }

let current: AnnouncementView | null = null
let running = false
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The answer's notice, shape-checked (the server is trusted, the network is not). */
export function parseAnnouncement(value: unknown): { version?: number; announcement: AnnouncementView | null } | null {
  if (!value || typeof value !== 'object') return null
  const answer = value as { version?: unknown; announcement?: unknown }
  const version = typeof answer.version === 'number' && Number.isFinite(answer.version) ? answer.version : undefined
  const raw = answer.announcement as { text?: unknown; updatedAt?: unknown } | null | undefined
  const announcement = raw && typeof raw.text === 'string' && raw.text.trim() ? { text: raw.text.trim().slice(0, 500), updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '' } : null
  return { ...(version === undefined ? {} : { version }), announcement }
}

function request(path: string) {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.tarkovDesktop?.serviceRequest) return window.tarkovDesktop.serviceRequest('GET', path)
  return usesWebAccount() ? webServiceRequest('GET', path) : Promise.resolve(null)
}

/**
 * The notice in the reader's language. The owner writes it once in Russian and once in English, as paragraphs with an
 * empty line between them (13.10.2026); everyone gets the paragraphs of their interface language, so the phone shows
 * half the text. A notice in one language, or a paragraph in neither alphabet (emoji, numbers), is shown as written.
 */
export function announcementForLocale(text: string, locale: 'ru' | 'en') {
  const paragraphs = text.split(/\n[ \t]*\n+/).map((part) => part.trim()).filter(Boolean)
  const scripts = paragraphs.map((part) => {
    const cyrillic = part.match(/[Ѐ-ӿ]/g)?.length ?? 0
    const latin = part.match(/[a-z]/gi)?.length ?? 0
    return cyrillic > latin ? 'ru' : latin > cyrillic ? 'en' : null
  })
  if (!scripts.includes('ru') || !scripts.includes('en')) return text
  return paragraphs.filter((_, index) => scripts[index] === null || scripts[index] === locale).join('\n\n')
}

/** Shows `next` (another text or none) to the pages. */
export function setAnnouncement(next: AnnouncementView | null) {
  if (next?.text === current?.text && next?.updatedAt === current?.updatedAt) return
  current = next
  for (const listener of listeners) listener()
}

/** Between two checks: 3 minutes and a random part of 3 more, drawn anew each time. */
export const CHECK_MIN_MS = 3 * 60_000
export const CHECK_SPREAD_MS = 3 * 60_000

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Ask = (path: string) => Promise<unknown>

let lastCheckAt = 0
let inFlight: Promise<void> | null = null

/** One request: the notice and the owner's switches. Offline or an older server: what is shown stays. */
async function checkOnce(ask: Ask) {
  lastCheckAt = Date.now()
  try {
    const raw = await ask('/v1/announcement')
    const answer = parseAnnouncement(raw)
    if (answer) setAnnouncement(answer.announcement)
    const features = parseFeatures(raw)
    if (features) setRemoteFeatures(features)
    const overview = parseOverviewAnswer(raw)
    if (overview !== undefined) setOverviewDefaults(overview)
  } catch { /* offline or an older server: the last notice stays until the next check */ }
}

/** One loop per app: a single request now and then, as long as the app runs. `ask`, `sleep`, `random` for the tests. */
export async function followAnnouncement(ask: Ask = request, sleep: (ms: number) => Promise<unknown> = wait, rounds = Infinity, random: () => number = Math.random) {
  for (let round = 0; round < rounds; round += 1) {
    await checkOnce(ask)
    await sleep(CHECK_MIN_MS + Math.floor(random() * CHECK_SPREAD_MS))
  }
}

/** The window got the focus back: ask again, at most once in this long. */
export const FOCUS_GAP_MS = 30_000

/**
 * Asks now, between the loop's checks (the Mini Map page opens, the window gets the focus), unless a check ran less than
 * `minGapMs` ago or one is on the way. `ask` for the tests.
 */
export function checkAnnouncementNow(minGapMs = 2000, ask: Ask = request) {
  if (inFlight || Date.now() - lastCheckAt < minGapMs) return inFlight ?? Promise.resolve()
  if (ask === request && (typeof window === 'undefined' || (!window.tarkovDesktop?.serviceRequest && !usesWebAccount()))) return Promise.resolve()
  inFlight = checkOnce(ask).finally(() => { inFlight = null })
  return inFlight
}

/** The notice to show now (null: none). Starts waiting for it on first use. */
export function useAnnouncement() {
  useEffect(() => {
    if (running || typeof window === 'undefined' || (!window.tarkovDesktop?.serviceRequest && !usesWebAccount())) return
    running = true
    // The main process starts with the minimap off: the last known switch until the server answers.
    sendRemoteFeaturesToMain()
    window.addEventListener('focus', () => { void checkAnnouncementNow(FOCUS_GAP_MS) })
    void followAnnouncement()
  }, [])
  return useSyncExternalStore(subscribe, () => current, () => current)
}
