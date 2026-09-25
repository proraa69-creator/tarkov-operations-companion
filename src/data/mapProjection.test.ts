import { describe, expect, it } from 'vitest'
import { markerFloor, markerPosition, positionToLatLng } from './mapProjection'
import type { GameMap } from '../domain/types'

describe('map projection helpers', () => {
  it('projects Tarkov x/z positions into Leaflet lat/lng pairs', () => {
    expect(positionToLatLng({ x: 12, y: 3, z: -45 })).toEqual([-45, 12])
  })

  it('uses outline center when a zone polygon is available', () => {
    expect(markerPosition(undefined, [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ])).toEqual([5, 5])
  })

  it('matches markers to floors by overlapping height range', () => {
    const map = {
      id: 'test',
      layers: [
        { name: 'Основной', heightRange: [-5, 5] },
        { name: '2-й этаж', heightRange: [6, 12] },
      ],
      floors: ['Основной', '2-й этаж'],
    } as GameMap
    expect(markerFloor(map, [7, 8])).toBe('2-й этаж')
  })
})
