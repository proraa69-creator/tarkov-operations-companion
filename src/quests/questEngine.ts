/**
 * The quest-state engine (docs/quests/quest-state-engine.md): the one place that decides a quest's status in one mode
 * from every source — the game logs, the server's records from other devices, manual marks, the Tasks-table readings
 * (PvE only), the story-pane readings and the legacy manual records — after the mode's reset floor. Pure: no React, no
 * storage; the server imports it too (server/src/services/sharedProgress.ts).
 */
import type { QuestInputLayers, QuestObservation, RaidMode, StoryObjectiveReading, TaskProgressRecord } from '../domain/types'

export type ResolvedStatus = 'not-started' | 'active' | 'completed' | 'failed'
export type QuestSourceKind = 'log' | 'server' | 'manual' | 'table' | 'story' | 'legacy'
export type ObservedStatus = 'active' | 'completed' | 'failed'

export type { ManualMark, QuestInputLayers, QuestObservation } from '../domain/types'

export interface QuestEngineInputs extends QuestInputLayers {
  mode: RaidMode
  /** The mode's reset floor: nothing older counts. */
  floor?: string
}

export type QuestConflictKind = 'screen-vs-log' | 'manual-overridden' | 'before-floor' | 'table-outside-pve' | 'table-completed-unproven' | 'prerequisite-open' | 'unknown-quest'

export interface QuestConflict { kind: QuestConflictKind; source: QuestSourceKind; status?: string; at?: string; detail?: string }

export interface ResolvedQuest {
  taskId: string
  status: ResolvedStatus
  /** The layer that decided; undefined for not-started. */
  source?: QuestSourceKind
  at?: string
  confidence: number
  conflicts: QuestConflict[]
}

/** The catalog the consistency checks need: ids and mandatory prerequisites. */
export interface EngineQuest { id: string; requirements?: Array<{ taskId: string; allowedStatuses: string[]; group?: unknown }>; previous?: string[] }

export interface QuestDiagnostics {
  mode: RaidMode
  floor?: string
  /** Quests each source decided, by status. */
  decided: Record<QuestSourceKind, { completed: number; active: number; failed: number }>
  /** Resolved completed (what «Выполнено» counts). */
  completed: number
  active: number
  failed: number
  /** Observations below the floor, per source. */
  beforeFloor: number
  conflicts: Partial<Record<QuestConflictKind, number>>
  /** Ids no quest of the catalog has (with a catalog). */
  unknownIds: number
  /** «вероятно выполнено» hints of the chain and the chronology: never counted (with the availability). */
  inferred?: number
  /** How many ids each layer holds. */
  layerSizes: Record<QuestSourceKind, number>
}

export interface QuestResolution {
  mode: RaidMode
  states: Map<string, ResolvedQuest>
  /** The engine's output as the app's stored records (ModeProgress.taskProgress). */
  taskProgress: Record<string, TaskProgressRecord>
  diagnostics: QuestDiagnostics
}

export const SOURCE_CONFIDENCE: Record<QuestSourceKind, number> = { manual: 1, log: 0.95, server: 0.9, story: 0.8, table: 0.7, legacy: 0.4 }
const SOURCES: QuestSourceKind[] = ['log', 'server', 'manual', 'table', 'story', 'legacy']

export function emptyQuestInputs(): QuestInputLayers {
  return { log: {}, server: {}, manual: {}, table: {}, story: {}, legacy: {} }
}

/** A record of the story pane rather than of the Tasks table: a chapter id or one with a stage / objectives read. */
export function isStoryRecord(record: Pick<TaskProgressRecord, 'taskId' | 'currentStageIndex' | 'storyObjectives'>, storyIds?: ReadonlySet<string>) {
  return record.taskId.startsWith('story-') || record.taskId.startsWith('wiki:') || Boolean(storyIds?.has(record.taskId))
    || record.currentStageIndex != null || Boolean(record.storyObjectives?.length)
}

/**
 * Every quest of one mode, decided once (the precedence of docs/quests/quest-state-engine.md). `catalog`: the mode's
 * quests, for the consistency checks only (no status depends on it).
 */
export function resolveQuestStates(inputs: QuestEngineInputs, catalog?: readonly EngineQuest[]): QuestResolution {
  const { floor, mode } = inputs
  const pve = mode === 'pve'
  const below = (at: string | undefined) => Boolean(floor && at && at < floor)
  const states = new Map<string, ResolvedQuest>()
  const taskProgress: Record<string, TaskProgressRecord> = {}
  const decided = Object.fromEntries(SOURCES.map((source) => [source, { completed: 0, active: 0, failed: 0 }])) as QuestDiagnostics['decided']
  const conflicts: Partial<Record<QuestConflictKind, number>> = {}
  let beforeFloor = 0
  const ids = new Set<string>()
  for (const source of SOURCES) for (const id of Object.keys(inputs[source] ?? {})) ids.add(id)

  for (const taskId of ids) {
    const list: QuestConflict[] = []
    const fresh = <T extends { at: string; status: string }>(source: QuestSourceKind, value: T | undefined): T | undefined => {
      if (!value) return undefined
      if (below(value.at)) {
        beforeFloor += 1
        list.push({ kind: 'before-floor', source, status: value.status, at: value.at })
        return undefined
      }
      return value
    }
    const asObservation = (record: TaskProgressRecord | undefined) => record ? { status: record.status, at: record.updatedAt } : undefined
    const log = fresh('log', inputs.log?.[taskId])
    const server = fresh('server', inputs.server?.[taskId])
    const manualMark = fresh('manual', inputs.manual?.[taskId])
    const manual = manualMark && manualMark.status !== 'cleared' ? { status: manualMark.status as ObservedStatus, at: manualMark.at } : undefined
    const storyRecord = inputs.story?.[taskId] && !below(inputs.story[taskId]!.updatedAt) ? inputs.story[taskId] : undefined
    if (inputs.story?.[taskId] && !storyRecord) fresh('story', asObservation(inputs.story[taskId]))
    let tableRecord = inputs.table?.[taskId] && !below(inputs.table[taskId]!.updatedAt) ? inputs.table[taskId] : undefined
    if (inputs.table?.[taskId] && !tableRecord) fresh('table', asObservation(inputs.table[taskId]))
    if (tableRecord && !pve) {
      list.push({ kind: 'table-outside-pve', source: 'table', status: tableRecord.status, at: tableRecord.updatedAt })
      tableRecord = undefined
    }
    if (tableRecord?.status === 'completed') {
      // A completion the table never shows: a chain guess of older versions. A hint, not a decision.
      list.push({ kind: 'table-completed-unproven', source: 'table', status: 'completed', at: tableRecord.updatedAt })
      tableRecord = undefined
    }
    const legacyRecord = inputs.legacy?.[taskId] && !below(inputs.legacy[taskId]!.updatedAt) ? inputs.legacy[taskId] : undefined
    if (inputs.legacy?.[taskId] && !legacyRecord) fresh('legacy', asObservation(inputs.legacy[taskId]))

    // 2. The game: this PC's logs and the server's records are one stream, the newest event wins (a tie: this PC).
    const game: (QuestObservation & { source: QuestSourceKind }) | undefined = log && (!server || log.at >= server.at)
      ? { ...log, source: 'log' }
      : server ? { ...server, source: 'server' } : undefined
    let winner: { status: ObservedStatus; at: string; source: QuestSourceKind } | undefined = game
    // 3. A manual mark beats an older game event, loses to a newer one.
    if (manual) {
      if (!game || manual.at >= game.at) winner = { ...manual, source: 'manual' }
      else list.push({ kind: 'manual-overridden', source: 'manual', status: manual.status, at: manual.at })
    }
    // 5. Story chapters: the pane in every mode, and the logs where they mention one; the newer decides.
    if (storyRecord) {
      const pane = { status: storyRecord.status, at: storyRecord.updatedAt, source: 'story' as const }
      if (!winner || (winner.source !== 'manual' && pane.at > winner.at)) winner = pane
    }
    // 4. The Tasks table (PvE): fills a gap only; never against a log event.
    if (tableRecord) {
      if (!winner) winner = { status: tableRecord.status, at: tableRecord.updatedAt, source: 'table' }
      else if (game && game.status !== tableRecord.status) list.push({ kind: 'screen-vs-log', source: 'table', status: tableRecord.status, at: tableRecord.updatedAt, detail: `${game.source}:${game.status}` })
    }
    // 6. Legacy manual records: what nothing else covers.
    if (!winner && legacyRecord) winner = { status: legacyRecord.status, at: legacyRecord.updatedAt, source: 'legacy' }

    const resolved: ResolvedQuest = winner
      ? { taskId, status: winner.status, source: winner.source, at: winner.at, confidence: SOURCE_CONFIDENCE[winner.source], conflicts: list }
      : { taskId, status: 'not-started', confidence: 0, conflicts: list }
    states.set(taskId, resolved)
    if (winner) {
      decided[winner.source][winner.status] += 1
      taskProgress[taskId] = recordOf(taskId, winner, storyRecord ?? tableRecord ?? legacyRecord)
    }
  }

  if (catalog) checkCatalog(states, catalog)
  let unknownIds = 0
  let completed = 0
  let active = 0
  let failed = 0
  for (const state of states.values()) {
    for (const conflict of state.conflicts) conflicts[conflict.kind] = (conflicts[conflict.kind] ?? 0) + 1
    if (state.conflicts.some((conflict) => conflict.kind === 'unknown-quest')) unknownIds += 1
    if (state.status === 'completed') completed += 1
    else if (state.status === 'active') active += 1
    else if (state.status === 'failed') failed += 1
  }
  const layerSizes = Object.fromEntries(SOURCES.map((source) => [source, Object.keys(inputs[source] ?? {}).length])) as Record<QuestSourceKind, number>
  return {
    mode,
    states,
    taskProgress,
    diagnostics: { mode, ...(floor ? { floor } : {}), decided, completed, active, failed, beforeFloor, conflicts, unknownIds, layerSizes },
  }
}

/** The decision as the app's record: the status, the time, the source, and a chapter's stage and objectives. */
function recordOf(taskId: string, winner: { status: ObservedStatus; at: string; source: QuestSourceKind }, screen: TaskProgressRecord | undefined): TaskProgressRecord {
  const source: TaskProgressRecord['source'] = winner.source === 'log' || winner.source === 'server' ? 'eft-log'
    : winner.source === 'manual' ? 'manual-fix'
      : winner.source === 'legacy' ? 'manual' : 'screen-scan'
  const stage: { currentStageIndex?: number; storyObjectives?: StoryObjectiveReading[] } = {}
  if (screen?.currentStageIndex != null) stage.currentStageIndex = screen.currentStageIndex
  if (screen?.storyObjectives?.length) stage.storyObjectives = screen.storyObjectives
  return { taskId, status: winner.status, source, updatedAt: winner.at, ...(winner.source === 'server' ? { origin: 'server' as const } : {}), ...stage }
}

/** The catalog checks: ids it does not know, and completions whose mandatory prerequisite is still active or failed. */
function checkCatalog(states: Map<string, ResolvedQuest>, catalog: readonly EngineQuest[]) {
  const byId = new Map(catalog.map((quest) => [quest.id, quest]))
  for (const state of states.values()) {
    const quest = byId.get(state.taskId)
    if (!quest) {
      if (state.status !== 'not-started') state.conflicts.push({ kind: 'unknown-quest', source: state.source ?? 'log' })
      continue
    }
    if (state.status !== 'completed') continue
    const requirements: NonNullable<EngineQuest['requirements']> = quest.requirements ?? (quest.previous ?? []).map((taskId) => ({ taskId, allowedStatuses: ['complete'] }))
    for (const requirement of requirements) {
      const completionOnly = !requirement.group && (!requirement.allowedStatuses.length || requirement.allowedStatuses.every((status) => status === 'complete'))
      if (!completionOnly) continue
      const before = states.get(requirement.taskId)
      if (before && (before.status === 'active' || before.status === 'failed')) {
        state.conflicts.push({ kind: 'prerequisite-open', source: state.source ?? 'log', status: before.status, detail: requirement.taskId })
      }
    }
  }
}

/** Keeps the newer observation of a quest in a layer (an equal time: the status further on, completed > failed > active). */
export function newerObservation(kept: QuestObservation | undefined, next: QuestObservation): QuestObservation {
  if (!kept || next.at > kept.at) return next
  if (next.at === kept.at && ORDER[next.status] > ORDER[kept.status]) return next
  return kept
}
const ORDER: Record<ObservedStatus, number> = { active: 1, failed: 2, completed: 3 }

/** The later of several ISO times. */
export function latestTime(...values: Array<string | undefined>) {
  return values.reduce<string | undefined>((latest, value) => (value && (!latest || value > latest) ? value : latest), undefined)
}

/**
 * The diagnostics with the «вероятно выполнено» hints of the lists (calculateAvailability's `basis`: a prerequisite chain
 * or the chronology): how many quests inference would call done, none of them counted.
 */
export function withInferred(diagnostics: QuestDiagnostics, availability: ReadonlyMap<string, { status: string; basis?: string }>): QuestDiagnostics {
  let inferred = 0
  for (const entry of availability.values()) if (entry.status === 'completed' && entry.basis) inferred += 1
  return { ...diagnostics, inferred }
}

/** One line for the owner's panel: «логи: 154 выполнено, экран: +0, вывод из цепочек: 0 (не считается)». */
export function diagnosticsLine(diagnostics: QuestDiagnostics, locale: 'ru' | 'en' = 'ru') {
  const { decided } = diagnostics
  const logs = decided.log.completed + decided.server.completed
  const screen = decided.table.active + decided.table.completed
  const manual = decided.manual.completed
  const inferred = diagnostics.inferred ?? '—'
  return locale === 'en'
    ? `logs: ${logs} completed, screen: +${screen}, manual: ${manual}, chain inference: ${inferred} (not counted)`
    : `логи: ${logs} выполнено, экран: +${screen}, вручную: ${manual}, вывод из цепочек: ${inferred} (не считается)`
}

