import type { ModeProgress, Quest } from '../domain/types'
import { isCurrentTrackedQuest, isLiveGameQuest, isStoryQuest } from './requirementEngine'

export function belongsInQuestSection(quest: Quest, progress: ModeProgress, section: string, status: string = '') {
  if (isStoryQuest(quest)) {
    const stage = progress.taskProgress[quest.id]?.currentStageIndex
    return section === 'story' && isCurrentTrackedQuest(quest, progress) && stage != null
      && Number.isInteger(stage) && stage >= 0 && (!quest.stages?.length || stage < quest.stages.length)
  }
  if (!isLiveGameQuest(quest) || section === 'story') return false
  if (section === 'active') return isCurrentTrackedQuest(quest, progress)
  if (section === 'all') return true
  return section === 'kappa' ? quest.kappa : status === section
}
