/**
 * The per-mode store of the quest-state engine (docs/quests/quest-state-engine.md): each source writes only its own
 * layer of `ModeProgress.questInputs`, and `commitQuestInputs` runs the engine and keeps its output as `taskProgress`.
 * Nothing else writes `taskProgress`.
 */
import type { ModeProgress, RaidMode, TaskProgressRecord } from '../domain/types'
import type { ParsedTaskEvent } from '../import/logParser'
import { STORY_QUEST_INDEX } from '../data/storyQuestIndex'
import { emptyQuestInputs, isStoryRecord, latestTime, newerObservation, resolveQuestStates, type ManualMark, type QuestInputLayers, type QuestObservation, type QuestResolution } from './questEngine'

/** Story chapters and their objective quests (read from the story pane in every mode, never from the Tasks table). */
export const STORY_IDS: ReadonlySet<string> = new Set(STORY_QUEST_INDEX.flatMap((row) => [row.questId, ...row.objectiveQuestIds] as string[]))

const LAYERS = ['log', 'server', 'manual', 'table', 'story', 'legacy'] as const

/** The mode's reset floor: «Престиж +» / «Вайп» / a nickname change, or the game's trusted reset, whichever is later. */
export function questFloor(progress: Pick<ModeProgress, 'modeResetAt' | 'logResetAt'>) {
  return latestTime(progress.modeResetAt, progress.logResetAt)
}

/**
 * The layers a profile of 0.6.0.41 or older held in one record per quest, split by source once: log records (the server's
 * too: older versions could not tell them apart), Tasks-table and story-pane readings (the table in PvE only), legacy
 * manual records and «Ручная отметка» marks. Inferred, migrated and imported records are not a source.
 */
export function inputsFromRecords(taskProgress: Record<string, TaskProgressRecord>, mode: RaidMode): QuestInputLayers {
  const layers = emptyQuestInputs()
  for (const [taskId, record] of Object.entries(taskProgress)) {
    if (record.source === 'eft-log') (record.origin === 'server' ? layers.server : layers.log)[taskId] = { status: record.status, at: record.updatedAt }
    else if (record.source === 'manual-fix') layers.manual[taskId] = { status: record.status === 'failed' ? 'active' : record.status, at: record.updatedAt }
    else if (record.source === 'manual') layers.legacy[taskId] = record
    else if (record.source === 'screen-scan') {
      if (isStoryRecord(record, STORY_IDS)) layers.story[taskId] = record
      else if (mode === 'pve') layers.table[taskId] = record
    }
  }
  return layers
}

/** The mode's layers (built from its records when the profile is older than the engine). */
export function inputsOf(progress: Pick<ModeProgress, 'questInputs' | 'taskProgress'>, mode: RaidMode): QuestInputLayers {
  return progress.questInputs ?? inputsFromRecords(progress.taskProgress, mode)
}

/** The engine over a mode's layers and floor. */
export function resolveMode(progress: ModeProgress, mode: RaidMode, catalog?: Parameters<typeof resolveQuestStates>[1]): QuestResolution {
  return resolveQuestStates({ ...inputsOf(progress, mode), mode, floor: questFloor(progress) }, catalog)
}

function sameRecords(a: Record<string, TaskProgressRecord>, b: Record<string, TaskProgressRecord>) {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => b[key] && JSON.stringify(a[key]) === JSON.stringify(b[key]))
}

/**
 * New layers for a mode: the engine decides again and its output becomes `taskProgress` (the same object when no
 * decision changed, so nothing re-renders for a reading that changed nothing).
 */
export function commitQuestInputs(progress: ModeProgress, mode: RaidMode, layers: QuestInputLayers): ModeProgress {
  const { taskProgress } = resolveQuestStates({ ...layers, mode, floor: questFloor(progress) })
  const same = sameRecords(progress.taskProgress, taskProgress)
  if (same && layers === progress.questInputs) return progress
  return { ...progress, questInputs: layers, taskProgress: same ? progress.taskProgress : taskProgress }
}

/** One layer replaced (the others as they are). */
export function withLayer<K extends keyof QuestInputLayers>(progress: ModeProgress, mode: RaidMode, key: K, layer: QuestInputLayers[K]): ModeProgress {
  const layers = inputsOf(progress, mode)
  if (layers[key] === layer && progress.questInputs) return progress
  return commitQuestInputs(progress, mode, { ...layers, [key]: layer })
}

/**
 * Log events into a log layer: per quest the newest event (an equal time: the status further on). Without `keep` the
 * layer starts empty (the first character a mode learns: what an older version kept is read again from the logs).
 */
export function mergeObservations(layer: Record<string, QuestObservation>, events: readonly ParsedTaskEvent[], keep = true): Record<string, QuestObservation> {
  let next = keep ? layer : {}
  for (const event of events) {
    const kept = next[event.taskId]
    const merged = newerObservation(kept, { status: event.status, at: event.timestamp })
    if (merged === kept) continue
    if (next === layer) next = { ...layer }
    next[event.taskId] = merged
  }
  return next
}

/** «Ручная отметка»: a mark («В текущие» / «Выполнено») or its removal («Снять отметку»), at `at`. */
export function setManualMark(layer: Record<string, ManualMark>, taskId: string, status: ManualMark['status'], at: string): Record<string, ManualMark> {
  return { ...layer, [taskId]: { status, at } }
}

/** Marks from the server (another device): per quest the newer one wins. */
export function mergeManualMarks(layer: Record<string, ManualMark>, marks: ReadonlyArray<{ taskId: string } & ManualMark>): Record<string, ManualMark> {
  let next = layer
  for (const mark of marks) {
    const kept = next[mark.taskId]
    if (kept && kept.at >= mark.at) continue
    if (next === layer) next = { ...layer }
    next[mark.taskId] = { status: mark.status, at: mark.at }
  }
  return next
}

/** Every layer's readings older than `at` go (a character change or a newer trusted reset: src/import/logApply.ts). */
export function dropInputsBefore(layers: QuestInputLayers, at: string): QuestInputLayers {
  const next = emptyQuestInputs()
  for (const key of LAYERS) {
    const layer = layers[key] as Record<string, { at?: string; updatedAt?: string }>
    ;(next as unknown as Record<string, Record<string, unknown>>)[key] = Object.fromEntries(Object.entries(layer).filter(([, value]) => (value.at ?? value.updatedAt ?? '') >= at))
  }
  return next
}

/** Legacy slug keys rewritten to task ids in every layer (src/domain/progress.ts normalizeTaskKeys). */
export function renameInputKeys(layers: QuestInputLayers, resolve: (key: string) => string): QuestInputLayers {
  let changed = false
  const next = emptyQuestInputs()
  for (const key of LAYERS) {
    const target = {} as Record<string, { at?: string; updatedAt?: string; taskId?: string }>
    for (const [id, value] of Object.entries(layers[key] as Record<string, { at?: string; updatedAt?: string; taskId?: string }>)) {
      const taskId = resolve(id)
      if (taskId !== id) changed = true
      const entry = 'taskId' in value && value.taskId !== taskId ? { ...value, taskId } : value
      if (entry !== value) changed = true
      const known = target[taskId]
      if (!known || (known.at ?? known.updatedAt ?? '') < (entry.at ?? entry.updatedAt ?? '')) target[taskId] = entry
    }
    ;(next as unknown as Record<string, unknown>)[key] = target
  }
  return changed ? next : layers
}

/** Manual marks and their removals to send (the server keeps the newest per quest). */
export function manualMarksOf(progress: Pick<ModeProgress, 'questInputs'>) {
  return Object.entries(progress.questInputs?.manual ?? {}).map(([taskId, mark]) => ({ taskId, ...mark }))
}
