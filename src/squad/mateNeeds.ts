/**
 * The in-raid badge on the item card: which items friends or squad mates need for a current quest, per mode, and who
 * (their Tarkov nicknames — owner, 10.10.2026: «вместо MATE ник того, кому нужен предмет»; an older server sends no
 * names, then the badge says «MATE»). Refreshed every few minutes, when the mode changes, when a raid starts and when a
 * friend's or squad mate's quests change (squad/useSocialEvents.ts); looked up synchronously when the overlay asks.
 */
import { useEffect, useRef } from 'react'
import type { Quest, RaidMode } from '../domain/types'
import { fetchFriendNeeds } from './socialClient'
import { itemIdsNeededBy } from './squadOverview'
import { SOCIAL_UPDATE_EVENT } from './useSocialEvents'

export const MATE_REFRESH_MS = 5 * 60_000
/** Item id → nicknames of who needs it ([] = somebody, no names from this server). */
const cache = new Map<RaidMode, Map<string, string[]>>()

export function mateNeedsItem(mode: RaidMode, itemId: string) {
  return cache.get(mode)?.has(itemId) ?? false
}

/** Who needs the item (nicknames; [] when the server sent none), or null when nobody does. */
export function mateNamesFor(mode: RaidMode, itemId: string): string[] | null {
  return cache.get(mode)?.get(itemId) ?? null
}

/** For tests and sign-out: bare ids (no names) or id → nicknames. */
export function setMateNeeds(mode: RaidMode, items: Iterable<string> | Map<string, string[]> | null) {
  if (items === null) cache.delete(mode)
  else cache.set(mode, items instanceof Map ? items : new Map([...items].map((id) => [id, []])))
}

/** Who needs which item: the server's names per item, or (no server catalog) per quest through the app's catalog. */
export function namesPerItem(answer: Awaited<ReturnType<typeof fetchFriendNeeds>>, quests: Quest[]) {
  const out = new Map<string, string[]>()
  const add = (itemId: string, names: string[]) => { const list = out.get(itemId) ?? []; for (const name of names) if (!list.includes(name)) list.push(name); out.set(itemId, list) }
  if (answer.itemIds) {
    for (const itemId of answer.itemIds) add(itemId, answer.byItem?.[itemId] ?? [])
    return out
  }
  for (const questId of answer.questIds) {
    for (const itemId of itemIdsNeededBy([{ memberId: 'friends', activeQuestIds: [questId] }], quests)) add(itemId, answer.byQuest?.[questId] ?? [])
  }
  return out
}

export async function refreshMateNeeds(mode: RaidMode, quests: Quest[]) {
  try {
    setMateNeeds(mode, namesPerItem(await fetchFriendNeeds(mode), quests))
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
  // A friend's or squad mate's quests changed (squad/useSocialEvents.ts): the names on the card follow at once.
  useEffect(() => {
    const refresh = () => void refreshMateNeeds(latest.current.mode, latest.current.quests)
    window.addEventListener(SOCIAL_UPDATE_EVENT, refresh)
    return () => window.removeEventListener(SOCIAL_UPDATE_EVENT, refresh)
  }, [])
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
