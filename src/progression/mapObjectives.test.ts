import { describe, expect, it } from 'vitest'
import type { ModeProgress, ObjectiveProgress, Quest, QuestObjective } from '../domain/types'
import { progressWith, quest } from '../raidprep/fixtures'
import { mapObjectivesDone, markerObjectiveDone } from './mapObjectives'

const objective = (id: string, type: string, mapIds?: string[]): QuestObjective => ({ id, type, description: id, count: 1, ...(mapIds ? { mapIds } : {}) })
const ticked = (...ids: string[]) => Object.fromEntries(ids.map((id): [string, ObjectiveProgress] => [id, {
  objectiveId: id, taskId: 'butcher', type: 'shoot', target: 1, current: 1, source: 'manual', confidence: 1, observedAt: '2026-10-17T10:00:00.000Z',
}]))

describe('optional objectives on a map', () => {
  const tick = (id: string) => ({ [id]: { objectiveId: id, taskId: 'pyramid', type: 'mark', target: 1, current: 1, source: 'manual' as const, confidence: 1, observedAt: '2026-11-04T06:00:00.000Z' } })
  const progressWith = (ids: string[]) => ({ taskProgress: {}, objectiveProgress: Object.assign({}, ...ids.map(tick)) }) as unknown as ModeProgress
  const objective = (id: string, optional?: boolean) => ({ id, type: optional ? 'visit' : 'mark', description: id, count: 1, mapIds: ['streets-of-tarkov'], ...(optional ? { optional } : {}) })
  const quest = (objectiveDetails: Quest['objectiveDetails']) => ({ id: 'pyramid', objectiveDetails }) as Quest

  it('hold nothing open: the required one done, the quest is done on this map', () => {
    const pyramid = quest([objective('mark'), objective('atm-1', true), objective('atm-2', true)])
    expect(mapObjectivesDone(pyramid, 'streets-of-tarkov', progressWith([]))).toBe(false)
    expect(mapObjectivesDone(pyramid, 'streets-of-tarkov', progressWith(['atm-1']))).toBe(false)
    expect(mapObjectivesDone(pyramid, 'streets-of-tarkov', progressWith(['mark']))).toBe(true)
  })

  it('a quest of optional ones only waits for all of them', () => {
    const optional = quest([objective('atm-1', true), objective('atm-2', true)])
    expect(mapObjectivesDone(optional, 'streets-of-tarkov', progressWith(['atm-1']))).toBe(false)
    expect(mapObjectivesDone(optional, 'streets-of-tarkov', progressWith(['atm-1', 'atm-2']))).toBe(true)
  })
})

describe('objectives ticked by hand, per map', () => {
  const butcher = quest('butcher', 'Потрошитель', {
    mapIds: ['factory', 'lighthouse'],
    objectiveDetails: [objective('kill-factory', 'shoot', ['night-factory']), objective('kill-lighthouse', 'shoot', ['lighthouse']), objective('give', 'giveItem')],
  })

  it('a map whose objectives are all ticked is done; the quest stays open for its other map', () => {
    const progress = progressWith({ butcher: 'active' }, { objectiveProgress: ticked('kill-lighthouse') })
    expect(mapObjectivesDone(butcher, 'lighthouse', progress)).toBe(true)
    expect(mapObjectivesDone(butcher, 'factory', progress)).toBe(false)
    expect(progress.taskProgress.butcher.status).toBe('active')
  })

  it('nothing ticked, or a map the quest has no objective on, is not done', () => {
    const progress = progressWith({ butcher: 'active' })
    expect(mapObjectivesDone(butcher, 'lighthouse', progress)).toBe(false)
    expect(mapObjectivesDone(butcher, 'customs', progress)).toBe(false)
  })

  it('«Любая карта»: in-raid objectives without a map count everywhere, the hand-over does not', () => {
    const anywhere = quest('any', 'Любая', { anyMap: true, objectiveDetails: [objective('kill', 'shoot'), objective('give', 'giveItem')] })
    expect(mapObjectivesDone(anywhere, 'customs', progressWith({ any: 'active' }, { objectiveProgress: ticked('kill') }))).toBe(true)
  })

  it('a point of a ticked objective is done; points of other objectives or without one are not', () => {
    const progress = progressWith({ butcher: 'active' }, { objectiveProgress: ticked('kill-lighthouse') })
    expect(markerObjectiveDone({ questId: 'butcher', objectiveId: 'kill-lighthouse' }, progress)).toBe(true)
    expect(markerObjectiveDone({ questId: 'butcher', objectiveId: 'kill-factory' }, progress)).toBe(false)
    expect(markerObjectiveDone({ questId: 'butcher' }, progress)).toBe(false)
  })
})
