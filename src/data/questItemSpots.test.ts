import { describe, expect, it } from 'vitest'
import { QUEST_ITEM_SPOTS, withQuestItemSpots, type QuestItemSpots } from './questItemSpots'
import { adaptLiveMapMarkers } from './mapMarkerAdapter'
import { maps } from './demo'
import type { Quest } from '../domain/types'

const STREETS = '5714dc692459777137212e12'
const CENSUS = '639135d89444fb141f4e6eea'
const JOURNAL = '638e0057ab150a5f56238960'
/** tarkov.dev's one spot of «Перепись населения» (json.tarkov.dev regular/tasks, 20.11.2026). */
const LISTED = { x: 80.18001, y: 3.9165, z: 143.7027 }

const censusTask = (objective: Record<string, unknown> = {}) => ({
  id: CENSUS,
  objectives: [
    { id: 'Найти журнал с информацией о жильцах на локации Улицы Таркова', type: 'findQuestItem', questItem: JOURNAL, maps: [STREETS], possibleLocations: [{ map: STREETS, positions: [{ ...LISTED }] }], ...objective },
    { id: 'Передать журнал', type: 'giveQuestItem', questItem: JOURNAL },
  ],
})

describe('quest item spawns tarkov.dev lists only in part, from the SPT database (20.11.2026)', () => {
  it('appends the missing spots after tarkov.dev\'s own, matching the objective by its type and quest item', () => {
    const root = { tasks: { [CENSUS]: censusTask() }, questItems: {} }
    const result = withQuestItemSpots(root)
    const objective = (result.tasks as Record<string, { objectives: Array<{ possibleLocations: Array<{ map: string; positions: unknown[] }> }> }>)[CENSUS]!.objectives[0]!
    expect(objective.possibleLocations).toHaveLength(1)
    // the listed spot first, then the four SPT spots; the giveQuestItem objective is left alone
    expect(objective.possibleLocations[0]!.positions).toHaveLength(5)
    expect(objective.possibleLocations[0]!.positions[0]).toEqual(LISTED)
    expect(objective.possibleLocations[0]!.positions.slice(1).every((position) => (position as { added?: boolean }).added === true)).toBe(true)
    expect((result.tasks as Record<string, { objectives: unknown[] }>)[CENSUS]!.objectives[1]).toEqual(root.tasks[CENSUS].objectives[1])
    expect(result.questItems).toBe(root.questItems)
    // the input is not changed
    expect((root.tasks[CENSUS].objectives[0] as { possibleLocations: Array<{ positions: unknown[] }> }).possibleLocations[0]!.positions).toHaveLength(1)
  })

  it('does not repeat a spot tarkov.dev lists already and returns the same root when nothing is missing', () => {
    const list: QuestItemSpots[] = [{ taskId: CENSUS, questItem: JOURNAL, mapId: STREETS, positions: [{ x: 80.5, y: 3.9, z: 143.6 }] }]
    const root = { tasks: { [CENSUS]: censusTask() } }
    expect(withQuestItemSpots(root, list)).toBe(root)
    expect(withQuestItemSpots({ tasks: {} })).toEqual({ tasks: {} })
  })

  it('reads GraphQL-shaped references and adds the map when the objective has no spot on it', () => {
    const root = { tasks: { [CENSUS]: censusTask({ questItem: { id: JOURNAL }, maps: [], possibleLocations: [] }) } }
    const result = withQuestItemSpots(root) as { tasks: Record<string, { objectives: Array<{ maps: string[]; possibleLocations: Array<{ map: string; positions: unknown[] }> }> }> }
    const objective = result.tasks[CENSUS]!.objectives[0]!
    expect(objective.maps).toEqual([STREETS])
    expect(objective.possibleLocations).toEqual([{ map: STREETS, positions: QUEST_ITEM_SPOTS.find((spots) => spots.taskId === CENSUS)!.positions.map((spot) => ({ ...spot, added: true })) }])
  })

  it('brings each quest to the wiki\'s count of spawns: tarkov.dev\'s plus the added ones', () => {
    // tarkov.dev's counts of 20.11.2026 (PvP, PvE and Season alike) and the wiki's for the live game
    const counts: Record<string, { listed: number; wiki: number }> = {
      '64f3176921045e77405d63b5': { listed: 3, wiki: 8 }, // Фельдшер: one of eight ambulances
      '639135d89444fb141f4e6eea': { listed: 1, wiki: 5 }, // Перепись населения
      '6573397ef3f8344c4575cd87': { listed: 3, wiki: 6 }, // Земельный вопрос
    }
    for (const [taskId, { listed, wiki }] of Object.entries(counts)) {
      expect(QUEST_ITEM_SPOTS.find((spots) => spots.taskId === taskId)!.positions).toHaveLength(wiki - listed)
    }
    // Городская медицина: ten in the garage, two of them listed; one more SPT spot is 0.6 m from a listed one, the same place
    expect(QUEST_ITEM_SPOTS.find((spots) => spots.taskId === '639135e0fa894f0a866afde6')!.positions).toHaveLength(7)
    for (const spots of QUEST_ITEM_SPOTS) {
      expect(spots.mapId).toBe(STREETS)
      expect(spots.positions.every((position) => [position.x, position.y, position.z].every(Number.isFinite))).toBe(true)
    }
  })

  it('no longer shows the census journal as «Спавн 100 %»: it is one of five spots', () => {
    const quests = [{ id: CENSUS, name: 'Перепись населения', trader: 'Терапевт', level: 1, kappa: false, description: '', objectives: [], rewards: [] }] as unknown as Quest[]
    const context = { maps, quests, items: new Map(), mapNameByApiId: new Map([[STREETS, 'streets-of-tarkov']]) }
    const before = adaptLiveMapMarkers({ maps: {} }, { tasks: { [CENSUS]: censusTask() } }, context).filter((marker) => marker.questId === CENSUS)
    expect(before.some((marker) => marker.guaranteedSpawn)).toBe(true)
    const after = adaptLiveMapMarkers({ maps: {} }, withQuestItemSpots({ tasks: { [CENSUS]: censusTask() } }), context).filter((marker) => marker.questId === CENSUS)
    expect(after.length).toBeGreaterThan(0)
    expect(after.some((marker) => marker.guaranteedSpawn)).toBe(false)
    // the point drawn before keeps its id (the owner's point edits find markers by id), though an added spawn is its centre now
    expect(after.map((marker) => marker.id)).toContain(before[0]!.id)
  })
})
