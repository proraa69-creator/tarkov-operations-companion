import { describe, expect, it } from 'vitest'
import type { MapMarker } from '../domain/types'
import { pointMatchesSearch, searchMapCounts, searchNeedle } from './mapSearch'

const names: Record<string, string[]> = { kpp: ['Ключ от военного КПП', 'Military checkpoint key'], cat: ['Фигурка кота', 'Cat figurine'], bolts: ['Болты'] }
const nameOf = (id: string) => names[id] ?? []
const point = (id: string, mapId: string, extra: Partial<MapMarker>): MapMarker => ({ id, mapId, type: 'cache', layerId: 'loot.key', title: 'Ключи: 12', description: '', position: [0, 0], ...extra })

describe('«Найти точку…» finds keys and items by name (report 134)', () => {
  const markers = [
    point('a', 'customs', { keyIds: ['bolts', 'kpp'] }),
    point('b', 'woods', { keyIds: ['kpp'] }),
    point('c', 'customs', { layerId: 'loot.valuable', title: 'Драгоценности', lootIds: ['bolts', 'cat'] }),
    point('d', 'streets-of-tarkov', { layerId: 'loot.valuable', title: 'Драгоценности', lootIds: ['cat'] }),
    point('e', 'streets-of-tarkov', { layerId: 'loot.valuable', title: 'Драгоценности', lootIds: ['cat'] }),
  ]

  it('a point whose title says nothing is found by one of its keys or items, in Russian or English', () => {
    expect(pointMatchesSearch(markers[0]!, searchNeedle('военного кпп'), nameOf)).toBe(true)
    expect(pointMatchesSearch(markers[2]!, searchNeedle('Cat figurine'), nameOf)).toBe(true)
    expect(pointMatchesSearch(markers[2]!, searchNeedle('кпп'), nameOf)).toBe(false)
    expect(pointMatchesSearch(markers[0]!, '', nameOf)).toBe(true)
  })

  it('lists the maps with such points, most first; a word under three letters lists none', () => {
    expect(searchMapCounts(markers, searchNeedle('фигурк'), nameOf)).toEqual([{ mapId: 'streets-of-tarkov', count: 2 }, { mapId: 'customs', count: 1 }])
    expect(searchMapCounts(markers, searchNeedle('КПП'), nameOf)).toEqual([{ mapId: 'customs', count: 1 }, { mapId: 'woods', count: 1 }])
    expect(searchMapCounts(markers, searchNeedle('ко'), nameOf)).toEqual([])
  })
})
