import { describe, expect, it } from 'vitest'
import type { MapMarker, MarkerLayerId } from '../domain/types'
import { adaptLiveMapMarkers } from '../data/mapMarkerAdapter'
import { maps } from '../data/demo'
import { MAP_PLACE_SIGNS } from '../data/mapPlaceSigns'
import { exitFanOut } from './exitFan'

const exit = (id: string, layerId: MarkerLayerId, title: string, position: [number, number] = [0, 0]) => ({ id, layerId, title, position, type: 'extract' }) as unknown as MapMarker

describe('exits of one place', () => {
  it('stand side by side, the PMC’s at the left, with one name when they share it', () => {
    const fan = exitFanOut([exit('scav', 'extract.scav', 'Ворота'), exit('pmc', 'extract.pmc', 'ворота ')])
    expect(fan.get('pmc')).toMatchObject({ shift: -15 })
    expect(fan.get('pmc')?.nameStyle).toContain('15px')
    expect(fan.get('scav')).toEqual({ shift: 15, noName: true })
  })

  it('names that differ both stay, at different heights', () => {
    const fan = exitFanOut([exit('a', 'extract.pmc', 'А-Выход'), exit('b', 'extract.scav', 'Старая дорога', [1, 1])])
    expect(fan.get('a')?.noName).toBeUndefined()
    expect(fan.get('b')?.nameStyle).toContain('top')
  })

  it('an exit alone, or further off, is not moved', () => {
    const fan = exitFanOut([exit('a', 'extract.pmc', 'А'), exit('b', 'extract.scav', 'Б', [0, 20])])
    expect(fan.size).toBe(0)
  })
})

describe('the exits’ marks', () => {
  const customs = maps.find((map) => map.id === 'customs')!
  const context = { maps: [customs], quests: [], items: new Map(), mapNameByApiId: new Map<string, string>() }
  const position = { x: 10, y: 0, z: 10 }
  const marks = (extracts: unknown[]) => adaptLiveMapMarkers({ maps: { a: { normalizedName: 'customs', extracts } } }, {}, context).filter((marker) => marker.type === 'extract')

  it('an exit both sides may use alone is a mark for each', () => {
    const [pmc, scav] = marks([{ id: 'train', faction: 'shared', name: 'Бронепоезд', position }])
    expect(pmc).toMatchObject({ layerId: 'extract.pmc', extractFaction: 'pmc', title: 'Бронепоезд', requiresCoop: false })
    expect(scav).toMatchObject({ layerId: 'extract.scav', extractFaction: 'scav', title: 'Бронепоезд', extractId: 'train', requiresCoop: false })
    expect(scav.id).toBe(`${pmc.id}--scav`)
  })

  it('a true co-op exit stays one, in either language', () => {
    for (const name of ['Подвал котельной (Совм.)', 'Boiler Room Basement (Co-op)', 'Friendship Bridge (Co-Op)', 'Exit_E10_coop']) {
      const found = marks([{ id: 'boiler', faction: 'shared', name, position }])
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({ layerId: 'extract.coop', requiresCoop: true })
    }
  })

  it('every mark says only its own side', () => {
    const [pmc, scav] = marks([{ id: 'train', faction: 'shared', name: 'Бронепоезд', position }])
    expect(pmc.description).toContain('Выход ЧВК')
    expect(pmc.description).not.toContain('Диких')
    expect(scav.description).toContain('Выход Диких')
    expect(scav.description).not.toContain('ЧВК')
  })
})

describe('the place signs', () => {
  it('name no construction sites, ruins or holes', () => {
    const texts = Object.values(MAP_PLACE_SIGNS).flat().map((sign) => sign.sign)
    for (const word of ['Стройка', 'Старая стройка', 'Каркас', 'Притон', 'Заброшенный завод', 'Дыра', 'Яма', 'Пролом', 'Красный кирпич', 'Хижина']) expect(texts).not.toContain(word)
    for (const word of ['ТЦ Климов', 'Шестёрочка', 'Дом стримера', 'Белый ферзь', 'Пирс']) expect(texts).toContain(word)
  })
})
