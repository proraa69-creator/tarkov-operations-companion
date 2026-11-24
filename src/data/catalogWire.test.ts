import { describe, expect, it } from 'vitest'
import type { AppDataset, MapMarker, Quest } from '../domain/types'
import { catalogForWire, catalogFromWire } from './catalogWire'

const marker = (id: string, layerId: MapMarker['layerId'], type: MapMarker['type'] = 'landmark'): MapMarker => ({ id, mapId: 'reserve', type, layerId, title: id, description: '', position: [0, 0] })
const dataset = (markers: MapMarker[], quests: Quest[] = []) => ({ maps: [], markers, quests, items: [], hideout: [], traders: [] }) as AppDataset

describe('the catalog on the wire (owner, 02.11.2026: an older app fell on «Карты» over the «Рубильники» layer)', () => {
  it('sends a newer layer as one every app knows, and the app puts it back', () => {
    const own = dataset([marker('d2', 'switch'), marker('exit', 'extract.pmc', 'extract')])
    const wire = catalogForWire(own)
    expect(wire.markers.map((entry) => [entry.layerId, entry.wireLayer])).toEqual([['landmark', 'switch'], ['extract.pmc', undefined]])
    const back = catalogFromWire(wire)
    expect(back.markers).toEqual(own.markers)
    expect('wireLayer' in back.markers[0]).toBe(false)
  })

  it('sends a build guide without another site\'s picture and page, its parts kept (owner, 06.11.2026)', () => {
    const quest = { id: 'gunsmith', objectiveDetails: [
      { id: 'o', type: 'buildWeapon', description: '', count: 1, build: { weaponId: 'w', partIds: [], attributes: [], guide: { source: 'tarkov.help', url: 'https://example.test/q', image: 'https://raidos.app/v1/guide-images/a.png', parts: [{ itemId: 'p', name: 'P', sellers: [] }] } } },
      { id: 'plain', type: 'visit', description: '', count: 1 },
    ] } as unknown as Quest
    const wire = catalogForWire(dataset([], [quest]))
    const guide = wire.quests[0].objectiveDetails![0].build!.guide!
    expect(guide).toEqual({ source: 'tarkov.help', parts: [{ itemId: 'p', name: 'P', sellers: [] }] })
    expect(wire.quests[0].objectiveDetails![1]).toBe(quest.objectiveDetails![1])
    // The catalog in the server's hands keeps them.
    expect(quest.objectiveDetails![0].build!.guide!.image).toBeTruthy()
  })

  it('leaves a catalog without such markers as it is', () => {
    const plain = dataset([marker('exit', 'extract.pmc', 'extract')])
    expect(catalogForWire(plain)).toBe(plain)
    expect(catalogFromWire(plain)).toBe(plain)
  })
})

describe('objectives under the game\'s own id (owner, 02.11.2026: «Сделай … постоянные id целей»)', () => {
  const HELI = '6179ac7511973d018217d0bd'
  const MARK = '6179ac7511973d018217d0be'
  const quest = (): Quest => ({
    id: 'simple-task', normalizedName: 'simple-task', name: 'Простая задача', trader: 'Прапор', level: 21, kappa: false, description: '',
    objectives: ['Найти вертолет, на водоочистной станции', 'Пометить вертолет Маркером MS2000', 'Сдать «Флешку»'],
    // the server's catalog: the translated text as every older app keys its ticks, the game's id beside it
    objectiveIds: ['Найти вертолет, на водоочистной станции', 'Пометить вертолет Маркером MS2000', 'simple-task-objective-3'],
    objectiveDetails: [
      { id: 'Найти вертолет, на водоочистной станции', gameId: HELI, type: 'visit', description: 'Найти вертолет, на водоочистной станции', count: 1 },
      { id: 'Пометить вертолет Маркером MS2000', gameId: MARK, type: 'mark', description: 'Пометить вертолет Маркером MS2000', count: 1 },
      { id: 'simple-task-objective-3', type: 'giveItem', description: 'Сдать «Флешку»', count: 1 },
    ],
    raidRequirements: [{ itemId: 'ms2000', count: 1, purpose: 'mark', mapIds: ['lighthouse'], objectiveId: 'Пометить вертолет Маркером MS2000' }],
    rewards: [], requiredItems: [], previous: [],
  }) as Quest
  const point = (id: string, objectiveId: string): MapMarker => ({ ...marker(id, 'quest.zone', 'quest'), questId: 'simple-task', objectiveId })

  it('the app takes the game\'s id for the objective, its requirement and its map points, and keeps the text as legacyId', () => {
    const wire = dataset([point('heli', 'Найти вертолет, на водоочистной станции'), point('own', 'simple-task-objective-3')], [quest()])
    const app = catalogFromWire(wire)
    const [simple] = app.quests
    expect(simple.objectiveIds).toEqual([HELI, MARK, 'simple-task-objective-3'])
    expect(simple.objectiveDetails!.map((objective) => [objective.id, objective.legacyId, 'gameId' in objective])).toEqual([
      [HELI, 'Найти вертолет, на водоочистной станции', false],
      [MARK, 'Пометить вертолет Маркером MS2000', false],
      ['simple-task-objective-3', undefined, false],
    ])
    expect(simple.raidRequirements![0].objectiveId).toBe(MARK)
    expect(app.markers.map((entry) => entry.objectiveId)).toEqual([HELI, 'simple-task-objective-3'])
    // read back from the cache, the app's own copy stays as it is
    expect(catalogFromWire(app)).toBe(app)
  })

  it('two objectives with the same text keep their own ids', () => {
    const twin = quest()
    twin.objectiveIds = ['Найти вертолет, на водоочистной станции', 'Найти вертолет, на водоочистной станции']
    twin.objectiveDetails = [
      { id: 'Найти вертолет, на водоочистной станции', gameId: HELI, type: 'visit', description: 'Найти вертолет, на водоочистной станции', count: 1 },
      { id: 'Найти вертолет, на водоочистной станции', gameId: MARK, type: 'visit', description: 'Найти вертолет, на водоочистной станции', count: 1 },
    ]
    expect(catalogFromWire(dataset([], [twin])).quests[0].objectiveIds).toEqual([HELI, MARK])
  })

  // «Недоброжелатель»: «Установить Подавитель сигналов на источник» twice, one point and one suppressor each. Under one id a
  // tick took both points and both suppressors off, and the second tick nothing.
  describe('requirements and points of two objectives with the same text', () => {
    const TEXT = 'Установить Подавитель сигналов на источник'
    const twin = (raidRequirements: Quest['raidRequirements']): Quest => ({
      ...quest(),
      objectiveIds: [TEXT, TEXT],
      objectiveDetails: [
        { id: TEXT, gameId: HELI, type: 'mark', description: TEXT, count: 1 },
        { id: TEXT, gameId: MARK, type: 'mark', description: TEXT, count: 1 },
      ],
      raidRequirements,
    })
    const row = (itemId: string) => ({ itemId, count: 1, purpose: 'mark' as const, mapIds: ['shoreline'], objectiveId: TEXT })

    it('each requirement and each point takes its own objective\'s id, in order', () => {
      const app = catalogFromWire(dataset([point('first', TEXT), point('second', TEXT)], [twin([row('jammer'), row('jammer')])]))
      expect(app.quests[0].raidRequirements!.map((requirement) => requirement.objectiveId)).toEqual([HELI, MARK])
      expect(app.markers.map((entry) => entry.objectiveId)).toEqual([HELI, MARK])
    })

    it('a key both of them need lists each by its own id', () => {
      const key = { itemId: 'door', count: 1, purpose: 'key' as const, mapIds: ['shoreline'], objectiveId: TEXT, objectiveIds: [TEXT, TEXT] }
      const app = catalogFromWire(dataset([], [twin([key])]))
      expect(app.quests[0].raidRequirements![0]).toMatchObject({ objectiveId: HELI, objectiveIds: [HELI, MARK] })
    })

    it('an objective that accepts two items keeps both rows under its id', () => {
      const app = catalogFromWire(dataset([], [twin([row('jammer'), row('jammer-new'), row('jammer'), row('jammer-new')])]))
      expect(app.quests[0].raidRequirements!.map((requirement) => requirement.objectiveId)).toEqual([HELI, HELI, MARK, MARK])
    })

    it('points that do not pair with the objectives one to one stay under the first id', () => {
      const app = catalogFromWire(dataset([point('first', TEXT), point('second', TEXT), point('third', TEXT)], [twin([])]))
      expect(app.markers.map((entry) => entry.objectiveId)).toEqual([HELI, HELI, HELI])
    })
  })
})
