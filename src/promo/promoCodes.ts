import { useSyncExternalStore } from 'react'
import { SOCIAL_UPDATE_EVENT } from '../squad/useSocialEvents'
import { usesWebAccount } from '../sync/serverSync'
import { webServiceRequest } from '../sync/webAccount'

/**
 * «Промокоды» (owner, 06.11.2026): the codes the server found (server/src/services/promoCodes.ts). The list is asked for at start,
 * every half hour and at once when the server says something changed. What has been seen is kept on this device: opening the
 * window reads everything, with no button. The first batch the server ever found is no news.
 */
export interface PromoCode { code: string; mode?: 'pvp' | 'pve' | 'season'; addedAt: string; first?: boolean }

const READ_KEY = 'raidos-promo-read-v1'
const EVENT = 'raidos-promo-changed'
const REFRESH_MS = 30 * 60 * 1000
const NOTHING: readonly PromoCode[] = []

export function parsePromoCodes(answer: unknown): PromoCode[] | null {
  if (!answer || typeof answer !== 'object' || !Array.isArray((answer as { codes?: unknown }).codes)) return null
  return ((answer as { codes: unknown[] }).codes).flatMap((row): PromoCode[] => {
    if (!row || typeof row !== 'object') return []
    const { code, mode, addedAt, first } = row as Record<string, unknown>
    if (typeof code !== 'string' || !code || typeof addedAt !== 'string') return []
    return [{ code, addedAt, ...(mode === 'pvp' || mode === 'pve' || mode === 'season' ? { mode } : {}), ...(first === true ? { first: true } : {}) }]
  })
}

function request() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.tarkovDesktop?.serviceRequest) return window.tarkovDesktop.serviceRequest('GET', '/v1/promo-codes')
  return usesWebAccount() ? webServiceRequest('GET', '/v1/promo-codes') : Promise.resolve(null)
}

let codes: readonly PromoCode[] = NOTHING
let started = false

function notify() {
  window.dispatchEvent(new Event(EVENT))
}

async function refresh() {
  try {
    const next = parsePromoCodes(await request())
    if (next && JSON.stringify(next) !== JSON.stringify(codes)) {
      codes = next
      notify()
    }
  } catch { /* offline: the last list stays */ }
}

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  void refresh()
  setInterval(() => void refresh(), REFRESH_MS)
  window.addEventListener(SOCIAL_UPDATE_EVENT, () => void refresh())
}

let cachedRaw: string | null | undefined
let cachedRead: ReadonlySet<string> = new Set()

function readSet(): ReadonlySet<string> {
  let raw: string | null = null
  try { raw = localStorage.getItem(READ_KEY) } catch { /* storage unavailable */ }
  if (raw === cachedRaw) return cachedRead
  cachedRaw = raw
  let list: string[] = []
  try {
    const stored: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(stored)) list = stored.filter((entry): entry is string => typeof entry === 'string')
  } catch { /* a damaged value reads as nothing seen */ }
  cachedRead = new Set(list)
  return cachedRead
}

/** The codes not seen yet on this device. */
export function unreadPromoCodes(list: readonly PromoCode[], read: ReadonlySet<string>) {
  return list.filter((row) => !row.first && !read.has(row.code))
}

/** The window opened: everything listed counts as seen. */
export function markPromoCodesRead(list: readonly PromoCode[]) {
  try { localStorage.setItem(READ_KEY, JSON.stringify([...new Set([...readSet(), ...list.map((row) => row.code)])])) } catch { /* storage unavailable */ }
  notify()
}

function subscribe(listener: () => void) {
  start()
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

export function usePromoCodes() {
  return useSyncExternalStore(subscribe, () => codes, () => NOTHING)
}

export function usePromoRead() {
  return useSyncExternalStore(subscribe, readSet, readSet)
}
