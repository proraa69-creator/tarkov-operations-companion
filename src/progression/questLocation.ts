import type { GameMap, Quest } from '../domain/types'

const ARENA_TRADER_ID = '6617beeaa9cfa777ca915b7c'
const RAID_ANY_OBJECTIVE = /(shoot|extract|plant|find|visit|mark|useitem)/i
const ARENA_COPY = /pvp\s*zone|арена|arena/i

/**
 * Does this quest belong on the map right now?
 * Story chapters only attach to the current stage's maps (talk-to-trader stages → nowhere).
 */
export function questAppliesToMap(quest: Quest, mapId: string, stageIndex?: number) {
  if (quest.kind === 'story' && quest.stages?.length) {
    const index = typeof stageIndex === 'number' && stageIndex >= 0 ? stageIndex : 0
    const stage = quest.stages[Math.min(index, quest.stages.length - 1)]
    if (!stage?.mapIds.length) return false
    return stage.mapIds.includes(mapId)
  }
  if (quest.anyMap) return true
  if (quest.mapIds?.length) return quest.mapIds.includes(mapId)
  return quest.mapId === mapId
}

export function mapsForQuest(quest: Quest, maps: GameMap[], stageIndex?: number) {
  if (quest.kind === 'story' && quest.stages?.length) {
    const index = typeof stageIndex === 'number' && stageIndex >= 0 ? stageIndex : 0
    const stage = quest.stages[Math.min(index, quest.stages.length - 1)]
    const ids = new Set(stage?.mapIds ?? [])
    return maps.filter((map) => ids.has(map.id))
  }
  if (quest.anyMap) return maps
  const ids = new Set([quest.mapId, ...(quest.mapIds ?? [])].filter((id): id is string => Boolean(id)))
  return maps.filter((map) => ids.has(map.id))
}

export function detectAnyMapQuest(input: {
  traderId?: string
  name: string
  normalizedName?: string
  objectives: Array<{ type?: string; description?: string }>
  mapIds: string[]
}) {
  if (input.mapIds.length) return false
  const blob = [input.name, input.normalizedName, ...input.objectives.map((objective) => objective.description ?? '')].join(' ')
  if (input.traderId === ARENA_TRADER_ID || ARENA_COPY.test(blob)) return false
  return input.objectives.some((objective) => RAID_ANY_OBJECTIVE.test(objective.type ?? ''))
}

/**
 * Every map a quest needs, the start map first, for the quest lists (owner, 15.10.2026: «Непарадный Тарков» was listed
 * under Streets of Tarkov only; it goes on to The Lab through the transit). More than `limit` maps: «… и ещё N».
 * Empty when the quest names no map.
 */
export function questMapsLabel(quest: Pick<Quest, 'mapId' | 'mapIds'>, maps: Array<Pick<GameMap, 'id' | 'name'>>, limit = 3) {
  const ids = [...new Set([quest.mapId, ...(quest.mapIds ?? [])].filter((id): id is string => Boolean(id)))]
  const names = ids.map((id) => maps.find((map) => map.id === id)?.name ?? id)
  return names.length > limit ? `${names.slice(0, limit).join(', ')} и ещё ${names.length - limit}` : names.join(', ')
}
