/**
 * «Отряд»: what several squad members can do together in one raid. Pure functions, shared by the API server
 * (server/src/routes/squads.ts, when its catalog is loaded) and the app (when the server answered without a catalog).
 * Works on one mode at a time: the caller passes only that mode's active quests.
 */
import type { Quest } from '../domain/types'

export const SQUAD_MAX_MEMBERS = 5

export interface SquadMemberQuests { memberId: string; activeQuestIds: string[] }
export interface SquadQuestEntry { questId: string; memberIds: string[] }
export interface SquadMapEntry { mapId: string; quests: SquadQuestEntry[]; sharedCount: number }
export interface SquadItemEntry { itemId: string; total: number; members: Array<{ memberId: string; count: number }>; questIds: string[] }

export interface SquadComputed {
  /** Quests active for two or more members (no catalog needed). */
  sharedQuests: SquadQuestEntry[]
  /** Per map: every active quest of any member that is done on that map; maps with shared quests first. */
  maps: SquadMapEntry[]
  /** Quests that can be done on any map, with the members who have them. */
  anyMap: SquadQuestEntry[]
  /** Items that two or more members need for their active quests. */
  items: SquadItemEntry[]
}

const byShared = (a: SquadQuestEntry, b: SquadQuestEntry) => b.memberIds.length - a.memberIds.length || a.questId.localeCompare(b.questId)

/** Members per active quest, in member order. */
function questMembers(members: SquadMemberQuests[]) {
  const result = new Map<string, string[]>()
  for (const member of members) {
    for (const questId of new Set(member.activeQuestIds)) {
      const list = result.get(questId) ?? []
      list.push(member.memberId)
      result.set(questId, list)
    }
  }
  return result
}

export function sharedQuestsOf(members: SquadMemberQuests[]): SquadQuestEntry[] {
  return [...questMembers(members)].filter(([, ids]) => ids.length >= 2).map(([questId, memberIds]) => ({ questId, memberIds })).sort(byShared)
}

/** Every map a quest can take the player to (all story stages: the other members' stage is not known). */
export function questMapIdsForSquad(quest: Quest) {
  const ids = new Set<string>()
  if (quest.mapId) ids.add(quest.mapId)
  for (const id of quest.mapIds ?? []) ids.add(id)
  for (const stage of quest.stages ?? []) for (const id of stage.mapIds) ids.add(id)
  return [...ids]
}

/** Items one quest needs: raid requirements (summed per item) plus plain required items (one each). */
export function questItemNeeds(quest: Quest) {
  const counts = new Map<string, number>()
  for (const requirement of quest.raidRequirements ?? []) {
    if (!requirement.itemId) continue
    counts.set(requirement.itemId, (counts.get(requirement.itemId) ?? 0) + Math.max(1, requirement.count || 1))
  }
  for (const id of quest.requiredItems ?? []) if (!counts.has(id)) counts.set(id, 1)
  return counts
}

export function computeSquadOverview(members: SquadMemberQuests[], quests: Quest[]): SquadComputed {
  const questsById = new Map(quests.map((quest) => [quest.id, quest]))
  const perQuest = questMembers(members)
  const maps = new Map<string, SquadQuestEntry[]>()
  const anyMap: SquadQuestEntry[] = []
  for (const [questId, memberIds] of perQuest) {
    const quest = questsById.get(questId)
    if (!quest) continue
    const entry = { questId, memberIds }
    if (quest.anyMap) { anyMap.push(entry); continue }
    for (const mapId of questMapIdsForSquad(quest)) {
      const list = maps.get(mapId) ?? []
      list.push(entry)
      maps.set(mapId, list)
    }
  }
  const mapEntries = [...maps].map(([mapId, list]) => ({ mapId, quests: list.sort(byShared), sharedCount: list.filter((entry) => entry.memberIds.length >= 2).length }))
    .sort((a, b) => b.sharedCount - a.sharedCount || b.quests.length - a.quests.length || a.mapId.localeCompare(b.mapId))

  const items = new Map<string, { perMember: Map<string, number>; questIds: Set<string> }>()
  for (const member of members) {
    for (const questId of new Set(member.activeQuestIds)) {
      const quest = questsById.get(questId)
      if (!quest) continue
      for (const [itemId, count] of questItemNeeds(quest)) {
        const entry = items.get(itemId) ?? { perMember: new Map<string, number>(), questIds: new Set<string>() }
        entry.perMember.set(member.memberId, (entry.perMember.get(member.memberId) ?? 0) + count)
        entry.questIds.add(questId)
        items.set(itemId, entry)
      }
    }
  }
  const itemEntries = [...items].filter(([, entry]) => entry.perMember.size >= 2).map(([itemId, entry]) => {
    const list = [...entry.perMember].map(([memberId, count]) => ({ memberId, count }))
    return { itemId, total: list.reduce((sum, row) => sum + row.count, 0), members: list, questIds: [...entry.questIds] }
  }).sort((a, b) => b.members.length - a.members.length || b.total - a.total || a.itemId.localeCompare(b.itemId))

  return { sharedQuests: sharedQuestsOf(members), maps: mapEntries, anyMap: anyMap.sort(byShared), items: itemEntries }
}
