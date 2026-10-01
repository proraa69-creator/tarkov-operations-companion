import { describe, expect, it } from 'vitest'
import graphqlFixture from './__fixtures__/tasks-graphql.json'
import jsonFixture from './__fixtures__/tasks-json.json'
import { adaptGraphqlTaskObjectives, adaptObjectiveDetails, TASK_OBJECTIVES_QUERY } from '../data/objectiveDetails'
import type { GameMap, Quest } from '../domain/types'
import { questMapPoints } from './questMapPoints'
import { addMapPointOverride, hideCatalogPoint, isOverrideStale, objectiveNote, upsertObjectiveNote, type CatalogStamp } from './questOverrides'

/** Upstream map ids (tarkov.dev) → app map ids. */
const MAP_IDS: Record<string, string> = { '56f40101d2720b2a4d8b45d6': 'customs', '5b0fc42d86f7744a585f9105': 'labs' }
const resolve = (id: string) => MAP_IDS[id]
const PEACEKEEPING = '5c0d4c12d09282029f539173'
const BAD_REP = '5967530a86f77462ba22226b'

const labs = { id: 'labs', name: 'Лаборатория', layers: [{ id: 'main', name: 'Основной' }, { name: 'Подвал', heightRange: [-10, -1] }] } as unknown as GameMap

function questsFrom(objectives: Map<string, Quest['objectiveDetails']>): Quest[] {
  return [...objectives].map(([id, objectiveDetails]) => ({ id, name: id, trader: 'Миротворец', level: 1, kappa: false, description: '', objectives: [], rewards: [], objectiveDetails }))
}

describe('objective details from tarkov.dev', () => {
  it('reads the GraphQL shape (references as { id }) and keeps zone geometry', () => {
    expect(TASK_OBJECTIVES_QUERY).toContain('... on TaskObjectiveBasic { zones { id map { id } position { x y z } outline { x y z } top bottom } }')
    const byTask = adaptGraphqlTaskObjectives(graphqlFixture, resolve)
    expect([...byTask.keys()]).toHaveLength(3)
    const [visit, shoot, mark] = byTask.get(PEACEKEEPING)!
    expect(visit).toMatchObject({ id: '5c0d4c12d09282029f539175', type: 'visit', count: 1, mapIds: ['customs'] })
    expect(visit.zones).toEqual([{ id: 'place_peacemaker_007_N1', mapId: 'customs', position: { x: -142.6, y: 0.6, z: 92.1 }, outline: expect.any(Array), top: 6.5, bottom: -2 }])
    expect(shoot).toMatchObject({ type: 'shoot', count: 30 })
    expect(shoot.zones).toBeUndefined()
    // Unknown map and missing position are skipped; empty outline and null top/bottom are left out.
    expect(mark).toMatchObject({ optional: true, itemIds: ['5991b51486f77447b112d44f'] })
    expect(mark.zones).toEqual([{ id: 'un_vehicle', mapId: 'labs', position: { x: 10, y: -4.5, z: 20 } }])
    expect(byTask.get(BAD_REP)![0].itemSpots).toHaveLength(2)
  })

  it('reads the json.tarkov.dev shape (references as plain ids) the app loads', () => {
    const tasks = Object.values(jsonFixture.tasks)
    const objectives = new Map(tasks.map((task) => [task.id, adaptObjectiveDetails(task.objectives, resolve)]))
    const peacekeeping = objectives.get(PEACEKEEPING)!
    expect(peacekeeping.map((entry) => [entry.id, entry.type, entry.count])).toEqual([
      ['5c0d4c12d09282029f539175', 'visit', 1], ['5c0d4c12d09282029f539177', 'shoot', 30], ['5c0d4c12d09282029f539178', 'giveItem', 2],
    ])
    expect(peacekeeping[2]).toMatchObject({ foundInRaid: true, itemIds: ['62a0a16d0b9d3c46de5b6e97'] })
    // Both shapes give the same zones for the same objective.
    expect(peacekeeping[0].zones).toEqual(adaptGraphqlTaskObjectives(graphqlFixture, resolve).get(PEACEKEEPING)![0].zones)
  })
})

describe('questMapPoints', () => {
  const quests = questsFrom(adaptGraphqlTaskObjectives(graphqlFixture, resolve))

  it('gives one normalized row per zone / item spot keyed by task and objective', () => {
    const points = questMapPoints(quests, { maps: [labs] })
    expect(points.map((point) => [point.pointId, point.mapId, point.kind, point.confidence])).toEqual([
      [`${BAD_REP}:5968929e86f7740d121082d3:i0`, 'customs', 'item', 0.5],
      [`${BAD_REP}:5968929e86f7740d121082d3:i1`, 'customs', 'item', 0.5],
      [`${PEACEKEEPING}:5c0d4c12d09282029f539175:place_peacemaker_007_N1`, 'customs', 'zone', 0.9],
      [`${PEACEKEEPING}:5c0d4c12d09282029f539179:un_vehicle`, 'labs', 'zone', 0.9],
    ])
    expect(points[2]).toMatchObject({ taskId: PEACEKEEPING, objectiveId: '5c0d4c12d09282029f539175', top: 6.5, bottom: -2, label: 'Locate the UN checkpoint on Customs', source: 'tarkov.dev' })
    expect(points[2].outline).toHaveLength(4)
    expect(points[3].floorHint).toBe('Подвал')
    expect(points[2].floorHint).toBeUndefined()
  })

  it('filters by task and map', () => {
    expect(questMapPoints(quests, { taskIds: [PEACEKEEPING], mapId: 'customs' }).map((point) => point.objectiveId)).toEqual(['5c0d4c12d09282029f539175'])
    expect(questMapPoints(quests, { taskIds: [] })).toEqual([])
  })

  it('lays user corrections over the catalog points without changing the catalog', () => {
    const catalog: CatalogStamp = { source: 'https://json.tarkov.dev/regular/tasks', version: 'v1' }
    let overrides = hideCatalogPoint([], { taskId: PEACEKEEPING, pointId: `${PEACEKEEPING}:5c0d4c12d09282029f539179:un_vehicle`, mode: 'all', catalog, now: '2026-09-25T10:00:00.000Z' })
    overrides = addMapPointOverride(overrides, { taskId: PEACEKEEPING, objectiveId: '5c0d4c12d09282029f539175', mode: 'pve', point: { mapId: 'customs', x: -140, y: 1, z: 90, label: 'Блокпост за забором' }, pointId: `${PEACEKEEPING}:5c0d4c12d09282029f539175:place_peacemaker_007_N1`, catalog, now: '2026-09-25T10:00:00.000Z' })
    const pve = questMapPoints(quests, { taskIds: [PEACEKEEPING], overrides, mode: 'pve' })
    expect(pve.map((point) => [point.source, point.label, point.confidence])).toEqual([['user', 'Блокпост за забором', 1]])
    // The PvE correction does not leak into PvP; the all-modes hide does.
    const pvp = questMapPoints(quests, { taskIds: [PEACEKEEPING], overrides, mode: 'pvp' })
    expect(pvp.map((point) => point.source)).toEqual(['tarkov.dev'])
    expect(quests[2].objectiveDetails![0].zones).toHaveLength(1)
  })
})

describe('quest override layer', () => {
  const v1: CatalogStamp = { source: 'https://json.tarkov.dev/regular/tasks', version: 'Tue, 01 Sep 2026 10:00:00 GMT' }

  it('keeps notes per objective and mode, removes them with an empty text', () => {
    let list = upsertObjectiveNote([], { taskId: PEACEKEEPING, objectiveId: 'o1', mode: 'all', note: '  Ключ лежит в 206  ', catalog: v1, now: '2026-09-25T10:00:00.000Z' })
    list = upsertObjectiveNote(list, { taskId: PEACEKEEPING, objectiveId: 'o1', mode: 'pve', note: 'В PvE другой путь', catalog: v1 })
    expect(objectiveNote(list, PEACEKEEPING, 'o1', 'pvp')?.note).toBe('Ключ лежит в 206')
    expect(objectiveNote(list, PEACEKEEPING, 'o1', 'pve')?.note).toBe('В PvE другой путь')
    list = upsertObjectiveNote(list, { taskId: PEACEKEEPING, objectiveId: 'o1', mode: 'all', note: 'Обновлено', catalog: v1, now: '2026-09-26T10:00:00.000Z' })
    expect(list).toHaveLength(2)
    expect(objectiveNote(list, PEACEKEEPING, 'o1', 'pvp')).toMatchObject({ note: 'Обновлено', createdAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-26T10:00:00.000Z', source: 'user' })
    expect(upsertObjectiveNote(list, { taskId: PEACEKEEPING, objectiveId: 'o1', mode: 'pve', note: ' ', catalog: v1 })).toHaveLength(1)
  })

  it('flags (never drops) corrections made against an older catalog version', () => {
    const [note] = upsertObjectiveNote([], { taskId: PEACEKEEPING, objectiveId: 'o1', mode: 'all', note: 'x', catalog: v1 })
    const metadata = { source: 'json.tarkov.dev', mode: 'pvp' as const, loadedAt: '2026-10-01T00:00:00.000Z', counts: {} }
    expect(isOverrideStale(note, { ...metadata, sourceVersion: v1.version })).toBe(false)
    expect(isOverrideStale(note, { ...metadata, sourceVersion: 'Thu, 01 Oct 2026 10:00:00 GMT' })).toBe(true)
    expect(isOverrideStale(note, metadata)).toBe(false)
  })
})
