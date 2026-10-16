import { useEffect, useSyncExternalStore } from 'react'
import { isOwnerApp } from '../app/buildEdition'
import { useServerStatus } from '../sync/serverSync'

/**
 * Who may open «Админ панель» (owner, 16.10.2026): the owner's app (the build edition, src/app/buildEdition.ts) signed in
 * to the owner's account. The account is checked once per sign-in with an owner-only route the panel reads anyway
 * (GET /v1/accounts/me/admin/features: 404 for everybody but the owner, server/src/routes/announcement.ts).
 *
 * - 'owner': the owner's account answered;
 * - 'not-owner': signed in to another account (the sidebar hides the panel);
 * - 'signed-out': no session (the panel asks to sign in on «Профиль»);
 * - 'offline': no answer (the panel shows what it can and tries again on the next sign-in or start);
 * - 'unknown': still asking.
 */
export type OwnerAccess = 'unknown' | 'owner' | 'not-owner' | 'signed-out' | 'offline'

export const OWNER_PROBE_PATH = '/v1/accounts/me/admin/features'
const SIGN_IN = 'Войдите в аккаунт владельца в профиле'

/** One owner call (the desktop gateway's methods; «Объявления» / «Опросы» use the GET / POST part). */
export type AdminRequest = (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<unknown>

/** The owner's calls through the desktop app's gateway (undefined outside the PC app). No session: an error to show. */
export function ownerRequest(): AdminRequest | undefined {
  const serviceRequest = typeof window === 'undefined' ? undefined : window.tarkovDesktop?.serviceRequest
  if (!serviceRequest) return undefined
  return async (method, path, body) => {
    const answer = await serviceRequest(method, path, body)
    if (answer === null) throw new Error(SIGN_IN)
    return answer
  }
}

/** A gateway error that means «not the owner» (the server's 404 for the owner routes). */
export const notOwnerError = (reason: unknown) => /Не найдено|Not found|404/i.test(reason instanceof Error ? reason.message : String(reason))

let state: { key: string; access: OwnerAccess } = { key: '', access: 'unknown' }
let asking = ''
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const set = (key: string, access: OwnerAccess) => {
  state = { key, access }
  for (const listener of listeners) listener()
}

async function probe(key: string) {
  const request = ownerRequest()
  if (!request) { set(key, 'signed-out'); return }
  asking = key
  try {
    await request('GET', OWNER_PROBE_PATH)
    set(key, 'owner')
  } catch (reason) {
    const text = reason instanceof Error ? reason.message : String(reason)
    set(key, notOwnerError(reason) ? 'not-owner' : text.includes(SIGN_IN) || /Требуется вход/.test(text) ? 'signed-out' : 'offline')
  } finally {
    if (asking === key) asking = ''
  }
}

/** The owner app's access to «Админ панель»; 'not-owner' everywhere else (players never ask). */
export function useOwnerAccess(): OwnerAccess {
  const owner = isOwnerApp()
  const status = useServerStatus()
  const key = owner && status?.signedIn ? `in:${status.email ?? ''}:${status.serverUrl ?? ''}` : owner && status ? 'out' : ''
  useEffect(() => {
    if (!owner || !key) return
    if (key === 'out') { if (state.key !== key) set(key, 'signed-out'); return }
    if (state.key === key && state.access !== 'offline') return
    if (asking === key) return
    void probe(key)
  }, [owner, key])
  const current = useSyncExternalStore(subscribe, () => state, () => state)
  if (!owner) return 'not-owner'
  return key && current.key === key ? current.access : 'unknown'
}

/** For the tests: forget what was learnt. */
export function resetOwnerAccessForTests() {
  asking = ''
  set('', 'unknown')
}
