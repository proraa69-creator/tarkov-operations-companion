/**
 * Mounted once (AppShell): the player's own lists on every device of the account (src/sync/playerState.ts). A store's change goes out
 * in a moment; the wait on the live channel brings the others' (squad/useSocialEvents.ts); the round every 30 s is what still gets
 * there if that channel is cut; a phone going to the background sends what waits, and back in front it asks at once.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { LocalProfile } from '../domain/types'
import { configurePlayerState, flushPlayerState, forgetPlayerStateSync, playerStateTick, schedulePlayerStateSync, setPlayerStateAccount, syncPlayerState } from './playerState'
import { noteProfileLists, PLAYER_STATE_ADAPTERS, profileListsOf, setPlayerStateProfile, watchPlayerStateStores, type PlayerListsChange } from './playerStateStores'
import { accountIdentity, playerStateRequest, STATUS_REFRESH_MS, useServerStatus } from './serverSync'

export function usePlayerStateSync(profile: LocalProfile, applyLists: (change: PlayerListsChange) => void) {
  const status = useServerStatus()
  const applyRef = useRef(applyLists)
  useEffect(() => { applyRef.current = applyLists })
  const account = accountIdentity(status)
  const key = account ? `${account}|${profile.id}` : null
  const signedOut = status !== null && !status.signedIn
  const online = status?.online === true

  const { pvp, pve, seasonal } = profile.modes
  const favorites = profile.modes[profile.selectedMode].favoriteItemIds
  // Only what these lists are made of: the rest of the profile changes all the time and is none of this.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lists = useMemo(() => profileListsOf(profile), [
    favorites,
    pvp.raidItemIds, pvp.hideoutLevels, pvp.itemCounts, pvp.storyManual,
    pve.raidItemIds, pve.hideoutLevels, pve.itemCounts, pve.storyManual,
    seasonal.raidItemIds, seasonal.hideoutLevels, seasonal.itemCounts, seasonal.storyManual,
    profile.id,
  ])

  useEffect(() => {
    configurePlayerState({ adapters: PLAYER_STATE_ADAPTERS, transport: playerStateRequest })
  }, [])

  useEffect(() => { setPlayerStateProfile(profile.id) }, [profile.id])
  useEffect(() => { noteProfileLists(lists, (change) => applyRef.current(change)) }, [lists])

  useEffect(() => {
    // Told by the server that nobody is signed in: the next sign-in starts as a first look. No answer yet, or an account the status
    // cannot name (offline): nothing changes.
    if (signedOut) { setPlayerStateAccount(null); forgetPlayerStateSync(); return }
    if (!key) return
    setPlayerStateAccount(key, online)
    void syncPlayerState({ pull: online })
  }, [key, online, signedOut])

  useEffect(() => {
    const changed = () => schedulePlayerStateSync()
    const off = watchPlayerStateStores(changed)
    const round = window.setInterval(() => { void playerStateTick() }, STATUS_REFRESH_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushPlayerState()
      else void syncPlayerState({ pull: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      off()
      window.clearInterval(round)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}
