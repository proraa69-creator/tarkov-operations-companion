import { describe, expect, it } from 'vitest'
import type { MapMarker } from '../domain/types'
import { floorBadge, floorLabel } from './mapProjection'
import { withMarkerFloorFixes } from './markerFloorFixes'

const point = (id: string, floor = 'Основной'): MapMarker => ({ id, mapId: 'streets-of-tarkov', type: 'quest', layerId: 'quest.zone', title: 'Квест', description: '', position: [0, 0], floor })

describe('points on another floor than their height says (reports №87, №88)', () => {
  it('the clinic\'s second floor', () => {
    const [ward, nursery, xray] = withMarkerFloorFixes([
      point('streets-of-tarkov-quest-zone-66d9cbb67b491f9d5304f6e6-Zone_silient_hill_ward'),
      point('streets-of-tarkov-quest-zone-64f731ab83cfca080a361e42-quest_zone_find_2st_med_invent1'),
      point('streets-of-tarkov-quest-zone-64f731ab83cfca080a361e42-quest_zone_find_2st_med_invent2'),
    ])
    for (const marker of [ward!, nursery!, xray!]) {
      expect(floorLabel(marker)).toBe('2 этаж')
      expect(floorBadge(marker.floor)).toBe('2')
    }
  })

  it('the parking under Concordia, whatever language the objective is in', () => {
    const fixed = withMarkerFloorFixes([
      point('streets-of-tarkov-quest-item-639135e8c115f907b14700aa-Найти данные о движении транспорта-1'),
      point('streets-of-tarkov-quest-item-639135e8c115f907b14700aa-Obtain the data on vehicle movement-1'),
    ])
    expect(fixed.map((marker) => marker.floor)).toEqual(['Подземный', 'Подземный'])
  })

  it('the casting room on Ground Zero is the third floor (report of 10.11.2026)', () => {
    const [chair] = withMarkerFloorFixes([{ ...point('ground-zero-quest-zone-66d9cbb67b491f9d5304f6e6-zone_six_chair', '2 этаж'), mapId: 'ground-zero' }])
    expect(chair!.floor).toBe('3 этаж')
  })

  it('other points are left alone, and nothing changes the list when there is nothing to fix', () => {
    const others = [point('streets-of-tarkov-quest-zone-64f731ab83cfca080a361e42-Pharma_1'), point('customs-quest-zone-x')]
    expect(withMarkerFloorFixes(others)).toBe(others)
  })
})
