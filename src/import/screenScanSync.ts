import type { ModeProgress, Quest, TaskRequirement } from '../domain/types'
import { ocrKey, type QuestRowStatus } from './questOcr'
import { reconcileWithSession, type QuestScanSession } from './questSession'
import { applyStoryScan, type StoryScanMatch } from './storyScan'
import { questRequirements } from '../progression/requirementEngine'

/** Screens that mention quests but are not the Tasks list: messenger, trading, flea market. */
const NOT_TASKS_SCREEN = /сообщени[яй]|отправить|барахолк|купить|продать/

export function isTasksMenuText(text: string) {
  const lower = text.toLowerCase()
  const folded = `${lower}\n${ocrKey(text)}`
  // A Tasks screen always shows the quest table or the story detail pane.
  const strong = [
    /любаялокац/,
    /любая\s+локац/,
    /активно/,
    /побочн/,
    /сюжетн/,
    /оперативн/,
    /главн(ые|ая)\s*задач/,
    /(?<![а-яё])[а-яё]{0,4}ные\s*задач/,
    /иональн[а-яё]*\s*задач/,
    /класс\s+задание\s+локация/,
  ].filter((pattern) => pattern.test(folded)).length
  if (!strong) return false
  if (NOT_TASKS_SCREEN.test(lower) && strong < 2) return false
  const weak = [
    /задан(ия|ие|и)/,
    /задачи/,
    /сдать/,
    /наград/,
    /принят/,
    /завершить/,
    /лояльност/,
    /история/,
    /связанные\s*предмет/,
  ].filter((pattern) => pattern.test(folded)).length
  return strong + weak >= 2
}

export function shouldApplyQuestScan(text: string, matchCount: number) {
  if (matchCount <= 0) return false
  return isTasksMenuText(text)
}

export interface ScreenScanOptions {
  previousSeenIds?: string[]
  /** Live watch: a quest not tracked yet must be seen in two consecutive frames before it is added. */
  requireConfirmation?: boolean
  /** Live watch session: drops stored quests the table no longer shows, detects hand-ins. */
  session?: QuestScanSession
  now?: number
}

export type ScreenScanMatch = StoryScanMatch & { status?: QuestRowStatus }

export function applyScreenScanProgress(
  progress: ModeProgress,
  matches: ScreenScanMatch[],
  quests: Quest[],
  options?: ScreenScanOptions,
): ModeProgress {
  if (!matches.length) return progress
  const nowMs = options?.now ?? Date.now()
  const now = new Date(nowMs).toISOString()
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const storyMatches = matches.filter((match) => byId.get(match.questId)?.kind === 'story' && isCurrentRow(match.status))
  const taskProgress = { ...applyStoryScan(progress, storyMatches, now).taskProgress }
  const previous = new Set((options?.previousSeenIds ?? []).filter(Boolean))
  const current = matches.filter((match) => match.questId && isCurrentRow(match.status))
  const seen = new Set(current.map((match) => match.questId))

  for (const match of matches) {
    if (match.status !== 'failed' || !match.questId) continue
    const record = taskProgress[match.questId]
    if (record?.status === 'active' && record.source === 'screen-scan') delete taskProgress[match.questId]
  }

  for (const match of current) {
    const taskId = match.questId
    if (taskId.startsWith('wiki:')) continue
    if (byId.get(taskId)?.kind === 'story') continue
    const current = taskProgress[taskId]
    // Messages / reward screens repeat finished quest names, so only a table row with an explicit
    // «активно!» / «выполнено!» status can bring back a quest the scanner itself moved to completed.
    if (current?.status === 'completed') {
      const tableRow = match.status === 'active' || match.status === 'ready'
      if (current.source !== 'screen-scan' || !tableRow) continue
    }
    const tracked = current?.status === 'active' && current.source === 'screen-scan'
    if (!tracked && options?.requireConfirmation && !previous.has(taskId)) continue
    const stageIndex = typeof match.stageIndex === 'number' ? match.stageIndex : current?.currentStageIndex
    taskProgress[taskId] = {
      taskId,
      status: 'active',
      source: 'screen-scan',
      updatedAt: now,
      currentStageIndex: stageIndex,
    }
  }

  // Quests that are complete-prerequisites of something now on screen were turned in
  // («Завершить» → the next quest of the chain appears). Untracked predecessors are inferred
  // at read time, so a single misread cannot permanently mark a whole chain as done.
  const confirmed = new Set([...seen].filter((taskId) => taskProgress[taskId]?.status === 'active' && taskProgress[taskId]?.source === 'screen-scan'))
  const prerequisites = new Set<string>()
  for (const taskId of confirmed) collectCompletePrerequisites(taskId, byId, confirmed, prerequisites, new Set())

  const traderSeen = [...confirmed].some((taskId) => byId.get(taskId)?.kind !== 'story')

  // Unseen quests stay current: switching trader tabs, scrolling or closing the menu must not drop them.
  for (const [taskId, record] of Object.entries(taskProgress)) {
    if (record.source !== 'screen-scan' || record.status !== 'active') continue
    if (seen.has(taskId)) continue
    const quest = byId.get(taskId)
    if (quest?.kind === 'story') {
      // A cropped detail pane is not the complete chapter list.
      continue
    }
    if (traderSeen && prerequisites.has(taskId)) {
      taskProgress[taskId] = {
        taskId,
        status: 'completed',
        source: 'screen-scan',
        updatedAt: now,
        currentStageIndex: record.currentStageIndex,
      }
    }
  }

  // Keep active rows discovered in EFT logs. OCR only sees the currently visible page of the
  // table, so deleting log rows here truncated long PvE task lists after the very first frame.
  // A confirmed OCR record for the same task still replaces the log record above.

  const next = { ...progress, taskProgress }
  return options?.session ? reconcileWithSession(next, options.session, quests, nowMs) : next
}

/** Rows marked «доступно» / «заблокировано» / «провалено» are listed but not being done. */
function isCurrentRow(status?: QuestRowStatus) {
  return status === undefined || status === 'active' || status === 'ready'
}

export function screenScanWouldChange(
  progress: ModeProgress,
  matches: ScreenScanMatch[],
  quests: Quest[],
  options?: ScreenScanOptions,
) {
  const next = applyScreenScanProgress(progress, matches, quests, options)
  return progressFingerprint(progress, next) !== progressFingerprint(next, next)
}

function progressFingerprint(progress: ModeProgress, source: ModeProgress) {
  return Object.keys(source.taskProgress).sort().map((taskId) => {
    const record = progress.taskProgress[taskId]
    return `${taskId}:${record?.status ?? ''}:${record?.currentStageIndex ?? ''}:${record?.source ?? ''}`
  }).join('|')
}

function collectCompletePrerequisites(
  taskId: string,
  byId: Map<string, Quest>,
  seen: Set<string>,
  completed: Set<string>,
  visiting: Set<string>,
) {
  if (visiting.has(taskId)) return
  visiting.add(taskId)
  const quest = byId.get(taskId)
  if (!quest) return
  for (const requirement of completeOnlyRequirements(quest)) {
    if (seen.has(requirement.taskId) || requirement.taskId.startsWith('wiki:')) continue
    completed.add(requirement.taskId)
    collectCompletePrerequisites(requirement.taskId, byId, seen, completed, visiting)
  }
}

function completeOnlyRequirements(quest: Quest): TaskRequirement[] {
  return questRequirements(quest).filter((requirement) => (
    !requirement.group
    && requirement.allowedStatuses.length === 1
    && requirement.allowedStatuses[0] === 'complete'
  ))
}
