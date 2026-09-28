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
