/**
 * The in-raid «MATE» badge: which items friends or squad mates need for a current quest, per mode. Only a set of item
 * ids is kept — never who needs it or for what (the overlay shows a bare badge). Refreshed every few minutes, when the
 * mode changes and when a raid starts; looked up synchronously when the item overlay asks.
 */
import { useEffect, useRef } from 'react'
import type { Quest, RaidMode } from '../domain/types'
import { fetchFriendNeeds } from './socialClient'
import { itemIdsNeededBy } from './squadOverview'

export const MATE_REFRESH_MS = 5 * 60_000
const cache = new Map<RaidMode, Set<string>>()

export function mateNeedsItem(mode: RaidMode, itemId: string) {
  return cache.get(mode)?.has(itemId) ?? false
}

/** For tests and sign-out. */
export function setMateNeeds(mode: RaidMode, itemIds: Iterable<string> | null) {
  if (itemIds === null) cache.delete(mode)
  else cache.set(mode, new Set(itemIds))
}

export async function refreshMateNeeds(mode: RaidMode, quests: Quest[]) {
  try {
    const answer = await fetchFriendNeeds(mode)
    // Without a server catalog the answer has only quest ids: the app's own catalog turns them into items.
    setMateNeeds(mode, answer.itemIds ?? itemIdsNeededBy([{ memberId: 'friends', activeQuestIds: answer.questIds }], quests))
  } catch {
    // Signed out, no subscription or offline: no badge rather than a stale one from another account.
    setMateNeeds(mode, null)
  }
}

/** Mounted once in the desktop shell (ExperimentalBridge). */
export function useMateNeedsRefresh(mode: RaidMode, quests: Quest[]) {
  const latest = useRef({ mode, quests })
  useEffect(() => { latest.current = { mode, quests } })
  useEffect(() => {
    if (!quests.length) return
    void refreshMateNeeds(mode, quests)
    const timer = window.setInterval(() => void refreshMateNeeds(latest.current.mode, latest.current.quests), MATE_REFRESH_MS)
    return () => window.clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, quests.length > 0])
  useEffect(() => {
    const desktop = window.tarkovDesktop
    if (!desktop?.onRaidStateChanged) return
    let inRaid = false
    return desktop.onRaidStateChanged((next) => {
      if (next.inRaid && !inRaid) void refreshMateNeeds(latest.current.mode, latest.current.quests)
      inRaid = next.inRaid
    })
  }, [])
}
