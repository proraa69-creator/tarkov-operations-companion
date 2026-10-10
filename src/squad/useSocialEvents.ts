/**
 * «Моментально» (owner, 10.10.2026): friend requests and their answers, squad invitations, joining and leaving, and a
 * squad mate's handed-in quest reach this app at once. The app waits on GET /v1/me/social-events (long polling,
 * server/src/services/socialSignals.ts) and reloads its friends and squad whenever the server says something changed.
 * The badge on «Отряд» counts incoming friend requests and squad invitations.
 */
import { useEffect } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { watchVersion } from '../data/mapUpdates'
import type { RaidMode } from '../domain/types'
import { useServerAccount } from '../sync/serverSync'
import { loadFriends, resetFriends, useFriends } from './useFriends'
import { invalidateSquads, loadSquad, useSquad } from './useSquad'

export const SOCIAL_EVENTS_PATH = '/v1/me/social-events'
/** Window event after every social change: pages with their own copies (friends' progress) re-read them. */
export const SOCIAL_UPDATE_EVENT = 'raidos:social-update'

export function useSocialEvents(mode: RaidMode) {
  const { status } = useServerAccount()
  const account = status?.signedIn ? status.email ?? 'signed-in' : ''
  useEffect(() => {
    if (!account) { resetFriends(); return }
    const request = serviceClient()
    if (!request) return
    const stop = new AbortController()
    void watchVersion(request, SOCIAL_EVENTS_PATH, () => {
      invalidateSquads()
      void loadSquad(mode)
      void loadFriends()
      window.dispatchEvent(new Event(SOCIAL_UPDATE_EVENT))
    }, stop.signal)
    return () => stop.abort()
  }, [account, mode])
}

/** Incoming friend requests plus squad invitations: the number on the «Отряд» button. */
export function useSocialBadge(mode: RaidMode) {
  const friends = useFriends()
  const squad = useSquad(mode, { poll: false, maxAgeMs: 120_000 })
  if (!friends.signedIn) return 0
  return (friends.overview?.incoming.length ?? 0) + (squad.mine?.invitations.length ?? 0)
}
