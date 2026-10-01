/**
 * Objective-level quest progress with provenance (docs/quest-sync-spec.md).
 *
 * Pure functions shared by the app and the API server. Every change of an objective goes through `decide()`:
 *   1. manual beats automatic (log / ocr / sync);
 *   2. within the same authority the newer observation wins (equal time: higher confidence);
 *   3. a log-confirmed completion never silently overrides a manual «not done»: it becomes a conflict the
 *      quest view asks about.
 * Every applied change is recorded as a progress event; automatic changes can be undone.
 */
import type {
  ModeProgress,
  ObjectiveConflict,
  ObjectiveProgress,
  ObjectiveSource,
  ProgressEvent,
  ProgressSource,
  Quest,
  RaidMode,
  TaskProgressRecord,
} from '../domain/types'

/** Local history per mode; the server keeps more (see server/src/services/objectiveStore.ts). */
export const MAX_LOCAL_EVENTS = 600
export const MAX_TARGET = 100_000
/** Ids the server accepts for tasks and objectives (hex ids, story/wiki ids in any script). */
export const ENTITY_ID_PATTERN = /^[\p{L}\p{N}:#._\- ]{1,128}$/u
export const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{6,80}$/
export const OBJECTIVE_TYPE_PATTERN = /^[A-Za-z]{1,40}$/
export const SOURCE_CONFIDENCE: Record<ObjectiveSource, number> = { manual: 1, log: 0.95, sync: 0.9, ocr: 0.7 }

/** The parts of a mode's progress this module reads and writes (the server stores only these). */
export interface ObjectiveStateShape {
  objectiveProgress: Record<string, ObjectiveProgress>
  progressEvents: ProgressEvent[]
  objectiveConflicts: ObjectiveConflict[]
  taskProgress?: Record<string, TaskProgressRecord>
}

export interface ObjectiveDef {
  id: string
  taskId: string
  type: string
  description: string
  target: number
  optional: boolean
  /** False for ids made from the list position (catalog without objective ids): they may move after an update. */
  stableId: boolean
}

export interface ObjectiveView {
  def: ObjectiveDef
  current: number
  done: boolean
  /** Where the shown value comes from; undefined = nothing known yet. */
  source?: ObjectiveSource
  /** True when the value is derived from the quest's status (completed quest → objectives done), not stored. */
  derived: boolean
  record?: ObjectiveProgress
  conflict?: ObjectiveConflict
}

export type Decision = 'apply' | 'ignore' | 'conflict' | 'unchanged'

const isAutomatic = (source: ObjectiveSource) => source !== 'manual'
export const isObjectiveDone = (record: Pick<ObjectiveProgress, 'current' | 'target'>) => record.current >= record.target

export function newEventId() {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return `ev-${Date.now().toString(36)}-${random.slice(0, 16)}`
}

/** Maps the task-record source to the objective source vocabulary of the spec. */
export function objectiveSourceOf(source: ProgressSource): ObjectiveSource {
  if (source === 'eft-log') return 'log'
  if (source === 'screen-scan') return 'ocr'
  if (source === 'manual') return 'manual'
  return 'sync'
}

/** Objectives of a trader quest with stable ids. Story chapters use their stages instead and return []. */
export function questObjectiveDefs(quest: Quest): ObjectiveDef[] {
  if (quest.kind === 'story' || quest.stages?.length) return []
  if (quest.objectiveDetails?.length) {
    return quest.objectiveDetails.filter((objective) => objective.id).map((objective) => ({
      id: objective.id,
      taskId: quest.id,
      type: objective.type || 'unknown',
      description: objective.description,
      target: clampTarget(objective.count),
      optional: Boolean(objective.optional),
      stableId: true,
    }))
  }
  const ids = quest.objectiveIds ?? []
  const aligned = ids.length === quest.objectives.length
  return quest.objectives.map((description, index) => ({
    id: aligned ? ids[index] : `${quest.id}#${index}`,
    taskId: quest.id,
    type: 'unknown',
    description,
    target: 1,
    optional: false,
    stableId: aligned,
  }))
}

/** What the quest view shows for each objective in this mode. */
export function objectiveViews(quest: Quest, progress: Pick<ModeProgress, 'objectiveProgress' | 'objectiveConflicts' | 'taskProgress'>): ObjectiveView[] {
  const questRecord = progress.taskProgress[quest.id]
  return questObjectiveDefs(quest).map((def) => {
    const record = progress.objectiveProgress?.[def.id]
    const conflict = progress.objectiveConflicts?.find((entry) => entry.objectiveId === def.id)
    if (record) {
      const target = Math.max(1, record.target || def.target)
      const current = Math.min(Math.max(0, record.current), target)
      return { def: { ...def, target }, current, done: current >= target, source: record.source, derived: false, record, conflict }
    }
    if (questRecord?.status === 'completed') return { def, current: def.target, done: true, source: objectiveSourceOf(questRecord.source), derived: true, conflict }
    return { def, current: 0, done: false, derived: false, conflict }
  })
}

/** Normalizes an incoming value: integer target ≥ 1, current within [0, target], completedAt when done. */
export function normalizeObjective(record: ObjectiveProgress): ObjectiveProgress {
  const target = clampTarget(record.target)
  const current = Math.min(target, Math.max(0, Math.round(Number.isFinite(record.current) ? record.current : 0)))
  const confidence = Math.min(1, Math.max(0, Number.isFinite(record.confidence) ? record.confidence : SOURCE_CONFIDENCE[record.source] ?? 0.5))
  const normalized: ObjectiveProgress = {
    objectiveId: record.objectiveId,
    taskId: record.taskId,
    type: record.type || 'unknown',
    target,
    current,
    source: record.source,
    confidence,
    observedAt: record.observedAt,
  }
  if (current >= target) normalized.completedAt = record.completedAt ?? record.observedAt
  return normalized
}

/** The conflict rules (see the module comment). */
export function decide(existing: ObjectiveProgress | undefined, incoming: ObjectiveProgress): Decision {
  if (!existing) return 'apply'
  if (existing.current === incoming.current && existing.target === incoming.target && existing.source === incoming.source) return 'unchanged'
  const existingManual = !isAutomatic(existing.source)
  const incomingManual = !isAutomatic(incoming.source)
  if (incomingManual && !existingManual) return 'apply'
  if (!incomingManual && existingManual) {
    if (incoming.source === 'log' && isObjectiveDone(incoming) && !isObjectiveDone(existing)) return 'conflict'
    return 'ignore'
  }
  if (incoming.observedAt > existing.observedAt) return 'apply'
  if (incoming.observedAt === existing.observedAt && incoming.confidence > existing.confidence) return 'apply'
  return 'ignore'
}

export interface ChangeResult<T> { progress: T; decision: Decision; event?: ProgressEvent }

/** Applies one observed objective value with the conflict rules and records the event. */
export function applyObjectiveChange<T extends ObjectiveStateShape>(progress: T, mode: RaidMode, value: ObjectiveProgress, options: { eventId?: string; now?: string } = {}): ChangeResult<T> {
  const incoming = normalizeObjective(value)
  const existing = progress.objectiveProgress[incoming.objectiveId]
  const decision = decide(existing, incoming)
  if (decision === 'unchanged' || decision === 'ignore') return { progress, decision }
  if (decision === 'conflict') {
    const conflict: ObjectiveConflict = { objectiveId: incoming.objectiveId, taskId: incoming.taskId, incoming, detectedAt: options.now ?? new Date().toISOString() }
    return { progress: { ...progress, objectiveConflicts: [...progress.objectiveConflicts.filter((entry) => entry.objectiveId !== incoming.objectiveId), conflict] }, decision }
  }
  const event: ProgressEvent = {
    id: options.eventId ?? newEventId(),
    mode,
    taskId: incoming.taskId,
    objectiveId: incoming.objectiveId,
    eventType: 'objective',
    oldValue: existing ? existing.current : null,
    newValue: incoming.current,
    source: incoming.source,
    confidence: incoming.confidence,
    observedAt: incoming.observedAt,
    reversible: isAutomatic(incoming.source),
  }
  // The user's own answer settles a pending question about this objective.
  const objectiveConflicts = incoming.source === 'manual'
    ? progress.objectiveConflicts.filter((entry) => entry.objectiveId !== incoming.objectiveId)
    : progress.objectiveConflicts
  return {
    progress: appendEvents({ ...progress, objectiveProgress: { ...progress.objectiveProgress, [incoming.objectiveId]: incoming }, objectiveConflicts }, [event]),
    decision,
    event,
  }
}

/** A manual edit from the quest view (checkbox or counter). */
export function manualObjectiveValue(def: Pick<ObjectiveDef, 'id' | 'taskId' | 'type' | 'target'>, current: number, now = new Date().toISOString()): ObjectiveProgress {
  return { objectiveId: def.id, taskId: def.taskId, type: def.type, target: def.target, current, source: 'manual', confidence: 1, observedAt: now }
}

/**
 * A quest the log now reports completed while the user has marked some of its objectives as not done:
 * those objectives get a conflict (asked in the quest view) instead of being overwritten.
 */
export function logCompletionConflicts<T extends ObjectiveStateShape>(progress: T, mode: RaidMode, completedTaskIds: Iterable<string>, observedAt: string): T {
  const completed = new Set(completedTaskIds)
  if (!completed.size) return progress
  let next = progress
  for (const record of Object.values(progress.objectiveProgress)) {
    if (!completed.has(record.taskId) || record.source !== 'manual' || isObjectiveDone(record)) continue
    const incoming: ObjectiveProgress = { ...record, current: record.target, source: 'log', confidence: SOURCE_CONFIDENCE.log, observedAt, completedAt: observedAt }
    next = applyObjectiveChange(next, mode, incoming, { now: observedAt }).progress
  }
  return next
}

/** «Отметить» (accept the log) or «Оставить моё» (keep the manual value) for a pending conflict. */
export function resolveObjectiveConflict<T extends ObjectiveStateShape>(progress: T, mode: RaidMode, objectiveId: string, accept: boolean, now = new Date().toISOString()): T {
  const conflict = progress.objectiveConflicts.find((entry) => entry.objectiveId === objectiveId)
  if (!conflict) return progress
  const objectiveConflicts = progress.objectiveConflicts.filter((entry) => entry.objectiveId !== objectiveId)
  const existing = progress.objectiveProgress[objectiveId]
  const event: ProgressEvent = {
    id: newEventId(),
    mode,
    taskId: conflict.taskId,
    objectiveId,
    eventType: 'conflict-resolved',
    oldValue: existing ? existing.current : null,
    newValue: accept ? conflict.incoming.current : existing ? existing.current : null,
    source: accept ? conflict.incoming.source : 'manual',
    confidence: accept ? conflict.incoming.confidence : 1,
    observedAt: now,
    reversible: accept,
  }
  const objectiveProgress = accept
    ? { ...progress.objectiveProgress, [objectiveId]: normalizeObjective({ ...conflict.incoming, observedAt: now }) }
    : progress.objectiveProgress
  return appendEvents({ ...progress, objectiveProgress, objectiveConflicts }, [event])
}

/** Whether «Отменить» is offered for this event. */
export function canUndo(event: ProgressEvent) {
  if (!event.reversible || event.undoneAt || event.source === 'manual') return false
  if (event.eventType === 'task-status') return typeof event.oldValue === 'string'
  return event.eventType === 'objective' || event.eventType === 'conflict-resolved'
}

/**
 * Undoes an automatic change: the old value is written back as the user's own (manual) value, so the next scan does
 * not re-apply what was undone, and the event is marked undone. Returns the progress unchanged when not undoable.
 */
export function undoProgressEvent<T extends ObjectiveStateShape>(progress: T, eventId: string, now = new Date().toISOString()): T {
  const event = progress.progressEvents.find((entry) => entry.id === eventId)
  if (!event || !canUndo(event)) return progress
  let next: T = { ...progress, progressEvents: progress.progressEvents.map((entry) => entry.id === eventId ? { ...entry, undoneAt: now, synced: false } : entry) }
  if (event.eventType === 'task-status') {
    if (!next.taskProgress) return progress
    const status = event.oldValue as TaskProgressRecord['status']
    next = { ...next, taskProgress: { ...next.taskProgress, [event.taskId]: { taskId: event.taskId, status, source: 'manual', updatedAt: now } } }
  } else {
    const current = progress.objectiveProgress[event.objectiveId ?? '']
    if (!current || !event.objectiveId) return progress
    const restored = normalizeObjective({ ...current, current: typeof event.oldValue === 'number' ? event.oldValue : 0, source: 'manual', confidence: 1, observedAt: now, completedAt: undefined })
    next = { ...next, objectiveProgress: { ...next.objectiveProgress, [event.objectiveId]: restored } }
  }
  const undo: ProgressEvent = {
    id: newEventId(),
    mode: event.mode,
    taskId: event.taskId,
    objectiveId: event.objectiveId,
    eventType: 'undo',
    oldValue: event.newValue,
    newValue: event.oldValue,
    source: 'manual',
    confidence: 1,
    observedAt: now,
    reversible: false,
    refersTo: event.id,
  }
  return appendEvents(next, [undo])
}

/** Task status changes between two states of one mode (log scan, OCR, server records) as events. */
export function taskStatusEvents(before: Record<string, TaskProgressRecord>, after: Record<string, TaskProgressRecord>, mode: RaidMode, now = new Date().toISOString()): ProgressEvent[] {
  const events: ProgressEvent[] = []
  for (const taskId of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const old = before[taskId]
    const next = after[taskId]
    if (old?.status === next?.status) continue
    const source = next ? objectiveSourceOf(next.source) : old ? objectiveSourceOf(old.source) : 'sync'
    events.push({
      id: newEventId(),
      mode,
      taskId,
      eventType: 'task-status',
      oldValue: old?.status ?? null,
      newValue: next?.status ?? null,
      source,
      confidence: SOURCE_CONFIDENCE[source],
      observedAt: next?.updatedAt && next.updatedAt <= now ? next.updatedAt : now,
      reversible: source !== 'manual' && Boolean(old?.status),
    })
  }
  return events
}

/** Appends events (deduplicated by id), keeps them in time order and keeps only the newest `max`. */
export function appendEvents<T extends ObjectiveStateShape>(progress: T, events: ProgressEvent[], max = MAX_LOCAL_EVENTS): T {
  if (!events.length) return progress
  return { ...progress, progressEvents: mergeEventLists(progress.progressEvents, events, max) }
}

/** Union of two event lists by id; an undo seen on either side is kept; oldest dropped beyond `max`. */
export function mergeEventLists(local: ProgressEvent[], incoming: ProgressEvent[], max = MAX_LOCAL_EVENTS): ProgressEvent[] {
  const byId = new Map(local.map((event) => [event.id, event]))
  for (const event of incoming) {
    const known = byId.get(event.id)
    if (!known) { byId.set(event.id, event); continue }
    const undoneAt = [known.undoneAt, event.undoneAt].filter(Boolean).sort()[0]
    const same = (entry: ProgressEvent) => (entry.undoneAt ?? '') === (undoneAt ?? '')
    const synced = Boolean((event.synced && same(event)) || (known.synced && same(known)))
    // Unchanged events keep their identity (callers compare by reference to skip re-renders).
    if (same(known) && Boolean(known.synced) === synced) continue
    byId.set(event.id, { ...known, ...(undoneAt ? { undoneAt } : {}), synced })
  }
  const merged = [...byId.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id))
  return merged.length > max ? merged.slice(merged.length - max) : merged
}

/**
 * Merges another copy (the server's) into this one with the same rules. Remote values keep their own source;
 * no new events are made (the remote copy carries its own history, merged by id).
 */
export function mergeRemoteObjectives<T extends ObjectiveStateShape>(progress: T, remote: { objectives: ObjectiveProgress[]; events: ProgressEvent[] }): T {
  const objectiveProgress = { ...progress.objectiveProgress }
  let changed = false
  for (const value of remote.objectives) {
    const incoming = normalizeObjective(value)
    if (decide(objectiveProgress[incoming.objectiveId], incoming) === 'apply') {
      objectiveProgress[incoming.objectiveId] = incoming
      changed = true
    }
  }
  const remoteEvents = remote.events.map((event) => ({ ...event, synced: true }))
  const progressEvents = mergeEventLists(progress.progressEvents, remoteEvents)
  if (!changed && progressEvents.length === progress.progressEvents.length && progressEvents.every((event, index) => event === progress.progressEvents[index])) return progress
  return { ...progress, objectiveProgress, progressEvents }
}

/** History of one quest for the «История изменений» panel, newest first. */
export function questHistory(progress: Pick<ObjectiveStateShape, 'progressEvents'>, taskId: string, limit = 50) {
  return progress.progressEvents.filter((event) => event.taskId === taskId).slice(-limit).reverse()
}

function clampTarget(value: unknown) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number >= 1 ? Math.min(number, MAX_TARGET) : 1
}
