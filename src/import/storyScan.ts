import type { ModeProgress, Quest, StoryObjectiveReading } from '../domain/types'
import { matchQuestsFromOcr } from './questOcr'
import { isTasksMenuText } from './screenScanSync'
import { completedStoryStageIndexes, hasExactStoryStageEvidence } from './storyStageOcr'
import { readStoryObjectives } from './storyObjectives'

export interface StoryScanMatch {
  questId: string
  stageIndex?: number
  completedStageIndexes?: number[]
  stageConfirmed?: boolean
  objectives?: StoryObjectiveReading[]
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
  const matches = matchQuestsFromOcr(text, story)
    .filter((match) => story.some((quest) => quest.id === match.questId))
    .map(({ questId, stageIndex }) => {
      const quest = story.find((entry) => entry.id === questId)!
      const exactEvidence = stageIndex != null && hasExactStoryStageEvidence(text, quest, stageIndex)
      const completedStageIndexes = completedStoryStageIndexes(text, quest)
      return {
        questId,
        // Loose word overlap can identify a chapter, but cannot change its saved stage.
        stageIndex: exactEvidence ? stageIndex : undefined,
        ...(exactEvidence ? { objectives: readStoryObjectives(text, quest) } : {}),
        ...(completedStageIndexes.length ? { completedStageIndexes } : {}),
      }
    })
  // A frame has one open objective pane. Shared wording must not advance two chapters.
  return matches.filter(match => match.stageIndex != null).length > 1
    ? matches.map(({ questId }) => ({ questId })) : matches
}

/**
 * A chapter seen on the story pane is the one being played, at the stage the pane shows.
 * Chapters already finished stay finished — the pane can show any chapter the player clicks.
 */
export function applyStoryScan(progress: ModeProgress, matches: StoryScanMatch[], now = new Date().toISOString()): ModeProgress {
  let taskProgress = progress.taskProgress
  for (const match of matches) {
    // A sidebar can list locked chapters too; its title alone is not an active account quest.
    if (match.stageIndex == null) continue
    const current = taskProgress[match.questId]
    if (current?.status === 'completed') continue
    let stageIndex = match.stageIndex ?? current?.currentStageIndex
    if (match.stageIndex != null && (!Number.isInteger(match.stageIndex) || match.stageIndex < 0)) continue
    const savedStage = current?.currentStageIndex
    if (savedStage != null && stageIndex != null && stageIndex > savedStage) {
      const completed = new Set(match.completedStageIndexes ?? [])
      // A newly opened adjacent objective may hide the previous one. Two independent, exact
      // readings can confirm that single transition; larger jumps need every skipped stage.
      let verified = true
      for (let index = savedStage; index < stageIndex; index += 1) if (!completed.has(index)) verified = false
      if (!verified && !(stageIndex === savedStage + 1 && match.stageConfirmed)) {
        if (!match.objectives?.length) continue
        // Visible objectives are a snapshot, not proof that every earlier stage was completed.
        stageIndex = savedStage
      }
    }
    if (current && current.updatedAt > now) continue
    const objectives = match.objectives?.length ? match.objectives : current?.storyObjectives
    if (current?.status === 'active' && current.currentStageIndex === stageIndex
      && JSON.stringify(current.storyObjectives) === JSON.stringify(objectives)) continue
    taskProgress = {
      ...taskProgress,
      [match.questId]: { ...current, taskId: match.questId, status: 'active', source: 'screen-scan', updatedAt: now, currentStageIndex: stageIndex,
        ...(objectives ? { storyObjectives: objectives } : {}) },
    }
  }
  return taskProgress === progress.taskProgress ? progress : { ...progress, taskProgress }
}

export interface StoryConfirmation {
  context: string
  observedAt: number
  matches: StoryScanMatch[]
}

/** A cached reading and a reading from another profile/mode are never a second confirmation. */
export function confirmStoryFrame(previous: StoryConfirmation | null, context: string, observedAt: number, matches: StoryScanMatch[]) {
  const fresh = Number.isFinite(observedAt) && (!previous || observedAt > previous.observedAt)
  const confirmed = fresh && previous?.context === context ? matches.filter((match) => previous.matches.some((entry) => (
    entry.questId === match.questId && entry.stageIndex === match.stageIndex
    && JSON.stringify(entry.completedStageIndexes ?? []) === JSON.stringify(match.completedStageIndexes ?? [])
    && JSON.stringify(entry.objectives ?? []) === JSON.stringify(match.objectives ?? [])
  ))).map((match) => ({ ...match, stageConfirmed: match.stageIndex != null })) : []
  return { confirmed, state: fresh ? { context, observedAt, matches } : previous }
}
