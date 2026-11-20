import { describe, expect, it } from 'vitest'
import type { HideoutStation } from '../domain/types'
import { hideoutNeeds } from './hideoutNeeds'
import { applyHideoutModules, BITCOIN_FARM, GYM, modeModules, sanitizeHideoutModules } from './hideoutModules'

const WALL = '637b39f02e873739ec490215'
const GENERATOR = '5d3b396e33c48f02b81cd9f3'
const GPU = 'gpu'
const station = (id: string, name: string, levels: NonNullable<HideoutStation['levels']>): HideoutStation =>
  ({ id, name, level: 0, status: 'locked', requirements: [...(levels[0]?.requirements ?? []), ...(levels[0]?.stationRequirements ?? [])], bonus: '', levels }) as HideoutStation
const stations: HideoutStation[] = [
  station(GYM, 'Спортзал', [{ level: 1, requirements: ['Гантели × 1'], stationRequirements: ['Аварийная стена ур. 6', 'Освещение ур. 2'], itemRequirements: [{ itemId: 'dumbbell', count: 1 }], bonus: '' }]),
  station(BITCOIN_FARM, 'Биткоин-ферма', [
    { level: 1, requirements: ['Видеокарта × 1'], stationRequirements: ['Разведцентр ур. 2'], itemRequirements: [{ itemId: GPU, count: 1 }], bonus: '' },
    { level: 2, requirements: ['Видеокарта × 2', 'Лояльность: Механик ур. 2'], stationRequirements: ['Биткоин-ферма ур. 1', 'Генератор ур. 3'], itemRequirements: [{ itemId: GPU, count: 2 }], bonus: '' },
  ]),
  station(GENERATOR, 'Генератор', [{ level: 1, requirements: ['Провода × 2'], itemRequirements: [{ itemId: 'wire', count: 2 }], bonus: '' }]),
  station(WALL, 'Аварийная стена', [{ level: 1, requirements: [], bonus: '' }]),
]

describe('«Модули убежища»', () => {
  it('leaves every mode as in the game while the owner set nothing', () => {
    expect(applyHideoutModules(stations, 'seasonal', null)).toBe(stations)
    expect(applyHideoutModules(stations, 'pvp', { modes: { seasonal: { open: [GYM], hidden: [] } } })).toBe(stations)
  })

  it('opens the gym and the bitcoin farm from the start in Season: no other module stands in the way, the items stay', () => {
    const season = applyHideoutModules(stations, 'seasonal', { modes: { seasonal: { open: [GYM, BITCOIN_FARM], hidden: [] } } })
    const gym = season.find((entry) => entry.id === GYM)!
    const farm = season.find((entry) => entry.id === BITCOIN_FARM)!
    expect(gym.levels?.[0]?.stationRequirements).toEqual([])
    expect(gym.requirements).toEqual(['Гантели × 1'])
    expect(farm.levels?.map((level) => level.stationRequirements)).toEqual([[], []])
    // a trader's loyalty still counts
    expect(farm.levels?.[1]?.requirements).toEqual(['Видеокарта × 2', 'Лояльность: Механик ур. 2'])
    expect(hideoutNeeds(season, {}, new Map()).items.find((need) => need.itemId === GPU)?.total).toBe(3)
    // the other modules are untouched
    expect(season.find((entry) => entry.id === GENERATOR)).toBe(stations[2])
    expect(stations[0]!.levels?.[0]?.stationRequirements).toHaveLength(2)
  })

  it('a module turned off is not in that mode\'s hideout and not counted', () => {
    const pve = applyHideoutModules(stations, 'pve', { modes: { pve: { open: [], hidden: [BITCOIN_FARM] } } })
    expect(pve.map((entry) => entry.id)).toEqual([GYM, GENERATOR, WALL])
    expect(hideoutNeeds(pve, {}, new Map()).items.map((need) => need.itemId)).not.toContain(GPU)
  })

  it('keeps only module ids, once each; a module both open and off stays off; empty lists are no setting', () => {
    expect(sanitizeHideoutModules({ modes: { seasonal: { open: [GYM, GYM, 'gym', 7, BITCOIN_FARM], hidden: [BITCOIN_FARM] }, arena: { open: [GYM], hidden: [] } }, updatedAt: '2026-11-20T10:00:00.000Z' }))
      .toEqual({ modes: { seasonal: { open: [GYM], hidden: [BITCOIN_FARM] } }, updatedAt: '2026-11-20T10:00:00.000Z' })
    expect(sanitizeHideoutModules({ modes: { pvp: { open: [], hidden: [] } } })).toBeNull()
    expect(sanitizeHideoutModules('nope')).toBeNull()
    expect(modeModules({ modes: { seasonal: { open: [GYM], hidden: [WALL] } } }, 'seasonal')).toEqual({ open: new Set([GYM]), hidden: new Set([WALL]) })
    expect(modeModules(null, 'seasonal').open.size).toBe(0)
  })
})
