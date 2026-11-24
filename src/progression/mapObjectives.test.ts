import { describe, expect, it } from 'vitest'
import type { ModeProgress, ObjectiveProgress, Quest, QuestObjective } from '../domain/types'
import { progressWith, quest } from '../raidprep/fixtures'
import { mapObjectivesClosed, mapObjectivesDone, mapObjectivesWaiting, markerObjectiveDone } from './mapObjectives'

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

// Report 165 (owner, 15.11.2026): «на таможне у него надо забрать предмет, а потом в следующем рейде заложить его в лесу… пока он
// не выполнил цель на таможне и не поставил галочку, у него не появляется вторая цель на лесу».
describe('an objective that waits for the one before it on another map', () => {
  const step = (id: string, type: string, mapIds: string[], itemIds?: string[]): QuestObjective => ({ ...objective(id, type, mapIds), ...(itemIds ? { itemIds } : {}) })
  const courier = quest('courier', 'Курьер', {
    mapIds: ['customs', 'woods'],
    objectiveDetails: [step('pick', 'findQuestItem', ['customs'], ['parcel']), step('plant', 'plantQuestItem', ['woods'], ['parcel']), objective('give', 'giveItem')],
  })
  const tickedAs = (...ids: string[]) => progressWith({ courier: 'active' }, { objectiveProgress: Object.fromEntries(Object.entries(ticked(...ids)).map(([id, entry]) => [id, { ...entry, taskId: 'courier' }])) })

  it('is not on its map until the one before is ticked; then the first map is done and the second open', () => {
    expect(mapObjectivesWaiting(courier, 'woods', tickedAs())).toBe(true)
    expect(mapObjectivesClosed(courier, 'woods', tickedAs())).toBe(true)
    expect(mapObjectivesClosed(courier, 'customs', tickedAs())).toBe(false)
    expect(mapObjectivesClosed(courier, 'customs', tickedAs('pick'))).toBe(true)
    expect(mapObjectivesWaiting(courier, 'woods', tickedAs('pick'))).toBe(false)
    expect(mapObjectivesClosed(courier, 'woods', tickedAs('pick'))).toBe(false)
  })

  it('objectives on two maps that share no item stay side by side', () => {
    const butcher = quest('butcher', 'Потрошитель', { objectiveDetails: [objective('kill-factory', 'shoot', ['factory']), objective('kill-lighthouse', 'shoot', ['lighthouse'])] })
    expect(mapObjectivesWaiting(butcher, 'lighthouse', progressWith({ butcher: 'active' }))).toBe(false)
    expect(mapObjectivesWaiting(butcher, 'factory', progressWith({ butcher: 'active' }))).toBe(false)
  })

  // a player, 19.11.2026: «не отображает в подготовке к рейду что нужно взять вифи камеры… и так же на карте его нет»
  it('the same item planted on several maps: every map open at once («Что-то мне это напоминает...»)', () => {
    const reference = quest('reference', 'Что-то мне это напоминает...', {
      mapIds: ['streets-of-tarkov', 'customs', 'lighthouse'],
      objectiveDetails: [step('cam-streets', 'plantItem', ['streets-of-tarkov'], ['wifi-camera']), step('cam-customs', 'plantItem', ['customs'], ['wifi-camera']),
        step('cam-lighthouse', 'plantItem', ['lighthouse'], ['wifi-camera'])],
    })
    for (const map of ['streets-of-tarkov', 'customs', 'lighthouse']) expect(mapObjectivesClosed(reference, map, progressWith({ reference: 'active' }))).toBe(false)
  })

  it('an item found on any map holds nothing back, nor does a map the quest has nothing on', () => {
    const anywhere = quest('anywhere', 'Где угодно', { objectiveDetails: [step('find', 'findItem', [], ['p22']), step('plant', 'plantItem', ['lighthouse'], ['p22'])] })
    expect(mapObjectivesWaiting(anywhere, 'lighthouse', progressWith({ anywhere: 'active' }))).toBe(false)
    expect(mapObjectivesWaiting(courier, 'shoreline', tickedAs())).toBe(false)
  })
})

