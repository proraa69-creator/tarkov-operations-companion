import { describe, expect, it } from 'vitest'
import type { MapMarker } from '../domain/types'
import { placementIdOf, placementMarker, withOwnerBosses, type MapBossPlacement } from './mapBossPlacements'

const auto = (id: string, mapId: string, key: string): MapMarker => ({ id, mapId, type: 'boss', layerId: 'boss', title: key, description: '', position: [1, 2], boss: { key, name: key }, source: 'json.tarkov.dev/maps' })
const placed: MapBossPlacement = { id: 'a'.repeat(24), mapId: 'interchange', bossKey: 'killa', bossName: 'Килла', x: -12.5, z: 40, createdAt: '2026-10-04T10:00:00.000Z' }

describe('owner-placed bosses', () => {
  it('replace the automatic markers of that boss on that map only', () => {
    const markers = [auto('i-killa', 'interchange', 'killa'), auto('i-tagilla', 'interchange', 'tagilla'), auto('f-killa', 'factory', 'killa'), { ...auto('q', 'interchange', 'killa'), type: 'quest' as const, layerId: 'quest.zone' as const }]
    const result = withOwnerBosses(markers, [placed])
    expect(result.map((marker) => marker.id)).toEqual(['i-tagilla', 'f-killa', 'q', `owner-boss-${placed.id}`])
  })

  it('sit at [z, x] in game metres and keep their floor', () => {
    const marker = placementMarker({ ...placed, floor: '2 этаж' })
    expect(marker.position).toEqual([40, -12.5])
    expect(marker.floor).toBe('2 этаж')
    expect(marker.boss).toEqual({ key: 'killa', name: 'Килла' })
    expect(placementIdOf(marker)).toBe(placed.id)
    expect(placementIdOf(auto('x', 'interchange', 'killa'))).toBeUndefined()
  })

  it('leave the markers untouched while nothing is placed', () => {
    const markers = [auto('i-killa', 'interchange', 'killa')]
    expect(withOwnerBosses(markers, [])).toBe(markers)
  })

  it('a hidden placement (a deleted automatic boss) hides that boss and draws nothing', () => {
    const markers = [auto('i-killa', 'interchange', 'killa'), auto('i-tagilla', 'interchange', 'tagilla')]
    const result = withOwnerBosses(markers, [{ ...placed, hidden: true }])
    expect(result.map((marker) => marker.id)).toEqual(['i-tagilla'])
  })
})
