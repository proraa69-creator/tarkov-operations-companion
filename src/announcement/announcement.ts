/**
 * The owner's notice over every app (owner, 13.10.2026: «окно уведомления сверху… пока я не отключу его… что ведутся
 * технические работы»; «сделай просто разовое уведомление… с разбросом несколько минут что бы не было разовой
 * нагрузки»). The app asks GET /v1/announcement (server/src/routes/announcement.ts) once at start and then once every
 * 3–6 minutes, the moment drawn at random for each check, so the apps never ask all at once and no connection is held
 * open. Offline: the last notice stays on screen until the next answer.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { usesWebAccount } from '../sync/serverSync'
import { webServiceRequest } from '../sync/webAccount'

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

/** One loop per app: a single request now and then, as long as the app runs. `ask`, `sleep`, `random` for the tests. */
export async function followAnnouncement(ask: (path: string) => Promise<unknown> = request, sleep: (ms: number) => Promise<unknown> = wait, rounds = Infinity, random: () => number = Math.random) {
  for (let round = 0; round < rounds; round += 1) {
    try {
      const answer = parseAnnouncement(await ask('/v1/announcement'))
      if (answer) setAnnouncement(answer.announcement)
    } catch { /* offline or an older server: the last notice stays until the next check */ }
    await sleep(CHECK_MIN_MS + Math.floor(random() * CHECK_SPREAD_MS))
  }
}

/** The notice to show now (null: none). Starts waiting for it on first use. */
export function useAnnouncement() {
  useEffect(() => {
    if (running || typeof window === 'undefined' || (!window.tarkovDesktop?.serviceRequest && !usesWebAccount())) return
    running = true
    void followAnnouncement()
  }, [])
  return useSyncExternalStore(subscribe, () => current, () => current)
}
