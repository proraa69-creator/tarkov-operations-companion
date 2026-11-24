/**
 * What the player marked as found for the quests («+» / «−» on «Квесты» next to «Убежище»): item id → pieces, per profile
 * and mode (PvP, PvE and Season apart). A completed quest's items count by themselves (quests/questItemNeeds.ts); these
 * marks are the pieces put aside for the quests still to do. Kept in the account too (owner, 31.10.2026: the PC's scan
 * shows on the phone; items/itemCounts.ts), as the hideout's are.
 */
import type { RaidMode } from '../domain/types'
import { createItemCountStore } from '../items/itemCounts'

export const questFoundStore = createItemCountStore('quests', 'raidos-quest-found-v1:', 'raidos-quest-found-changed')

export function readQuestFound(profileId: string, mode: RaidMode): ReadonlyMap<string, number> {
  return questFoundStore.read(profileId, mode)
}

/** Sets the pieces found of one item (0 forgets it), never below 0 or above `max`. */
export function setQuestFound(profileId: string, mode: RaidMode, itemId: string, count: number, max = Number.MAX_SAFE_INTEGER) {
  const next = new Map(readQuestFound(profileId, mode))
  const value = Math.min(max, Math.max(0, Math.round(count)))
  if (value) next.set(itemId, value)
  else next.delete(itemId)
  questFoundStore.write(profileId, mode, next)
}

export function useQuestFound(profileId: string, mode: RaidMode) {
  return questFoundStore.useCounts(profileId, mode)
}
