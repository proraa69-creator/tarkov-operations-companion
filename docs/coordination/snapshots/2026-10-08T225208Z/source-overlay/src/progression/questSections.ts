import type { ModeProgress, Quest } from '../domain/types'
import { isCurrentTrackedQuest, isLiveGameQuest, isStoryQuest } from './requirementEngine'

export function belongsInQuestSection(quest: Quest, progress: ModeProgress, section: string, status: string = '') {
  if (isStoryQuest(quest)) {
    const record = progress.taskProgress[quest.id]
    const stage = record?.currentStageIndex
    const knownStage = stage != null && Number.isInteger(stage) && stage >= 0 && (!quest.stages?.length || stage < quest.stages.length)
    // A chapter the player has: its stage is known, or its objectives were read from the game's pane (wording the
    // catalog does not know yet). Chapters never seen in the game stay hidden.
    return section === 'story' && isCurrentTrackedQuest(quest, progress) && (knownStage || Boolean(record?.storyObjectives?.length))
  }
  if (!isLiveGameQuest(quest) || section === 'story') return false
  if (section === 'active') return isCurrentTrackedQuest(quest, progress)
  if (section === 'all') return true
  return section === 'kappa' ? quest.kappa : status === section
}
