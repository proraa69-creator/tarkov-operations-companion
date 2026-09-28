import type { ModeProgress, Quest } from '../domain/types'
import { matchQuestsFromOcr } from './questOcr'
import { isTasksMenuText } from './screenScanSync'

export interface StoryScanMatch {
  questId: string
  stageIndex?: number
}

/** The story tab / chapter pane of the Tasks menu is on screen. */
export function isStoryMenuText(text: string) {
  if (!isTasksMenuText(text)) return false
  return /сюжетн|истори|тори[яи]|главн(?:ые|ая)\s*задач|(?<![а-яё])[а-яё]{0,4}ные\s*задачи|иональн[а-яё]*\s*задачи/i.test(text)
}

/** Story chapters named on a story-menu frame; trader quests are left to the game logs. */
export function matchStoryChapters(text: string, quests: Quest[]): StoryScanMatch[] {
  if (!isStoryMenuText(text)) return []
  const story = quests.filter((quest) => quest.kind === 'story')
  return matchQuestsFromOcr(text, story)
    .filter((match) => story.some((quest) => quest.id === match.questId))
    .map(({ questId, stageIndex }) => ({ questId, stageIndex }))
}

/**
 * A chapter seen on the story pane is the one being played, at the stage the pane shows.
 * Chapters already finished stay finished — the pane can show any chapter the player clicks.
 */
export function applyStoryScan(progress: ModeProgress, matches: StoryScanMatch[], now = new Date().toISOString()): ModeProgress {
  let taskProgress = progress.taskProgress
  for (const match of matches) {
    const current = taskProgress[match.questId]
    if (current?.status === 'completed') continue
    const stageIndex = match.stageIndex ?? current?.currentStageIndex
    if (current?.status === 'active' && current.currentStageIndex === stageIndex) continue
    taskProgress = {
      ...taskProgress,
      [match.questId]: { taskId: match.questId, status: 'active', source: 'screen-scan', updatedAt: now, currentStageIndex: stageIndex },
    }
  }
  return taskProgress === progress.taskProgress ? progress : { ...progress, taskProgress }
}
