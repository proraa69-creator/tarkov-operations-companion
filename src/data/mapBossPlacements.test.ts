import { describe, expect, it } from 'vitest'
import type { MapMarker } from '../domain/types'
import { placementIdOf, placementMarker, withOwnerBosses, type MapBossPlacement } from './mapBossPlacements'

const auto = (id: string, mapId: string, key: string): MapMarker => ({ id, mapId, type: 'boss', layerId: 'boss', title: key, description: '', position: [1, 2], boss: { key, name: key }, source: 'json.tarkov.dev/maps' })
const placed: MapBossPlacement = { id: 'a'.repeat(24), mapId: 'interchange', bossKey: 'killa', bossName: 'Килла', x: -12.5, z: 40, createdAt: '2026-10-04T10:00:00.000Z' }

describe('owner-placed bosses', () => {
  it('replace the automatic markers of that boss on that map only', () => {
    const markers = [auto('i-killa', 'interchange', 'killa'), auto('i-tagilla', 'interchange', 'tagilla'), auto('f-killa', 'factory', 'killa'), { ...auto('q', 'interchange', 'killa'), type: 'quest' as const, layerId: 'quest.zone' as const }]
    const result = withOwnerBosses(markers, [placed], 'pvp')
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
    expect(withOwnerBosses(markers, [], 'pvp')).toBe(markers)
  })

  it('a hidden placement (a deleted automatic boss) hides that boss and draws nothing', () => {
    const markers = [auto('i-killa', 'interchange', 'killa'), auto('i-tagilla', 'interchange', 'tagilla')]
    const result = withOwnerBosses(markers, [{ ...placed, hidden: true }], 'pve')
    expect(result.map((marker) => marker.id)).toEqual(['i-tagilla'])
  })

  it('a locked map drops every automatic boss in every mode, only the owner placements stay', () => {
    const markers = [auto('i-killa', 'interchange', 'killa'), auto('i-tagilla', 'interchange', 'tagilla'), auto('f-killa', 'factory', 'killa')]
    const lock: MapBossPlacement = { ...placed, id: 'b'.repeat(24), bossKey: 'map-lock', bossName: 'map-lock', hidden: true }
    const result = withOwnerBosses(markers, [lock, { ...placed, bossKey: 'tagilla', bossName: 'Тагилла' }], 'seasonal')
    expect(result.map((marker) => marker.id)).toEqual(['f-killa', `owner-boss-${placed.id}`])
  })

  it('a placement made in one mode changes only that mode; one without a mode changes every mode', () => {
    const markers = [auto('i-killa', 'interchange', 'killa'), auto('i-tagilla', 'interchange', 'tagilla')]
    const pve: MapBossPlacement = { ...placed, mode: 'pve' }
    const everyMode: MapBossPlacement = { ...placed, id: 'c'.repeat(24), bossKey: 'tagilla', bossName: 'Тагилла' }
    expect(withOwnerBosses(markers, [pve, everyMode], 'pvp').map((marker) => marker.id)).toEqual(['i-killa', `owner-boss-${everyMode.id}`])
    expect(withOwnerBosses(markers, [pve, everyMode], 'pve').map((marker) => marker.id)).toEqual([`owner-boss-${pve.id}`, `owner-boss-${everyMode.id}`])
    expect(withOwnerBosses(markers, [pve], 'seasonal')).toBe(markers)
  })

  it('a placed boss shows the spawn chance of the replaced automatic marker of the same mode, not a zone chance', () => {
    const pvp = [{ ...auto('i-killa', 'interchange', 'killa'), guaranteedSpawn: true, boss: { key: 'killa', name: 'Килла', spawnChance: 1, locationChance: 0.5, locationName: 'Mall' } }]
    const pve = [{ ...auto('i-killa', 'interchange', 'killa'), boss: { key: 'killa', name: 'Килла', spawnChance: 0.35 } }]
    const inPvp = withOwnerBosses(pvp, [placed], 'pvp').find((marker) => marker.id === `owner-boss-${placed.id}`)!
    const inPve = withOwnerBosses(pve, [placed], 'pve').find((marker) => marker.id === `owner-boss-${placed.id}`)!
    expect(inPvp.boss).toMatchObject({ key: 'killa', name: 'Килла', spawnChance: 1 })
    expect(inPvp.boss?.locationChance).toBeUndefined()
    expect(inPvp.guaranteedSpawn).toBe(true)
    expect(inPve.boss?.spawnChance).toBe(0.35)
    expect(inPve.guaranteedSpawn).toBeUndefined()
  })
})
