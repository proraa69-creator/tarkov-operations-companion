import { describe, expect, it } from 'vitest'
import { adaptLiveMapMarkers } from './mapMarkerAdapter'
import { maps } from './demo'
import type { Quest } from '../domain/types'

describe('live map catalog resilience', () => {
  it('does not lose the catalog when a boss has no spawn coordinates', () => {
    const context = { maps, quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
    const result = adaptLiveMapMarkers({ maps: { customs: { normalizedName: 'customs', bosses: [{ spawnLocations: [{ positions: [] }] }], extracts: [{ id: 'exit', faction: 'pmc', position: { x: 10, y: 0, z: 20 } }] } } }, {}, context)
    expect(result).toHaveLength(1)
    expect(result[0].position).toEqual([20, 10])
    expect(result[0].meta).toBe('Выход ЧВК')
  })

  it('attaches boss portrait, gear, chance and escorts from tarkov.dev mobs', () => {
    const items = new Map([['gun', { id: 'gun', name: 'Автомат АК-101', shortName: 'АК-101', category: 'Оружие' as const, description: '', prices: [], iconUrl: 'https://assets.tarkov.dev/gun-icon.webp' }]])
    const context = { maps, quests: [], items, mapNameByApiId: new Map<string, string>() }
    const result = adaptLiveMapMarkers({
      mobs: {
        bossBully: { name: 'Решала', normalizedName: 'reshala', imagePortraitLink: 'https://assets.tarkov.dev/reshala-portrait.webp', health: [{ max: 500 }, { max: 252 }], equipment: [{ item: 'gun', attributes: { slot: 'FirstPrimaryWeapon' } }] },
        followerBully: { name: 'Охранник Решалы', normalizedName: 'reshala-guard' },
      },
      maps: { customs: { normalizedName: 'customs', bosses: [{ mob: 'Решала', spawnChance: 0.6, escorts: [{ mob: 'followerBully', amount: [{ chance: 1, count: 4 }] }], spawnLocations: [{ name: 'ZoneDormitory', chance: 0.33, positions: [{ x: 181, y: 0, z: 178 }] }] }] } },
    }, {}, context)
    const boss = result.find((marker) => marker.layerId === 'boss')
    expect(boss?.title).toBe('Решала')
    expect(boss?.boss).toMatchObject({
      key: 'reshala',
      portraitUrl: 'https://assets.tarkov.dev/reshala-portrait.webp',
      spawnChance: 0.6,
      locationChance: 0.33,
      locationName: 'Dormitory',
      escorts: ['Охранник Решалы ×4'],
      health: 752,
      gear: [{ name: 'АК-101', iconUrl: 'https://assets.tarkov.dev/gun-icon.webp', slot: 'FirstPrimaryWeapon' }],
    })
  })

  it('shows Knight as «Кочевники» with all three members and adds Sanitar in the Shoreline resort', () => {
    const context = { maps, quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
    const result = adaptLiveMapMarkers({
      mobs: {
        bossKnight: { name: 'Knight', normalizedName: 'knight', imagePortraitLink: 'https://assets.tarkov.dev/knight-portrait.png' },
        followerBigPipe: { name: 'Big Pipe', normalizedName: 'big-pipe' },
        followerBirdEye: { name: 'Birdeye', normalizedName: 'birdeye' },
        bossSanitar: { name: 'Санитар', normalizedName: 'sanitar' },
      },
      maps: { shoreline: { normalizedName: 'shoreline', bosses: [
        { mob: 'Knight', spawnChance: 0.2, escorts: [{ mob: 'Big Pipe', amount: [{ count: 1 }] }, { mob: 'Birdeye', amount: [{ count: 1 }] }], spawnLocations: [{ name: 'ZoneMeteoStation', positions: [{ x: -527, y: -27, z: 287 }] }] },
        { mob: 'Санитар', spawnChance: 0.6, spawnLocations: [{ name: 'ZonePort', positions: [{ x: -323, y: -62, z: 498 }] }] },
      ] } },
    }, {}, context)
    const goons = result.find((marker) => marker.boss?.key === 'knight')
    expect(goons?.title).toBe('Кочевники')
    expect(goons?.boss?.escorts).toEqual(['Knight', 'Big Pipe', 'Birdeye'])
    const sanitar = result.filter((marker) => marker.boss?.key === 'sanitar').map((marker) => marker.boss?.locationName)
    expect(sanitar).toEqual(['Port', 'Санаторий (главный корпус)'])
  })

  it('labels extracts, scav exits and transits in Russian', () => {
    const context = {
      maps,
      quests: [],
      items: new Map(),
      mapNameByApiId: new Map([['5704e5fad2720bc05b8b4567', 'reserve']]),
    }
    const result = adaptLiveMapMarkers({
      maps: {
        customs: {
          normalizedName: 'customs',
          extracts: [
            { id: 'pmc-exit', faction: 'pmc', name: 'Crossroads', position: { x: 10, y: 0, z: 20 } },
            { id: 'scav-exit', faction: 'scav', name: 'Trailer Park', position: { x: 12, y: 0, z: 22 } },
          ],
          transits: [{ id: 'to-reserve', map: '5704e5fad2720bc05b8b4567', position: { x: 15, y: 0, z: 25 } }],
        },
      },
    }, {}, context)
    expect(result.map((marker) => marker.meta)).toEqual(expect.arrayContaining(['Выход ЧВК', 'Выход Диких', 'Переход']))
    expect(result.find((marker) => marker.layerId === 'transit')?.title).toBe('Переход на карту Резерв')
  })

  it('shows an exit listed for both factions at one spot as a single PMC exit', () => {
    const context = { maps, quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
    const result = adaptLiveMapMarkers({
      maps: {
        woods: {
          normalizedName: 'woods',
          extracts: [
            { id: 'outskirts-pmc', faction: 'pmc', name: 'Outskirts', position: { x: 349.04, y: -9.15, z: 358.58 } },
            { id: 'outskirts-scav', faction: 'scav', name: 'Outskirts', position: { x: 347.16, y: -11.15, z: 360.07 } },
            { id: 'house', faction: 'scav', name: 'Scav House', position: { x: 413.69, y: -12.56, z: 242.17 } },
          ],
        },
      },
    }, {}, context)
    const outskirts = result.filter((marker) => marker.extractId?.startsWith('outskirts'))
    expect(outskirts).toHaveLength(1)
    expect(outskirts[0].layerId).toBe('extract.pmc')
    expect(outskirts[0].description).toContain('Также доступен Диким')
    expect(result.find((marker) => marker.extractId === 'house')?.layerId).toBe('extract.scav')
  })

  it('places quests with real zone coordinates and skips quests without a zone', () => {
    const quests: Quest[] = [
      { id: 'debut', name: 'Дебют', trader: 'Прапор', mapId: 'customs', mapIds: ['customs'], level: 1, kappa: true, description: '', objectives: ['Уничтожить Диких'], rewards: [] },
      { id: 'signal', name: 'Сигнал', trader: 'Механик', mapId: 'shoreline', mapIds: ['shoreline'], level: 12, kappa: true, description: '', objectives: ['Найти антенну'], rewards: [] },
    ]
    const context = {
      maps,
      quests,
      items: new Map(),
      mapNameByApiId: new Map([
        ['56f40101d2720b2a4d8b45d6', 'customs'],
        ['5704e554d2720bac5b8b456e', 'shoreline'],
      ]),
    }
    const result = adaptLiveMapMarkers({ maps: {} }, {
      tasks: {
        debut: {
          objectives: [{
            id: 'kill',
            description: 'Уничтожить Диких у общежития',
            zones: [{ id: 'dorms', map: '56f40101d2720b2a4d8b45d6', position: { x: 170, y: 6, z: 172 } }],
          }],
        },
      },
    }, context)
    expect(result.find((marker) => marker.questId === 'debut')?.title).toBe('Дебют')
    expect(result.find((marker) => marker.questId === 'debut')?.mapId).toBe('customs')
    expect(result.find((marker) => marker.questId === 'debut')?.source).toBe('json.tarkov.dev/tasks')
    expect(result.find((marker) => marker.questId === 'signal')).toBeUndefined()
  })

  it('does not invent fake pins for any-map quests without zones', () => {
    const quests: Quest[] = [
      { id: 'grenadier', name: 'Гренадёр', trader: 'Прапор', anyMap: true, level: 15, kappa: false, description: '', objectives: ['Устранить любую цель гранатами'], rewards: [] },
    ]
    const result = adaptLiveMapMarkers({ maps: {} }, {}, { maps, quests, items: new Map(), mapNameByApiId: new Map() })
    const grenadier = result.filter((marker) => marker.questId === 'grenadier')
    expect(grenadier).toHaveLength(0)
  })
})

describe('boss spawn spots', () => {
  const context = { maps, quests: [] as Quest[], items: new Map(), mapNameByApiId: new Map<string, string>() }
  const mobs = {
    bossKilla: { name: 'Килла', normalizedName: 'killa' },
    pmcBot: { name: 'Рейдеры', normalizedName: 'raider' },
    bossTest: { name: 'Boss X', normalizedName: 'boss-x' },
  }

  it('draws separate spots instead of averaging them onto open ground', () => {
    const result = adaptLiveMapMarkers({ mobs, maps: { interchange: { normalizedName: 'interchange', bosses: [
      { mob: 'bossKilla', spawnLocations: [{ name: 'ZoneCenter', positions: [{ x: -100, y: 25, z: 0 }, { x: 100, y: 25, z: 0 }] }] },
    ] } } }, {}, context)
    const killa = result.filter((marker) => marker.boss?.key === 'killa').map((marker) => marker.position)
    expect(killa).toEqual([[0, -100], [0, 100]])
  })

  it('shows a boss listed twice at one place once, and hides unknown mobs', () => {
    const result = adaptLiveMapMarkers({ mobs, maps: { reserve: { normalizedName: 'reserve', bosses: [
      { mob: 'pmcBot', spawnLocations: [{ name: 'ZoneBarrack', positions: [{ x: 10, y: 0, z: 10 }] }] },
      { mob: 'pmcBot', spawnLocations: [{ name: 'ZoneBarrack', positions: [{ x: 12, y: 0, z: 11 }] }] },
      { mob: 'bossTest', spawnLocations: [{ name: 'ZoneX', positions: [{ x: 50, y: 0, z: 50 }] }] },
    ] } } }, {}, context)
    expect(result.filter((marker) => marker.layerId === 'boss').map((marker) => marker.title)).toEqual(['Рейдеры'])
  })
})

describe('boss spot placement', () => {
  const context = { maps, quests: [] as Quest[], items: new Map(), mapNameByApiId: new Map<string, string>() }
  const mobs = { bossBoar: { name: 'Кабан', normalizedName: 'kaban' } }

  it('draws a spot at a real spawn point (medoid), not at the average of its points', () => {
    const result = adaptLiveMapMarkers({ mobs, maps: { 'streets-of-tarkov': { normalizedName: 'streets-of-tarkov', bosses: [
      { mob: 'bossBoar', spawnLocations: [{ name: 'ZoneCarShowroom', positions: [{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] }] },
    ] } } }, {}, context)
    expect(result.filter((marker) => marker.layerId === 'boss').map((marker) => marker.position)).toEqual([[0, 10]])
  })

  it('does not split one place into two markers because of the point order', () => {
    // 0 and 80 are far apart; 40 links them, so all three are one car showroom.
    const result = adaptLiveMapMarkers({ mobs, maps: { 'streets-of-tarkov': { normalizedName: 'streets-of-tarkov', bosses: [
      { mob: 'bossBoar', spawnLocations: [{ name: 'ZoneCarShowroom', positions: [{ x: 0, y: 0, z: 0 }, { x: 80, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }] }] },
    ] } } }, {}, context)
    expect(result.filter((marker) => marker.layerId === 'boss')).toHaveLength(1)
  })
})

describe('marker points follow the feed position', () => {
  it('puts the Labs Parking Gate marker at the gate, not in the middle of its parking-lot zone', () => {
    const context = { maps, quests: [] as Quest[], items: new Map(), mapNameByApiId: new Map<string, string>() }
    const result = adaptLiveMapMarkers({ maps: { lab: { normalizedName: 'the-lab', extracts: [{
      id: 'parking', faction: 'pmc', name: 'Parking Gate', position: { x: -231.73, y: 0.77, z: -434.82 },
      outline: [{ x: -251.9, z: -477.7 }, { x: -211.1, z: -477.7 }, { x: -211.1, z: -437 }, { x: -251.9, z: -437 }],
    }] } } }, {}, context)
    expect(result[0].position).toEqual([-434.82, -231.73])
  })
})

describe('quest markers: one icon per quest and «возможное место»', () => {
  const quest = (id: string, name: string): Quest => ({ id, name, trader: 'Терапевт', mapId: 'ground-zero', mapIds: ['ground-zero'], level: 1, kappa: true, description: '', objectives: [], rewards: [] })
  const context = (quests: Quest[]) => ({ maps, quests, items: new Map(), mapNameByApiId: new Map([['gz', 'ground-zero']]) })

  it('draws the visited room and the item spawns in it with one icon and marks the spawns as possible places', () => {
    const result = adaptLiveMapMarkers({ maps: {} }, { tasks: { mole: { objectives: [
      { id: 'visit', type: 'visit', description: 'Найти комнату', zones: [{ id: 'room', map: 'gz', position: { x: -13.5, y: 31, z: 51.3 } }] },
      { id: 'drive', type: 'findQuestItem', description: 'Найти жёсткий диск', questItem: { id: 'hdd' }, possibleLocations: [{ map: 'gz', positions: [
        { x: -11.95, y: 30.23, z: 49.59 }, { x: -12.36, y: 30.69, z: 49.03 }, { x: -12.13, y: 30.69, z: 48.04 },
      ] }] },
    ] } } }, context([quest('mole', 'Спасти крота')]))
    const markers = result.filter((marker) => marker.questId === 'mole')
    expect(markers).toHaveLength(4)
    expect(new Set(markers.map((marker) => marker.layerId))).toEqual(new Set(['quest.zone']))
    const spawns = markers.filter((marker) => marker.objectiveId === 'drive')
    expect(spawns.map((marker) => marker.possibleSpot)).toEqual([
      { kind: 'item', index: 1, count: 3 }, { kind: 'item', index: 2, count: 3 }, { kind: 'item', index: 3, count: 3 },
    ])
    expect(spawns.every((marker) => marker.itemId === 'hdd')).toBe(true)
    expect(markers.find((marker) => marker.objectiveId === 'visit')?.possibleSpot).toBeUndefined()
  })

  it('keeps the quest-item icon for a quest that only has item spawns; one spawn is not a «possible» place', () => {
    const result = adaptLiveMapMarkers({ maps: {} }, { tasks: {
      many: { objectives: [{ id: 'a', type: 'findQuestItem', possibleLocations: [{ map: 'gz', positions: [{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }] }] }] },
      one: { objectives: [{ id: 'b', type: 'findQuestItem', possibleLocations: [{ map: 'gz', positions: [{ x: 5, y: 0, z: 5 }] }] }] },
    } }, context([quest('many', 'Много'), quest('one', 'Один')]))
    const many = result.filter((marker) => marker.questId === 'many')
    expect(many.map((marker) => marker.layerId)).toEqual(['quest.item', 'quest.item'])
    expect(many.map((marker) => marker.possibleSpot?.count)).toEqual([2, 2])
    const one = result.find((marker) => marker.questId === 'one')
    expect(one?.layerId).toBe('quest.item')
    expect(one?.possibleSpot).toBeUndefined()
    expect(one?.meta).toContain('место предмета')
  })

  it('treats close zones of one objective on one floor as alternatives, keeps far or other-floor zones apart, draws a repeated zone once', () => {
    const result = adaptLiveMapMarkers({ maps: {} }, { tasks: { mark: { objectives: [
      { id: 'close', type: 'mark', zones: [
        { id: 'z1', map: 'gz', position: { x: 0, y: 1, z: 0 } },
        { id: 'z2', map: 'gz', position: { x: 12, y: 1.5, z: 0 } },
        { id: 'z2-copy', map: 'gz', position: { x: 12, y: 1.5, z: 0 } },
        { id: 'upstairs', map: 'gz', position: { x: 6, y: 9, z: 0 } },
        { id: 'far', map: 'gz', position: { x: 300, y: 1, z: 0 } },
      ] },
    ] } } }, context([quest('mark', 'Метка')]))
    const byId = new Map(result.map((marker) => [marker.id.replace('ground-zero-quest-zone-mark-', ''), marker]))
    expect([...byId.keys()].sort()).toEqual(['far', 'upstairs', 'z1', 'z2'])
    expect(byId.get('z1')?.possibleSpot).toEqual({ kind: 'zone', index: 1, count: 2 })
    expect(byId.get('z2')?.possibleSpot).toEqual({ kind: 'zone', index: 2, count: 2 })
    expect(byId.get('upstairs')?.possibleSpot).toBeUndefined()
    expect(byId.get('far')?.possibleSpot).toBeUndefined()
  })
})

describe('Labs keycard doors', () => {
  const items = new Map([
    ['5c1d0efb86f7744baf2e7b7b', { id: '5c1d0efb86f7744baf2e7b7b', name: 'Ключ-карта TerraGroup Labs (Красная)', shortName: 'Красная', category: 'Ключ' as const, description: '', prices: [] }],
    ['5c1e2a1e86f77431ea0ea84c', { id: '5c1e2a1e86f77431ea0ea84c', name: 'Ключ от кабинета управляющего TerraGroup Labs', shortName: 'Кабинет', category: 'Ключ' as const, description: '', prices: [] }],
  ])
  const context = { maps, quests: [] as Quest[], items, mapNameByApiId: new Map<string, string>() }

  it('says which keycard opens a door and keeps doors on the «key» layer', () => {
    const result = adaptLiveMapMarkers({ maps: { lab: { normalizedName: 'the-lab', locks: [
      { id: 'red', lockType: 'door', key: '5c1d0efb86f7744baf2e7b7b', position: { x: -257.2, y: 5.25, z: -322.9 } },
      { id: 'manager', lockType: 'door', key: '5c1e2a1e86f77431ea0ea84c', position: { x: -165.2, y: 5.16, z: -349.2 } },
      { id: 'blue-marking', lockType: 'door', key: '5efde6b4f5448336730dbd61', needsPower: true, position: { x: -130.3, y: 5.16, z: -339.9 } },
      { id: 'safe', lockType: 'container', key: '5c1e2a1e86f77431ea0ea84c', position: { x: -160, y: 5, z: -340 } },
    ] } } }, {}, context)
    const red = result.find((marker) => marker.id === 'the-lab-lock-red')
    expect(red).toMatchObject({ layerId: 'key', title: 'Дверь · открывает: Ключ-карта TerraGroup Labs (Красная)', itemId: '5c1d0efb86f7744baf2e7b7b' })
    expect(red?.lock).toMatchObject({ keycard: 'red', keyName: 'Ключ-карта TerraGroup Labs (Красная)' })
    expect(red?.description).toBe('Нужна ключ-карта «Ключ-карта TerraGroup Labs (Красная)».')
    const manager = result.find((marker) => marker.id === 'the-lab-lock-manager')
    expect(manager?.lock?.keycard).toBeUndefined()
    expect(manager?.description).toBe('Нужен ключ «Ключ от кабинета управляющего TerraGroup Labs».')
    // Not in the item list: the card is still recognised by its id and named in Russian.
    const marking = result.find((marker) => marker.id === 'the-lab-lock-blue-marking')
    expect(marking?.title).toBe('Дверь · открывает: Ключ-карта с синей полосой')
    expect(marking?.description).toContain('Также необходимо питание.')
    expect(result.find((marker) => marker.id === 'the-lab-lock-safe')?.title).toBe('Запертый контейнер · открывает: Ключ от кабинета управляющего TerraGroup Labs')
  })
})
