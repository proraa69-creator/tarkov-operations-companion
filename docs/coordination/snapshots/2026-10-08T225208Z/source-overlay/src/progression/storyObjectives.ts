import type { ModeProgress, Quest, StoryObjectiveReading } from '../domain/types'
import { cleanSavedStoryObjective } from '../import/storyObjectives'

/**
 * Sanitizes older/synced profiles without inventing objectives from a saved stage number; text saved with OCR junk
 * («= [1] …», «… №8», «1/5» for 1/3) is cleaned the way a fresh reading is.
 */
export function visibleStoryObjectives(quest: Quest, progress: ModeProgress): StoryObjectiveReading[] {
  const snapshot = progress.taskProgress[quest.id]?.storyObjectives
  if (!Array.isArray(snapshot)) return []
  return snapshot.slice(0, 40).filter(objective => objective && typeof objective.text === 'string'
    && objective.text.length > 0 && objective.text.length <= 600 && typeof objective.id === 'string')
    .map(objective => cleanSavedStoryObjective({ ...objective, stageIndex: Number.isInteger(objective.stageIndex)
      && objective.stageIndex! >= 0 && objective.stageIndex! < (quest.stages?.length ?? 0) ? objective.stageIndex : undefined }, quest))
}

export function storyObjectiveMapLinks(quest: Quest, objective: StoryObjectiveReading) {
  if (objective.completed || objective.stageIndex == null) return []
  return [...new Set(quest.stages?.[objective.stageIndex]?.mapIds ?? [])].map(mapId => ({
    mapId, to: `/maps/${encodeURIComponent(mapId)}?quest=${encodeURIComponent(quest.id)}&stage=${objective.stageIndex}`,
  }))
}
