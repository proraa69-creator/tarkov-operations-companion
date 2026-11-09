import { describe, expect, it } from 'vitest'
import { adaptLiveMapMarkers, SPAWN_MERGE_METRES, BOSS_MERGE_METRES, GUARANTEED_SPAWN_TEXT, isCertain, mergeBossSpawnPoints, nearbySpotsText, VALUABLE_SPOT_TEXT } from './mapMarkerAdapter'
import { mainFloor } from './mapProjection'
import { BATTLE_PASS_DOCUMENT_KINDS, BATTLE_PASS_DOCUMENTS, battlePassDocumentDescription } from './battlePassDocuments'
import { translateUiText } from '../i18n/uiEnglish'
import gameLootContainers from './gameLootContainers.json'
import { maps } from './demo'
import type { Item, Quest } from '../domain/types'

describe('PMC and Scav spawns (owner, 07.11.2026)', () => {
  const context = { maps, quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
  const point = (x: number, sides: string[], categories: string[], z = 0, y = 0) => ({ position: { x, y, z }, sides, categories, zoneName: 'ZoneFactorySide' })
  const spawnsOf = (normalizedName: string, spawns: unknown[]) => adaptLiveMapMarkers({ maps: { a: { normalizedName, spawns } } }, {}, context).filter((marker) => marker.type === 'spawn')

  it('tells the sides apart as the game lists them', () => {
    const marks = spawnsOf('customs', [
      point(0, ['pmc'], ['player']),
      point(100, ['all'], ['player']),
      point(200, ['scav'], ['player', 'bot']),
      point(300, ['scav'], ['bot']),
      point(400, ['scav'], ['player']),
      point(500, ['scav'], ['bot', 'sniper']),
      point(600, ['pmc'], ['boss']),
      point(700, ['scav'], ['boss']),
      point(800, ['none'], ['player', 'bot']),
      point(900, ['all'], ['botpmc']),
    ])
    expect(marks.filter((marker) => marker.layerId === 'spawn.pmc')).toHaveLength(2)
    expect(marks.filter((marker) => marker.layerId === 'spawn.scav')).toHaveLength(3)
    expect(marks).toHaveLength(5)
  })

  it('points close together are one mark, on a real point; another floor stays its own', () => {
    const close = SPAWN_MERGE_METRES.pmc - 1
    const marks = spawnsOf('customs', [point(0, ['pmc'], ['player']), point(close, ['pmc'], ['player']), point(close * 2, ['pmc'], ['player']), point(close, ['pmc'], ['player'], 0, 10), point(500, ['pmc'], ['player'])])
    expect(marks).toHaveLength(3)
    // The middle one has the others around it.
    const groups = marks.map((marker) => marker.height)
    expect(groups.filter((height) => height === 10)).toHaveLength(1)
  })

  it('reads plainly in both languages: no raw names of the data on the card', () => {
    const [mark] = spawnsOf('customs', [point(0, ['pmc'], ['player'])])
    expect(mark!.title).toBe('Спавн ЧВК')
    expect(mark!.description).toBe('Здесь ЧВК начинают рейд.')
    expect(mark!.meta).toBeUndefined()
    for (const text of ['Спавн ЧВК', 'Спавн дикого', 'Спавны ЧВК', 'Спавны диких', 'Здесь ЧВК начинают рейд.', 'Здесь появляются дикие.']) expect(translateUiText(text)).toMatch(/^[A-Za-z .]+$/)
  })

  it('the Lab has PMC spawns and no Scavs: its bots are Raiders', () => {
    const marks = spawnsOf('the-lab', [point(0, ['all'], ['player']), point(500, ['scav'], ['bot', 'boss'])])
    expect(marks.map((marker) => marker.layerId)).toEqual(['spawn.pmc'])
  })
})

describe('live map catalog resilience', () => {
  it('Маяк has no mines any more (report №79): its sniper zones stay, Берег keeps its mines', () => {
    const context = { maps, quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
    const zone = (id: string, hazardType: string) => ({ id, hazardType, name: hazardType, position: { x: 1, y: 0, z: 1 }, outline: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }] })
    const raw = (normalizedName: string) => ({ normalizedName, hazards: [zone(`${normalizedName}-mine`, 'minefield'), zone(`${normalizedName}-sniper`, 'sniper')], artillery: { zones: [{ id: `${normalizedName}-gun`, position: { x: 1, y: 0, z: 1 } }] } })
    const dangers = adaptLiveMapMarkers({ maps: { a: raw('lighthouse'), b: raw('shoreline') } }, {}, context).filter((marker) => marker.layerId === 'hazard').map((marker) => marker.id).sort()
    expect(dangers.filter((id) => id.includes('lighthouse'))).toEqual(['hazard-lighthouse-gun', 'hazard-lighthouse-sniper'].map((id) => expect.stringContaining(id)))
    expect(dangers.filter((id) => id.includes('shoreline'))).toHaveLength(3)
  })

  it('does not lose the catalog when a boss has no spawn coordinates', () => {
    const context = { maps, quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
    const all = adaptLiveMapMarkers({ maps: { customs: { normalizedName: 'customs', bosses: [{ spawnLocations: [{ positions: [] }] }], extracts: [{ id: 'exit', faction: 'pmc', position: { x: 10, y: 0, z: 20 } }] } } }, {}, context)
    // Battle pass document pins, the kept Customs locks (KEY_DOOR_EXTRA_LOCKS) and the game-file containers are static data
    // and always present; this test is about the live feed.
    const result = all.filter((marker) => marker.layerId !== 'loot.documents' && marker.layerId !== 'key' && marker.source !== 'game-files')
    expect(result).toHaveLength(1)
    expect(result[0].position).toEqual([20, 10])
    expect(result[0].meta).toBe('Выход ЧВК')
  })

  it('adds the Lighthouse vehicle exit tarkov.dev does not list, and drops it once tarkov.dev lists one (owner, 01.11.2026)', () => {
    const context = { maps, quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
    const exits = (extracts: unknown[]) => adaptLiveMapMarkers({ maps: { lighthouse: { normalizedName: 'lighthouse', extracts } } }, {}, context).filter((marker) => marker.type === 'extract')
    const added = exits([{ id: 'north', name: 'Nothern_Checkpoint', faction: 'pmc', position: { x: 115, y: 12, z: -989 } }])
    expect(added.map((marker) => marker.title)).toEqual(['Nothern_Checkpoint', 'Дорога к военной базе (V-Ex)'])
    expect(added[1]?.description).toContain('у перехода на Резерв')
    expect(exits([{ id: 'car', name: 'Lighthouse V-Ex', faction: 'pmc', position: { x: -300, y: 15, z: -780 } }]).map((marker) => marker.title)).toEqual(['Lighthouse V-Ex'])
  })
  it('draws the BTR stops by the name upstream gives them; a map without stops has none (owner, 06.11.2026)', () => {
    const context = { items: new Map(), quests: [], maps: [{ id: 'woods', name: 'Лес' }, { id: 'customs', name: 'Таможня' }] } as unknown as Parameters<typeof adaptLiveMapMarkers>[2]
    const stops = adaptLiveMapMarkers({ maps: {
      woods: { normalizedName: 'woods', btrStops: [{ name: 'Лесопилка', x: -2.15, y: 8.128, z: -139.15 }, { name: 'Trading/Dialog/PlayerTaxi/Woods/p5/Name', x: 240.12, y: -2.088, z: -65.14 }] },
      customs: { normalizedName: 'customs', btrStops: [] },
    } }, {}, context).filter((marker) => marker.layerId === 'btr')
    expect(stops.map((marker) => [marker.mapId, marker.title, marker.meta])).toEqual([['woods', 'Лесопилка', 'Остановка БТР'], ['woods', 'Остановка БТР', 'Остановка БТР']])
    expect(stops[0].position).toEqual([-139.15, -2.15])
  })

  it('Lighthouse\'s stops, approximate while upstream lists none, say so; upstream\'s own replace them', () => {
    const context = { items: new Map(), quests: [], maps: [{ id: 'lighthouse', name: 'Маяк' }] } as unknown as Parameters<typeof adaptLiveMapMarkers>[2]
    const stops = (btrStops: unknown[]) => adaptLiveMapMarkers({ maps: { lighthouse: { normalizedName: 'lighthouse', btrStops } } }, {}, context).filter((marker) => marker.layerId === 'btr')
    const approximate = stops([])
    expect(approximate).toHaveLength(8)
    expect(approximate.map((marker) => marker.title)).toEqual(expect.arrayContaining(['Северный КПП', 'КПП ООН', 'Южная дорога']))
    expect(approximate[0].description).toContain('примерное')
    expect(stops([{ name: 'Новая', x: 1, y: 2, z: 3 }]).map((marker) => marker.title)).toEqual(['Новая'])
  })

  it('draws the power switches that turn on an exit, not every tarkov.dev switch (owner, 02.11.2026)', () => {
    const context = { maps, quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
    const switches = adaptLiveMapMarkers({ maps: { customs: { normalizedName: 'customs', switches: [
      { id: '9cad024bc31223f02f7296c3cb1834c5f6fa2fe2', name: 'switch_autoId_00000_D2_LEVER_reserve_electric_switcher_lever', position: { x: -117, y: -13, z: 23 }, top: -12.6, bottom: -13.3 },
      { id: '2c4a9ff1d031afefbd0965b189f58e3834cdb367', name: 'switch_autoId_00632_EXFIL_reserve_electric_switcher_lever', position: { x: -61, y: -6, z: 78 } },
      { id: '5173fd12', name: 'switch_Shopping_Mall_DesignStuff_00064_urinal (3)', position: { x: -52, y: 37, z: -125 } },
    ] } } }, {}, context).filter((marker) => marker.layerId === 'switch')
    expect(switches.map((marker) => marker.title)).toEqual(['Рубильник выхода D-2', 'Рубильник гермозатвора'])
    expect(switches[0].position).toEqual([23, -117])
    expect(switches[0].description).toContain('откроется выход D-2')
    expect(translateUiText(switches[1].title)).toBe('Hermetic door switch')
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

  it('Reserve: Glukhar is drawn where a player saw him spawn, by the railway south of the transit (01.11.2026)', () => {
    const context = { maps, quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
    const result = adaptLiveMapMarkers({
      mobs: { bossGluhar: { name: 'Глухарь', normalizedName: 'glukhar' } },
      maps: { reserve: { normalizedName: 'reserve', bosses: [
        { mob: 'bossGluhar', spawnChance: 0.37, spawnLocations: [
          { name: 'ZoneRailStrorage', chance: 0.25, positions: [{ x: -143, y: -6, z: -131 }, { x: 243, y: -7, z: -88 }] },
          { name: 'ZonePTOR2', chance: 0.25, positions: [{ x: 74, y: -6, z: -41 }] },
        ] },
      ] } },
    }, {}, context)
    const glukhar = result.filter((marker) => marker.boss?.key === 'glukhar')
    const railway = glukhar.find((marker) => marker.boss?.locationName?.includes('Ж/д пути у перехода'))
    expect(railway?.boss?.locationName).toContain('Rail')
    expect(glukhar).toHaveLength(3)
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

  it('shows an exit listed for both factions at one spot as a mark for each, at one place', () => {
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
    expect(outskirts.map((marker) => marker.layerId)).toEqual(['extract.pmc', 'extract.scav'])
    expect(outskirts[1].id).toBe(`${outskirts[0].id}--scav`)
    expect(outskirts[1].position).toEqual(outskirts[0].position)
    expect(outskirts[0].description).not.toContain('Диким')
    expect(result.find((marker) => marker.extractId === 'house')?.layerId).toBe('extract.scav')
  })

  it('does not draw another map\'s exits that tarkov.dev lists on Ground Zero (02.11.2026), nor any exit far off its map', () => {
    const groundZero = { ...maps.find((map) => map.id === 'ground-zero')!, bounds: [[-99, -124], [249, 364]] as [[number, number], [number, number]] }
    const context = { maps: [groundZero], quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
    const result = adaptLiveMapMarkers({
      maps: {
        gz: {
          normalizedName: 'ground-zero',
          extracts: [
            { id: 'mira', faction: 'pmc', name: 'Mira Ave', position: { x: 10, y: 0, z: 300 } },
            // tarkov.dev's copies of Woods' UN Roadblock and Streets' Pinewood basement
            { id: '495c627fb5f7498fb7621bf193f16b74e1c952b9', faction: 'pmc', name: 'UN Roadblock', position: { x: -527.87, y: 1.68, z: 288.23 } },
            { id: 'b8427fbbffcf849ead5619fcc6c4d19225468f28', faction: 'shared', name: 'Exit_E10_coop', position: { x: -113.71, y: -2.93, z: 65.63 } },
            // an unknown exit 600 m off the map
            { id: 'stray', faction: 'scav', name: 'Somewhere', position: { x: 900, y: 0, z: 0 } },
            // just past the edge, like Customs' railway flare exit: kept
            { id: 'edge', faction: 'pmc', name: 'Edge', position: { x: 255, y: 0, z: 0 } },
          ],
        },
      },
    }, {}, context)
    expect(result.filter((marker) => marker.type === 'extract').map((marker) => marker.extractId).sort()).toEqual(['edge', 'mira'])
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
    // The three spawns lie within 2 m of each other: one point that stands for them (owner, 02.11.2026).
    expect(markers).toHaveLength(2)
    expect(new Set(markers.map((marker) => marker.layerId))).toEqual(new Set(['quest.zone']))
    const spawns = markers.filter((marker) => marker.objectiveId === 'drive')
    expect(spawns).toHaveLength(1)
    expect(spawns[0].possibleSpot).toBeUndefined()
    expect(spawns[0].nearbySpots).toEqual({ count: 3 })
    // The kept point is a real spawn, the one in the middle of the three.
    expect(spawns[0].id).toBe('ground-zero-quest-item-mole-drive-1')
    expect(spawns[0].itemId).toBe('hdd')
    expect(spawns[0].guaranteedSpawn).toBeUndefined()
    expect(markers.find((marker) => marker.objectiveId === 'visit')?.possibleSpot).toBeUndefined()
  })

  it('draws spawns of one quest item close together as one point, keeps far ones apart and counts the points drawn (owner, 02.11.2026)', () => {
    const result = adaptLiveMapMarkers({ maps: {} }, { tasks: { wine: { objectives: [
      { id: 'bottle', type: 'findQuestItem', questItem: { id: 'wine' }, possibleLocations: [{ map: 'gz', positions: [
        // the shop: four spawns within 12 m, the middle one is kept
        { x: 0, y: 1, z: 0 }, { x: 6, y: 1, z: 0 }, { x: 12, y: 1, z: 0 }, { x: 6, y: 1, z: 5 },
        // a kiosk 80 m away and a flat upstairs 200 m away: places of their own
        { x: 80, y: 1, z: 0 }, { x: 200, y: 7, z: 0 },
      ] }] },
    ] } } }, context([quest('wine', 'Вино')]))
    const spawns = result.filter((marker) => marker.questId === 'wine')
    expect(spawns.map((marker) => marker.id.replace('ground-zero-quest-item-wine-bottle-', ''))).toEqual(['1', '4', '5'])
    expect(spawns.map((marker) => marker.possibleSpot)).toEqual([
      { kind: 'item', index: 1, count: 3 }, { kind: 'item', index: 2, count: 3 }, { kind: 'item', index: 3, count: 3 },
    ])
    expect(spawns.map((marker) => marker.nearbySpots)).toEqual([{ count: 4 }, undefined, undefined])
    expect(translateUiText(nearbySpotsText(4))).toBe('Places close together: 4')
  })

  it('a point standing for spawns on several floors has no floor of its own and names them; one floor keeps its floor', () => {
    const floored = { ...maps.find((map) => map.id === 'ground-zero')!, layers: [
      { name: '2 этаж', extents: [{ height: [5, 12] as [number, number] }] },
    ] } as unknown as (typeof maps)[number]
    const result = adaptLiveMapMarkers({ maps: {} }, { tasks: { flat: { objectives: [
      { id: 'note', type: 'findQuestItem', possibleLocations: [{ map: 'gz', positions: [{ x: 0, y: 1, z: 0 }, { x: 2, y: 8, z: 1 }, { x: 300, y: 8, z: 0 }, { x: 304, y: 8, z: 0 }] }] },
    ] } } }, { ...context([quest('flat', 'Квартира')]), maps: [floored] })
    const spawns = result.filter((marker) => marker.questId === 'flat')
    expect(spawns).toHaveLength(2)
    const stairwell = spawns.find((marker) => marker.nearbySpots?.floors)
    expect(stairwell?.floor).toBeUndefined()
    expect(stairwell?.nearbySpots?.floors?.sort()).toEqual(['2 этаж', mainFloor(floored)].sort())
    const upstairs = spawns.find((marker) => marker !== stairwell)
    expect(upstairs?.floor).toBe('2 этаж')
    expect(upstairs?.nearbySpots).toEqual({ count: 2 })
  })

  it('report №101: «Слежка» stands on the 2nd floor though the map’s floors start higher (owner, 08.11.2026)', () => {
    // Streets: the floors start at 10 m for the whole map; the surveillance flat is at 5–7 m
    const streets = { ...maps.find((map) => map.id === 'ground-zero')!, floors: ['Основной', '2 этаж', '3 этаж'], layers: [
      { name: '2 этаж', extents: [{ height: [10, 15] as [number, number] }] },
      { name: '3 этаж', extents: [{ height: [15, 20] as [number, number] }] },
    ] } as unknown as (typeof maps)[number]
    const result = adaptLiveMapMarkers({ maps: {} }, { tasks: { slezhka: { objectives: [
      { id: '63a7d8665199ab1f7d4a7747', type: 'visit', zones: [{ id: 'quest_zone_c21_look', map: 'gz', position: { x: -67.75, y: 5.95, z: 65.88 }, top: 6.95, bottom: 4.95 }] },
      { id: '639136fa9444fb141f4e6eef', type: 'findQuestItem', possibleLocations: [{ map: 'gz', positions: [{ x: -70.079, y: 5.752, z: 69.437 }, { x: -65.262, y: 5.89, z: 66.363 }] }] },
      { id: 'other', type: 'findQuestItem', possibleLocations: [{ map: 'gz', positions: [{ x: 200, y: 5.8, z: 0 }] }] },
    ] } } }, { ...context([quest('slezhka', 'Слежка')]), maps: [streets] })
    const points = result.filter((marker) => marker.questId === 'slezhka')
    expect(points.filter((marker) => marker.objectiveId !== 'other').map((marker) => marker.floor)).toEqual(expect.arrayContaining(['2 этаж']))
    expect(points.filter((marker) => marker.objectiveId !== 'other').every((marker) => marker.floor === '2 этаж')).toBe(true)
    // any other point at that height is left to the map's floors
    expect(points.find((marker) => marker.objectiveId === 'other')?.floor).toBe(mainFloor(streets))
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
    // The lock kind travels with the marker («Барахолка» names a door, a car door or a container, data/keyDoors.ts).
    expect(result.find((marker) => marker.id === 'the-lab-lock-safe')?.lock?.kind).toBe('container')
    expect(red?.lock?.kind).toBe('door')
  })
})

describe('locks the current tarkov.dev feed lost (keyDoorNames.ts KEY_DOOR_EXTRA_LOCKS)', () => {
  const context = { maps, quests: [] as Quest[], items: new Map<string, Item>(), mapNameByApiId: new Map<string, string>() }
  const EXIT_KEY = '5448ba0b4bdc2d02308b456c'

  it('adds the Factory exit key\'s two Customs guard-building doors as lock markers, once', () => {
    const customs = (locks: unknown[]) => adaptLiveMapMarkers({ maps: { customs: { normalizedName: 'customs', locks } } }, {}, context)
      .filter((marker) => marker.lock?.keyId === EXIT_KEY)
    const added = customs([])
    expect(added.map((marker) => [marker.id, marker.layerId, marker.lock?.kind, marker.source])).toEqual([
      ['customs-lock-2e9c51a0f9edec820a4b1e7fd616b5a55d5e95e5', 'key', 'door', 'json.tarkov.dev/maps 29.09.2026'],
      ['customs-lock-ac28b0e35e05bf59e86bd23e39cb471a9ceec5b3', 'key', 'door', 'json.tarkov.dev/maps 29.09.2026'],
    ])
    // A feed that has the lock again keeps its own record.
    const again = customs([{ id: 'ac28b0e35e05bf59e86bd23e39cb471a9ceec5b3', lockType: 'door', key: EXIT_KEY, position: { x: 356.05, y: 2.34, z: -14.57 } }])
    expect(again.map((marker) => marker.source)).toEqual(['json.tarkov.dev/maps', 'json.tarkov.dev/maps 29.09.2026'])
    // Not on other maps.
    expect(adaptLiveMapMarkers({ maps: { woods: { normalizedName: 'woods', locks: [] } } }, {}, context).some((marker) => marker.lock?.keyId === EXIT_KEY)).toBe(false)
  })
})

describe('boss markers are merged within ~100 m (BOSS_MERGE_METRES)', () => {
  const context = { maps, quests: [] as Quest[], items: new Map(), mapNameByApiId: new Map<string, string>() }
  const mobs = {
    bossBully: { name: 'Решала', normalizedName: 'reshala' },
    pmcBot: { name: 'Рейдеры', normalizedName: 'raider' },
    bossTagilla: { name: 'Тагилла', normalizedName: 'tagilla' },
  }
  const bosses = (result: ReturnType<typeof adaptLiveMapMarkers>) => result.filter((marker) => marker.layerId === 'boss')

  it('draws three spawn points of one boss inside 100 m (different zones) as one marker', () => {
    const result = adaptLiveMapMarkers({ mobs, maps: { customs: { normalizedName: 'customs', bosses: [
      { mob: 'bossBully', spawnChance: 0.45, spawnLocations: [
        { name: 'ZoneDormitory', chance: 0.33, positions: [{ x: 180, y: 1, z: 170 }] },
        { name: 'ZoneDormitory2', chance: 0.33, positions: [{ x: 230, y: 1, z: 150 }] },
        { name: 'ZoneGasStation', chance: 0.34, positions: [{ x: 200, y: 1, z: 200 }] },
      ] },
    ] } } }, {}, context)
    const markers = bosses(result)
    expect(markers).toHaveLength(1)
    expect(markers[0].boss?.locationName).toBe('Dormitory, Dormitory 2, Gas Station')
    expect(markers[0].boss?.locationChance).toBe(1)
    // Drawn at a real spawn point (the most central one), not at an average.
    expect([[170, 180], [150, 230], [200, 200]]).toContainEqual(markers[0].position)
  })

  it('keeps places of one boss that are further apart than the merge distance', () => {
    const result = adaptLiveMapMarkers({ mobs, maps: { customs: { normalizedName: 'customs', bosses: [
      { mob: 'bossBully', spawnLocations: [
        { name: 'ZoneDormitory', positions: [{ x: 0, y: 0, z: 0 }] },
        { name: 'ZoneGasStation', positions: [{ x: 200, y: 0, z: 0 }] },
      ] },
    ] } } }, {}, context)
    expect(bosses(result)).toHaveLength(2)
  })

  it('merges two raider groups at one place and keeps different bosses apart', () => {
    const result = adaptLiveMapMarkers({ mobs, maps: { reserve: { normalizedName: 'reserve', bosses: [
      { mob: 'pmcBot', spawnChance: 0.4, spawnLocations: [{ name: 'ZoneBarrack', positions: [{ x: 10, y: 0, z: 10 }] }] },
      { mob: 'pmcBot', spawnChance: 0.3, spawnLocations: [{ name: 'ZoneSubStorage', positions: [{ x: 70, y: 0, z: 40 }] }] },
      { mob: 'bossTagilla', spawnChance: 0.2, spawnLocations: [{ name: 'ZoneBarrack', positions: [{ x: 12, y: 0, z: 12 }] }] },
    ] } } }, {}, context)
    const markers = bosses(result)
    expect(markers.map((marker) => marker.title).sort()).toEqual(['Рейдеры', 'Тагилла'])
    expect(markers.find((marker) => marker.title === 'Рейдеры')?.boss?.spawnChance).toBe(0.4)
  })

  it('drops a boss or a zone the feed lists with 0 % in this mode, but keeps triggered bosses', () => {
    const result = adaptLiveMapMarkers({ mobs, maps: { reserve: { normalizedName: 'reserve', bosses: [
      { mob: 'bossTagilla', spawnChance: 0, spawnLocations: [{ name: 'ZoneX', positions: [{ x: 0, y: 0, z: 0 }] }] },
      { mob: 'pmcBot', spawnChance: 0, spawnTrigger: 'Lever', spawnLocations: [
        { name: 'ZoneBunker', chance: 0, positions: [{ x: 300, y: 0, z: 300 }] },
        { name: 'ZoneBarrack', chance: 1, positions: [{ x: 10, y: 0, z: 10 }] },
      ] },
    ] } } }, {}, context)
    const markers = bosses(result)
    expect(markers.map((marker) => marker.title)).toEqual(['Рейдеры'])
    expect(markers[0].boss?.locationName).toBe('Barrack')
  })
})

describe('mergeBossSpawnPoints', () => {
  it('leaves no two places closer than the merge distance, even for a chain of points', () => {
    const chain = Array.from({ length: 12 }, (_, index) => ({ x: index * 45, z: (index % 3) * 20 }))
    const places = mergeBossSpawnPoints(chain)
    for (const a of places) {
      for (const b of places) {
        if (a !== b) expect(Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z)).toBeGreaterThanOrEqual(BOSS_MERGE_METRES)
      }
    }
    expect(places.reduce((sum, place) => sum + place.points.length, 0)).toBe(chain.length)
    // Every place is drawn at one of its own points.
    for (const place of places) expect(place.points).toContain(place.center)
  })
})

describe('battle pass documents', () => {
  const context = { maps, quests: [] as Quest[], items: new Map(), mapNameByApiId: new Map<string, string>() }

  it('puts the community pins on the documents layer as approximate points with the document names', () => {
    const result = adaptLiveMapMarkers({ maps: { customs: { normalizedName: 'customs' } } }, {}, context)
    const documents = result.filter((marker) => marker.layerId === 'loot.documents')
    expect(documents).toHaveLength(BATTLE_PASS_DOCUMENTS.customs.length)
    expect(documents.every((marker) => marker.approximate && marker.mapId === 'customs')).toBe(true)
    // No guessed height: the points stay on the general map, not on the underground layer.
    expect(documents.every((marker) => marker.height === undefined)).toBe(true)
    const oldGas = documents.find((marker) => marker.description.includes('Старая заправка — на столе'))
    expect(oldGas?.description).toContain('Финансовая документация')
    expect(oldGas?.position).toEqual([-186.86, 318.24])
  })

  it('uses exact tarkov.dev loose-loot documents when the feed has them, instead of the pins placed by hand', () => {
    const pin = BATTLE_PASS_DOCUMENTS.customs[0]
    const result = adaptLiveMapMarkers({ maps: { customs: { normalizedName: 'customs', lootLoose: [
      { items: [BATTLE_PASS_DOCUMENT_KINDS.financial.itemId], position: { x: pin.x + 1, y: 5, z: pin.z } },
    ] } } }, {}, context)
    const documents = result.filter((marker) => marker.layerId === 'loot.documents')
    expect(documents).toHaveLength(1)
    expect(documents[0]!.approximate).toBeFalsy()
    expect(documents[0]!.documentKinds).toEqual(['financial'])
    expect(result.some((marker) => marker.layerId?.startsWith('loot.') && marker.layerId !== 'loot.documents' && marker.source !== 'game-files')).toBe(false)
  })

  it('has every document name translated and every point on a known map', { timeout: 30_000 }, () => {
    for (const [mapId, points] of Object.entries(BATTLE_PASS_DOCUMENTS)) {
      expect(maps.some((map) => map.id === mapId)).toBe(true)
      for (const point of points) {
        expect(point.documents.length).toBeGreaterThan(0)
        expect(battlePassDocumentDescription(point)).toMatch(/приблизительное/)
        expect(translateUiText(battlePassDocumentDescription(point))).not.toMatch(/[А-Яа-яЁё]/)
      }
    }
  })
})

describe('boss data per game mode', () => {
  const mobs = { bossKilla: { name: 'Килла', normalizedName: 'killa', imagePortraitLink: 'https://assets.tarkov.dev/killa.webp' } }
  const feed = (spawnChance: number, x: number, extra: Record<string, unknown> = {}) => ({ mobs, maps: { interchange: { normalizedName: 'interchange', bosses: [
    { mob: 'bossKilla', spawnChance, ...extra, spawnLocations: [{ name: 'ZoneCenter', chance: 1, positions: [{ x, y: 0, z: 50 }] }] },
  ] } } })
  const context = (mode: 'pvp' | 'pve') => ({ maps, quests: [], items: new Map(), mapNameByApiId: new Map<string, string>(), mode })
  const killa = (markers: ReturnType<typeof adaptLiveMapMarkers>) => markers.filter((marker) => marker.layerId === 'boss' && marker.boss?.key === 'killa')

  it('shows each mode its own chance and points; «100 %» only in the mode whose data says so', () => {
    const pvp = killa(adaptLiveMapMarkers(feed(0.35, 10), {}, context('pvp')))
    const pve = killa(adaptLiveMapMarkers(feed(1, 400), {}, context('pve')))
    expect(pvp.map((marker) => [marker.boss?.spawnChance, marker.position[1], marker.guaranteedSpawn])).toEqual([[0.35, 10, undefined]])
    expect(pve.map((marker) => [marker.boss?.spawnChance, marker.position[1], marker.guaranteedSpawn])).toEqual([[1, 400, true]])
  })

  it('never calls a triggered boss or a rounded 99.6 % a certain spawn', () => {
    expect(killa(adaptLiveMapMarkers(feed(1, 10, { spawnTrigger: 'Lever' }), {}, context('pve')))[0].guaranteedSpawn).toBeUndefined()
    expect(killa(adaptLiveMapMarkers(feed(0.996, 10), {}, context('pve')))[0].guaranteedSpawn).toBeUndefined()
    expect(isCertain(1)).toBe(true)
    expect(isCertain(0.999)).toBe(false)
  })
})

describe('jewelry spots and certain quest-item spawns', () => {
  const item = (id: string, name: string, extra: Partial<Item> = {}): [string, Item] => [id, { id, name, shortName: name, category: 'Бартер', description: '', prices: [], types: ['barter'], ...extra }]
  const items = new Map<string, Item>([item('chain', 'Золотая цепочка', { valuable: true }), item('bolts', 'Болты'), item('salewa', 'Salewa', { types: ['meds'] })])
  const context = { maps, quests: [] as Quest[], items, mapNameByApiId: new Map<string, string>() }

  it('puts a loose-loot spot that may hold jewelry on the «Драгоценности» layer, jewelry first, without a chance', () => {
    const result = adaptLiveMapMarkers({ maps: { customs: { normalizedName: 'customs', lootLoose: [
      { items: ['salewa', 'chain'], position: { x: 1, y: 0, z: 2 } },
      { items: ['bolts'], position: { x: 5, y: 0, z: 6 } },
    ] } } }, {}, context)
    const jewelry = result.filter((marker) => marker.layerId === 'loot.valuable')
    expect(jewelry).toHaveLength(1)
    expect(jewelry[0]).toMatchObject({ title: 'Драгоценности', itemId: 'chain', meta: 'Золотая цепочка, Salewa', description: VALUABLE_SPOT_TEXT })
    expect(jewelry[0].guaranteedSpawn).toBeUndefined()
    expect(result.find((marker) => marker.itemId === 'bolts')?.layerId).toBe('loot.technical')
    expect(translateUiText(VALUABLE_SPOT_TEXT)).not.toMatch(/[А-Яа-яЁё]/)
  })

  it('marks a quest item with a single listed spawn position as «Спавн 100 %», not one of several', () => {
    const quests = [
      { id: 'q1', name: 'Один тайник', trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] },
      { id: 'q2', name: 'Три тайника', trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] },
    ] as unknown as Quest[]
    const tasks = { tasks: {
      q1: { objectives: [{ id: 'o1', type: 'findQuestItem', questItem: 'doc', possibleLocations: [{ map: 'customs', positions: [{ x: 1, y: 0, z: 1 }] }] }] },
      q2: { objectives: [{ id: 'o2', type: 'findQuestItem', questItem: 'doc2', possibleLocations: [{ map: 'customs', positions: [{ x: 1, y: 0, z: 1 }, { x: 200, y: 0, z: 1 }, { x: 400, y: 0, z: 1 }] }] }] },
    } }
    const result = adaptLiveMapMarkers({ maps: {} }, tasks, { ...context, quests, mapNameByApiId: new Map([['customs', 'customs']]) })
    const single = result.filter((marker) => marker.questId === 'q1')
    const several = result.filter((marker) => marker.questId === 'q2')
    expect(single.map((marker) => marker.guaranteedSpawn)).toEqual([true])
    expect(several).toHaveLength(3)
    expect(several.every((marker) => !marker.guaranteedSpawn)).toBe(true)
    expect(translateUiText(GUARANTEED_SPAWN_TEXT)).toBe('Spawn 100 %')
  })
})

describe('«Спавн 100 %» layer and the containers of the game files (09.11.2026)', () => {
  const context = { maps, quests: [] as Quest[], items: new Map(), mapNameByApiId: new Map<string, string>() }
  const markersOf = (mapId: string, extra: Record<string, unknown> = {}) =>
    adaptLiveMapMarkers({ maps: { [mapId]: { normalizedName: mapId, ...extra } } }, {}, context)

  it('keeps «Спавн 100 %» for the item that always lies at its one spot; the spots of a group are possible spawns on «Ключи»', () => {
    const streets = markersOf('streets-of-tarkov')
    const certain = streets.filter((marker) => marker.layerId === 'loot.guaranteed')
    expect(certain).toHaveLength(1)
    expect(certain[0]).toMatchObject({ itemId: '63a39e1d234195315d4020bd', guaranteedSpawn: true, description: 'Лежит здесь в каждом рейде.' })
    const relaxation = streets.filter((marker) => marker.itemId === '6582dbf0b8d7830efc45016f')
    expect(relaxation).toHaveLength(12)
    expect(relaxation.every((marker) => marker.layerId === 'loot.key' && marker.possibleSpawn && marker.description === 'Одна из 12 возможных точек спавна.')).toBe(true)
    const lab = markersOf('the-lab')
    expect(lab.some((marker) => marker.layerId === 'loot.guaranteed')).toBe(false)
    expect(lab.filter((marker) => marker.layerId === 'loot.key' && marker.possibleSpawn && marker.description === 'Одна из 11 возможных точек спавна.')).toHaveLength(11)
    expect(markersOf('customs').some((marker) => marker.layerId === 'loot.guaranteed')).toBe(false)
  })

  it('has English for the new texts', () => {
    expect(translateUiText('Лежит здесь в каждом рейде.')).toBe('Here every raid.')
    expect(translateUiText('Одна из 12 возможных точек спавна.')).toBe('One of 12 possible spawn spots.')
    expect(translateUiText('Возможная точка спавна')).toBe('Possible spawn spot')
  })

  it('adds the game-file containers tarkov.dev lacks, with the kind of tarkov.dev\'s ids, and draws a shared one once', () => {
    const terminal = markersOf('terminal').filter((marker) => marker.layerId === 'loot.container')
    expect(terminal.length).toBeGreaterThan(200)
    expect(terminal.every((marker) => marker.title !== 'Контейнер с лутом')).toBe(true)
    // A tarkov.dev container at the same spot: the game-file one is not drawn again.
    const data = gameLootContainers.points.customs[0] as [string, number, number, number]
    const listed = markersOf('customs', { lootContainers: [{ lootContainer: data[0], position: { x: data[1] + 1, y: data[2], z: data[3] } }] })
      .filter((marker) => marker.layerId === 'loot.container')
    expect(listed).toHaveLength(1)
    expect(listed[0]!.source).toBe('json.tarkov.dev/maps')
    expect(markersOf('customs').filter((marker) => marker.source === 'game-files')).toHaveLength(1)
  })
})

describe('«Ключи»: keys and keycards lying loose (report №108)', () => {
  const key = (id: string, name: string, shortName: string) => [id, { id, name, shortName, category: 'Ключ' }] as const
  const items = new Map<string, unknown>([
    key('k1', 'Ключ от кабинета директора ТарКон', 'ТарКон'),
    key('k2', 'Ключ от комнаты 203', '203'),
    ['bolts', { id: 'bolts', name: 'Болты', shortName: 'Болты', category: 'Бартер', types: ['barter'] }],
  ])
  const context = { maps, quests: [], items, mapNameByApiId: new Map<string, string>() } as unknown as Parameters<typeof adaptLiveMapMarkers>[2]

  it('puts a loose key spot on «Ключи» and the rest of the spot on its own layer', () => {
    const result = adaptLiveMapMarkers({ maps: { customs: { normalizedName: 'customs', lootLoose: [
      { items: ['k1'], position: { x: 10, y: 1, z: 10 } },
      { items: ['k1', 'k2', 'bolts'], position: { x: 40, y: 1, z: 40 } },
    ] } } }, {}, context)
    const keys = result.filter((marker) => marker.layerId === 'loot.key')
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatchObject({ title: 'Ключ от кабинета директора ТарКон', description: 'Может лежать здесь.', itemId: 'k1' })
    expect(keys[0]!.keyCount).toBeUndefined()
    expect(keys[1]).toMatchObject({ title: 'Ключи: 2', keyCount: 2, description: 'Может лежать один из: Ключ от кабинета директора ТарКон, Ключ от комнаты 203.' })
    // the bolts stay a loose loot point; the key-only spot leaves nothing on the other layers
    const loose = result.filter((marker) => marker.layerId?.startsWith('loot.') && marker.layerId !== 'loot.key' && marker.source === 'json.tarkov.dev/maps')
    expect(loose).toHaveLength(1)
    expect(loose[0]!.meta).toBe('Болты')
  })

  it('puts the photo players gave of a key spot on the feed point of that key, and adds a point where the feed has none', () => {
    const dorm = new Map<string, unknown>([key('664d4b0103ef2c61246afb56', 'Ключ от комнаты заведующего общежития', 'Зав. общ')])
    const shore = { ...context, items: dorm } as typeof context
    const keys = (lootLoose: unknown[]) => adaptLiveMapMarkers({ maps: { shoreline: { normalizedName: 'shoreline', lootLoose } } }, {}, shore)
      .filter((marker) => marker.layerId === 'loot.key')
    // the feed's spot in the living container (reports of 10.11.2026): its own point carries the photo, nothing is added
    const listed = keys([
      { items: ['664d4b0103ef2c61246afb56'], position: { x: -653.4, y: -25.0, z: -237.2 } },
      { items: ['664d4b0103ef2c61246afb56'], position: { x: -655.8, y: -26.1, z: -247.9 } },
    ])
    expect(listed).toHaveLength(2)
    expect(listed.filter((marker) => marker.spotPhotos?.length).map((marker) => marker.spotPhotos![0]!.file)).toEqual(['shoreline-scav-farm-dorm-overseer.webp'])
    // a feed without that spot: the point of its own, with the photo
    const own = keys([{ items: ['664d4b0103ef2c61246afb56'], position: { x: -655.8, y: -26.1, z: -247.9 } }]).filter((marker) => marker.spotPhotos?.length)
    expect(own).toHaveLength(1)
    expect(own[0]).toMatchObject({ title: 'Ключ от комнаты заведующего общежития', itemId: '664d4b0103ef2c61246afb56', source: 'raidos' })
  })

  it('adds the key spots of live raids the feed lacks (SPT statistics), once the feed has none of them there', () => {
    const spotKeys = new Map<string, unknown>([key('5e42c83786f7742a021fdf3c', 'Ключ', 'К')])
    const ctx = { ...context, maps: [...maps, { ...maps[0]!, id: 'customs' }], items: spotKeys } as typeof context
    const spt = (lootLoose: unknown[]) => adaptLiveMapMarkers({ maps: { m: { normalizedName: 'customs', lootLoose } } }, {}, ctx)
      .filter((marker) => marker.layerId === 'loot.key' && marker.id.includes('spt-key-'))
    expect(spt([]).length).toBeGreaterThan(0)
    expect(spt([{ items: ['5e42c83786f7742a021fdf3c'], position: { x: 182.02, y: 7.03, z: 183.02 } }]).some((marker) => marker.id.endsWith('spt-key-0'))).toBe(false)
  })

  it('is translated', () => {
    expect(translateUiText('Может лежать здесь.')).not.toMatch(/[А-Яа-яЁё]/)
    expect(translateUiText('Ключи: 2')).not.toMatch(/[А-Яа-яЁё]/)
    expect(translateUiText('Может лежать один из: Ключ от комнаты 203, Ключ от комнаты 204.')).toMatch(/^May lie here: one of /)
  })
})
