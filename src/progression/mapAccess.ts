import type { GameMap, Quest } from '../domain/types'
import type { TaskAvailability } from './requirementEngine'

const VERIFIED_MAP_UNLOCKS: Record<string, string> = {
  icebreaker: 'stick-to-it',
}

export interface MapAccessState {
  locked: boolean
  quest?: Quest
}

export function calculateMapAccess(map: GameMap, quests: Quest[], availability: Map<string, TaskAvailability>): MapAccessState {
  const normalizedQuestName = VERIFIED_MAP_UNLOCKS[map.id]
  if (!normalizedQuestName) return { locked: false }
  const quest = quests.find((entry) => entry.normalizedName === normalizedQuestName)
  if (!quest) return { locked: false }
  return { locked: availability.get(quest.id)?.status !== 'completed', quest }
}
