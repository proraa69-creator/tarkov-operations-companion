import type { ModeProgress, Quest, StoryObjectiveReading } from '../domain/types'

/** Sanitizes older/synced profiles without inventing objectives from a saved stage number. */
export function visibleStoryObjectives(quest: Quest, progress: ModeProgress): StoryObjectiveReading[] {
  const snapshot = progress.taskProgress[quest.id]?.storyObjectives
  if (!Array.isArray(snapshot)) return []
  return snapshot.slice(0, 40).filter(objective => objective && typeof objective.text === 'string'
    && objective.text.length > 0 && objective.text.length <= 600 && typeof objective.id === 'string')
    .map(objective => ({ ...objective, stageIndex: Number.isInteger(objective.stageIndex)
      && objective.stageIndex! >= 0 && objective.stageIndex! < (quest.stages?.length ?? 0) ? objective.stageIndex : undefined }))
}

export function storyObjectiveMapLinks(quest: Quest, objective: StoryObjectiveReading) {
  if (objective.completed || objective.stageIndex == null) return []
  return [...new Set(quest.stages?.[objective.stageIndex]?.mapIds ?? [])].map(mapId => ({
    mapId, to: `/maps/${encodeURIComponent(mapId)}?quest=${encodeURIComponent(quest.id)}&stage=${objective.stageIndex}`,
  }))
}
