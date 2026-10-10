/**
 * Friends of the signed-in account (friends, incoming and outgoing requests), shared by the «Отряд» page and the
 * request badge on the «Отряд» button: one cached copy, reloaded on demand, on every social event
 * (squad/useSocialEvents.ts) and every two minutes as a fallback.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useServerAccount } from '../sync/serverSync'
import { fetchFriends, SignedOutError, type FriendsOverview } from './socialClient'

export const FRIENDS_REFRESH_MS = 120_000

export interface FriendsState { overview: FriendsOverview | null; loading: boolean; error: string; loadedAt: number }
const EMPTY: FriendsState = { overview: null, loading: false, error: '', loadedAt: 0 }

let state: FriendsState = EMPTY
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()
const set = (next: Partial<FriendsState>) => { state = { ...state, ...next }; for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function loadFriends(): Promise<void> {
  if (inflight) return inflight
  set({ loading: true })
  inflight = (async () => {
    try {
      set({ overview: await fetchFriends(), loading: false, error: '', loadedAt: Date.now() })
    } catch (error) {
      if (error instanceof SignedOutError) set({ ...EMPTY, loadedAt: Date.now() })
      else set({ loading: false, error: error instanceof Error ? error.message : String(error), loadedAt: Date.now() })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** The account changed (signed out, another account): forget the old friends. */
export function resetFriends() { set(EMPTY) }

export function useFriends({ poll = true }: { poll?: boolean } = {}) {
  const current = useSyncExternalStore(subscribe, () => state, () => EMPTY)
  const { status } = useServerAccount()
  const signedIn = Boolean(status?.signedIn)
  const reload = useCallback(() => loadFriends(), [])
  useEffect(() => {
    if (!signedIn) return
    if (Date.now() - state.loadedAt > FRIENDS_REFRESH_MS) void loadFriends()
    if (!poll) return
    const timer = window.setInterval(() => void loadFriends(), FRIENDS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [signedIn, poll])
  return { ...current, signedIn, reload }
}
