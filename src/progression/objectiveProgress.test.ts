import { describe, expect, it } from 'vitest'
import { createLocalProfile, createModeProgress, migrateProfile, normalizeTaskKeys } from '../domain/progress'
import type { ModeProgress, ObjectiveProgress, Quest } from '../domain/types'
import {
  applyObjectiveChange,
  canUndo,
  decide,
  logCompletionConflicts,
  manualObjectiveValue,
  mergeRemoteObjectives,
  objectiveViews,
  questHistory,
  questObjectiveDefs,
  resolveObjectiveConflict,
  taskStatusEvents,
  undoProgressEvent,
} from './objectiveProgress'

const TASK = '5936d90786f7742b1420ba5b'
const quest: Quest = {
  id: TASK, name: 'Сдача', trader: 'Прапор', level: 1, kappa: true, description: '', rewards: [],
  objectives: ['Убить 5 Диких', 'Передать 2 ружья'],
  objectiveDetails: [
    { id: 'obj-kill', type: 'shoot', description: 'Убить 5 Диких', count: 5 },
    { id: 'obj-give', type: 'giveItem', description: 'Передать 2 ружья', count: 2, itemIds: ['mp133'] },
  ],
}
const at = (hour: number) => `2026-09-25T${String(hour).padStart(2, '0')}:00:00.000Z`
const value = (objectiveId: string, current: number, source: ObjectiveProgress['source'], hour: number, target = 5): ObjectiveProgress =>
  ({ objectiveId, taskId: TASK, type: 'shoot', target, current, source, confidence: source === 'manual' ? 1 : 0.7, observedAt: at(hour) })

describe('objective identity', () => {
  it('uses tarkov.dev objective ids and counts; names are display only', () => {
    expect(questObjectiveDefs(quest).map((def) => [def.id, def.target, def.stableId])).toEqual([['obj-kill', 5, true], ['obj-give', 2, true]])
    const renamed = { ...quest, name: 'Renamed', objectiveDetails: quest.objectiveDetails!.map((entry) => ({ ...entry, description: `${entry.description} (EN)` })) }
    expect(questObjectiveDefs(renamed).map((def) => def.id)).toEqual(['obj-kill', 'obj-give'])
  })

  it('falls back to position ids (marked unstable) for catalogs without objective ids', () => {
    const plain: Quest = { ...quest, objectiveDetails: undefined, objectiveIds: undefined }
    expect(questObjectiveDefs(plain).map((def) => [def.id, def.stableId])).toEqual([[`${TASK}#0`, false], [`${TASK}#1`, false]])
    expect(questObjectiveDefs({ ...quest, kind: 'story', stages: [] })).toEqual([])
  })
})

describe('conflict rules', () => {
  it('manual beats automatic; automatic never overwrites manual', () => {
    expect(decide(value('a', 3, 'ocr', 12), value('a', 1, 'manual', 9))).toBe('apply')
    expect(decide(value('a', 1, 'manual', 9), value('a', 3, 'ocr', 12))).toBe('ignore')
    expect(decide(value('a', 1, 'manual', 9), value('a', 2, 'sync', 12))).toBe('ignore')
  })

  it('newer beats older within the same source; equal time goes to the higher confidence', () => {
    expect(decide(value('a', 3, 'ocr', 10), value('a', 4, 'ocr', 11))).toBe('apply')
    expect(decide(value('a', 3, 'ocr', 10), value('a', 4, 'ocr', 9))).toBe('ignore')
    expect(decide(value('a', 3, 'manual', 10), value('a', 1, 'manual', 11))).toBe('apply')
    expect(decide(value('a', 3, 'ocr', 10), { ...value('a', 4, 'log', 10), confidence: 0.95 })).toBe('apply')
    expect(decide(value('a', 3, 'ocr', 10), value('a', 3, 'ocr', 11))).toBe('unchanged')
  })

  it('a log completion over a manual «not done» becomes a question, not an overwrite', () => {
    expect(decide(value('a', 2, 'manual', 9), value('a', 5, 'log', 12))).toBe('conflict')
    const manual = applyObjectiveChange(createModeProgress(), 'pvp', value('obj-kill', 2, 'manual', 9)).progress
    const asked = applyObjectiveChange(manual, 'pvp', value('obj-kill', 5, 'log', 12))
    expect(asked.decision).toBe('conflict')
    expect(asked.progress.objectiveProgress['obj-kill'].current).toBe(2)
    expect(asked.progress.objectiveConflicts).toHaveLength(1)

    const accepted = resolveObjectiveConflict(asked.progress, 'pvp', 'obj-kill', true, at(13))
    expect(accepted.objectiveProgress['obj-kill']).toMatchObject({ current: 5, source: 'log', completedAt: at(12), observedAt: at(13) })
    expect(accepted.objectiveConflicts).toEqual([])
    expect(accepted.progressEvents.at(-1)).toMatchObject({ eventType: 'conflict-resolved', oldValue: 2, newValue: 5, reversible: true })

    const kept = resolveObjectiveConflict(asked.progress, 'pvp', 'obj-kill', false, at(13))
    expect(kept.objectiveProgress['obj-kill']).toMatchObject({ current: 2, source: 'manual' })
    expect(kept.objectiveConflicts).toEqual([])
  })

  it('a logged quest completion asks only about objectives the user marked as not done', () => {
    let progress = applyObjectiveChange(createModeProgress(), 'pvp', value('obj-kill', 2, 'manual', 9)).progress
    progress = applyObjectiveChange(progress, 'pvp', value('obj-give', 2, 'manual', 9, 2)).progress
    const next = logCompletionConflicts(progress, 'pvp', [TASK], at(12))
    expect(next.objectiveConflicts.map((conflict) => conflict.objectiveId)).toEqual(['obj-kill'])
    expect(next.objectiveProgress).toEqual(progress.objectiveProgress)
  })
})

describe('progress events and undo', () => {
  it('records provenance and undoes an automatic change as the user’s own value', () => {
    const first = applyObjectiveChange(createModeProgress(), 'pve', value('obj-kill', 1, 'ocr', 10), { eventId: 'ev-1' })
    const second = applyObjectiveChange(first.progress, 'pve', value('obj-kill', 4, 'ocr', 11), { eventId: 'ev-2' })
    expect(second.event).toMatchObject({ id: 'ev-2', mode: 'pve', taskId: TASK, objectiveId: 'obj-kill', eventType: 'objective', oldValue: 1, newValue: 4, source: 'ocr', reversible: true })
    expect(canUndo(second.event!)).toBe(true)

    const undone = undoProgressEvent(second.progress, 'ev-2', at(12))
    expect(undone.objectiveProgress['obj-kill']).toMatchObject({ current: 1, source: 'manual', observedAt: at(12) })
    expect(undone.progressEvents.find((event) => event.id === 'ev-2')?.undoneAt).toBe(at(12))
    expect(undone.progressEvents.at(-1)).toMatchObject({ eventType: 'undo', refersTo: 'ev-2', oldValue: 4, newValue: 1, source: 'manual' })
    // The next automatic reading does not re-apply what was undone.
    expect(applyObjectiveChange(undone, 'pve', value('obj-kill', 4, 'ocr', 13)).decision).toBe('ignore')
    // Undone once; manual changes are not undoable.
    expect(undoProgressEvent(undone, 'ev-2')).toBe(undone)
    const manual = applyObjectiveChange(undone, 'pve', manualObjectiveValue({ id: 'obj-kill', taskId: TASK, type: 'shoot', target: 5 }, 3, at(14)))
    expect(canUndo(manual.event!)).toBe(false)
    expect(questHistory(manual.progress, TASK).map((event) => event.eventType)).toEqual(['objective', 'undo', 'objective', 'objective'])
  })

  it('records quest status changes from the logs; an undo writes the previous status back', () => {
    const before = createModeProgress()
    before.taskProgress[TASK] = { taskId: TASK, status: 'active', source: 'eft-log', updatedAt: at(9) }
    const after: ModeProgress = { ...before, taskProgress: { [TASK]: { taskId: TASK, status: 'completed', source: 'eft-log', updatedAt: at(10) } } }
    const events = taskStatusEvents(before.taskProgress, after.taskProgress, 'pvp', at(11))
    expect(events).toEqual([expect.objectContaining({ taskId: TASK, eventType: 'task-status', oldValue: 'active', newValue: 'completed', source: 'log', observedAt: at(10), reversible: true })])
    const withEvents = { ...after, progressEvents: events }
    const undone = undoProgressEvent(withEvents, events[0].id, at(12))
    expect(undone.taskProgress[TASK]).toEqual({ taskId: TASK, status: 'active', source: 'manual', updatedAt: at(12) })
    // A quest that appears for the first time has nothing to go back to.
    expect(taskStatusEvents({}, after.taskProgress, 'pvp', at(11))[0].reversible).toBe(false)
  })

  it('shows objectives of a logged completed quest as done (derived) and stored values otherwise', () => {
    const progress = createModeProgress()
    expect(objectiveViews(quest, progress).map((view) => [view.current, view.done])).toEqual([[0, false], [0, false]])
    progress.taskProgress[TASK] = { taskId: TASK, status: 'completed', source: 'eft-log', updatedAt: at(9) }
    expect(objectiveViews(quest, progress).map((view) => [view.current, view.done, view.source, view.derived])).toEqual([[5, true, 'log', true], [2, true, 'log', true]])
    const edited = applyObjectiveChange(progress, 'pvp', value('obj-kill', 3, 'manual', 10)).progress
    expect(objectiveViews(quest, edited)[0]).toMatchObject({ current: 3, done: false, source: 'manual', derived: false })
  })
})

describe('server merge', () => {
  it('merges the server copy with the same rules and unions the history by id', () => {
    let local = applyObjectiveChange(createModeProgress(), 'pvp', value('obj-kill', 2, 'manual', 9), { eventId: 'ev-local' }).progress
    local = applyObjectiveChange(local, 'pvp', value('obj-give', 0, 'ocr', 9, 2), { eventId: 'ev-local-2' }).progress
    const remote = {
      objectives: [value('obj-kill', 5, 'ocr', 12), value('obj-give', 2, 'manual', 8, 2)],
      events: [{ id: 'ev-remote', mode: 'pvp' as const, taskId: TASK, objectiveId: 'obj-give', eventType: 'objective' as const, oldValue: 0, newValue: 2, source: 'manual' as const, confidence: 1, observedAt: at(8), reversible: false }],
    }
    const merged = mergeRemoteObjectives(local, remote)
    expect(merged.objectiveProgress['obj-kill']).toMatchObject({ current: 2, source: 'manual' })
    expect(merged.objectiveProgress['obj-give']).toMatchObject({ current: 2, source: 'manual' })
    expect(merged.progressEvents.map((event) => event.id)).toEqual(['ev-remote', 'ev-local', 'ev-local-2'])
    expect(merged.progressEvents.find((event) => event.id === 'ev-remote')?.synced).toBe(true)
    expect(merged.progressEvents.find((event) => event.id === 'ev-local')?.synced).toBeFalsy()
    // Same copy again: nothing changes (no re-render loop).
    expect(mergeRemoteObjectives(merged, remote)).toBe(merged)
    // The server echo of a local event marks it synced; an undo on either side is kept.
    const echoed = mergeRemoteObjectives(merged, { objectives: [], events: [{ ...merged.progressEvents[1], undoneAt: at(13) }] })
    expect(echoed.progressEvents[1]).toMatchObject({ id: 'ev-local', synced: true, undoneAt: at(13) })
  })
})

describe('profile migration v5 → v6', () => {
  it('keeps every v5 value and adds empty objective state', () => {
    const v5 = JSON.parse(JSON.stringify(createLocalProfile('Operator', 'p1'))) as Record<string, unknown> & { modes: Record<string, Record<string, unknown>> }
    v5.schemaVersion = 5
    for (const mode of Object.values(v5.modes)) { delete mode.objectiveProgress; delete mode.progressEvents; delete mode.objectiveConflicts }
    v5.modes.pve.taskProgress = { [TASK]: { taskId: TASK, status: 'completed', source: 'eft-log', updatedAt: at(9) }, story: { taskId: 'story', status: 'active', source: 'manual', updatedAt: at(9), currentStageIndex: 2 } }
    v5.modes.pve.trackedTaskIds = [TASK]
    v5.modes.pve.hideoutLevels = { lavatory: 2 }
    v5.modes.pve.logCharacterId = '0123456789abcdef01234567'
    const migrated = migrateProfile(v5)!
    expect(migrated.schemaVersion).toBe(6)
    expect(migrated.modes.pve.taskProgress).toEqual(v5.modes.pve.taskProgress)
    expect(migrated.modes.pve.trackedTaskIds).toEqual([TASK])
    expect(migrated.modes.pve.hideoutLevels).toEqual({ lavatory: 2 })
    expect(migrated.modes.pve.logCharacterId).toBe('0123456789abcdef01234567')
    expect(migrated.modes.pve).toMatchObject({ objectiveProgress: {}, progressEvents: [], objectiveConflicts: [] })
    expect(migrated.modes.pvp.taskProgress).toEqual({})
  })

  it('round-trips v6 objective state and drops malformed rows only', () => {
    const profile = createLocalProfile('Operator', 'p2')
    profile.modes.seasonal = applyObjectiveChange(profile.modes.seasonal, 'seasonal', value('obj-kill', 3, 'ocr', 10), { eventId: 'ev-s' }).progress
    const stored = JSON.parse(JSON.stringify(profile)) as typeof profile
    ;(stored.modes.seasonal.objectiveProgress as Record<string, unknown>).broken = { objectiveId: 'broken' }
    ;(stored.modes.seasonal.progressEvents as unknown[]).push({ id: 'bad' })
    const migrated = migrateProfile(stored)!
    expect(migrated.modes.seasonal.objectiveProgress).toEqual(profile.modes.seasonal.objectiveProgress)
    expect(migrated.modes.seasonal.progressEvents).toEqual(profile.modes.seasonal.progressEvents)
    expect(migrated.modes.pvp.objectiveProgress).toEqual({})
  })

  it('rewrites legacy slug keys to task ids without dropping unknown keys', () => {
    const progress = createModeProgress()
    progress.taskProgress['debut'] = { taskId: 'debut', status: 'completed', source: 'migration', updatedAt: at(9) }
    progress.taskProgress['unknown-slug'] = { taskId: 'unknown-slug', status: 'completed', source: 'migration', updatedAt: at(9) }
    progress.trackedTaskIds = ['debut', TASK, 'unknown-slug']
    const catalog: Quest[] = [{ ...quest, normalizedName: 'debut' }]
    const next = normalizeTaskKeys(progress, catalog)
    expect(Object.keys(next.taskProgress).sort()).toEqual([TASK, 'unknown-slug'].sort())
    expect(next.taskProgress[TASK].taskId).toBe(TASK)
    expect(next.trackedTaskIds).toEqual([TASK, 'unknown-slug'])
    expect(normalizeTaskKeys(next, catalog)).toBe(next)
  })
})
