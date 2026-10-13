/**
 * The owner's notice over every app (owner, 13.10.2026: «окно уведомления сверху… появлятся у всех моментально, пока я
 * не отключу его… что ведутся технические работы»). The app waits on GET /v1/announcement?since=<version> (long polling,
 * server/src/routes/announcement.ts): the answer comes the moment the owner changes the notice, else after ~25 s and the
 * app asks again. Offline: a growing pause, the last notice stays on screen.
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

/** One loop per app: waits for the owner's changes as long as the app runs. */
async function follow() {
  let version: number | undefined
  let pause = 0
  for (;;) {
    try {
      const answer = parseAnnouncement(await request(version === undefined ? '/v1/announcement' : `/v1/announcement?since=${version}`))
      if (!answer) throw new Error('no answer')
      setAnnouncement(answer.announcement)
      version = answer.version
      pause = 0
    } catch {
      // Offline or an old server: try again a little later, longer each time (up to a minute).
      pause = Math.min(60_000, pause ? pause * 2 : 5_000)
      await new Promise((resolve) => setTimeout(resolve, pause))
    }
  }
}

/** The notice to show now (null: none). Starts waiting for it on first use. */
export function useAnnouncement() {
  useEffect(() => {
    if (running || typeof window === 'undefined' || (!window.tarkovDesktop?.serviceRequest && !usesWebAccount())) return
    running = true
    void follow()
  }, [])
  return useSyncExternalStore(subscribe, () => current, () => current)
}
