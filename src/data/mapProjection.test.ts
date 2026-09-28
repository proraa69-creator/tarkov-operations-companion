import { describe, expect, it } from 'vitest'
import { floorBadge, floorLabel, localizeFloorName, markerFloor, markerPosition, markerVisibleOnFloor, positionToLatLng } from './mapProjection'
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

  it('labels indoor points by building extents and keeps outdoor points on the main floor', () => {
    const map = {
      id: 'customs',
      floors: ['Основной', '2 этаж'],
      layers: [
        { id: 'main', name: 'Основной', heightRange: [-1000, 1000] },
        { name: '2 этаж', ownTiles: true, extents: [{ height: [2.7, 6.5], bounds: [[[243, 190], [165, 125]]] }] },
      ],
    } as GameMap
    expect(markerFloor(map, undefined, [150, 200], 4)).toBe('2 этаж')
    expect(markerFloor(map, undefined, [-50, 200], 4)).toBe('Основной')
    expect(markerFloor(map, undefined, [150, 200], 0)).toBe('Основной')
  })

  it('draws indoor points on the main map and narrows only when a floor is chosen', () => {
    const marker = { id: 'x', mapId: 'customs', type: 'extract' as const, layerId: 'extract.pmc' as const, title: '', description: '', position: [1, 1] as [number, number], floor: '2 этаж' }
    expect(markerVisibleOnFloor(marker, 'Основной')).toBe(true)
    expect(markerVisibleOnFloor(marker, '2 этаж')).toBe(true)
    expect(markerVisibleOnFloor({ ...marker, floor: 'Основной' }, '2 этаж')).toBe(false)
    expect(floorLabel({ floor: undefined })).toBe('Основной')
    expect(floorLabel({ floor: '2 этаж' })).toBe('2 этаж')
    expect(floorBadge('2 этаж')).toBe('2')
    expect(localizeFloorName('2nd Floor')).toBe('2 этаж')
    expect(localizeFloorName('Underground')).toBe('Подземный')
  })

  it('keeps quest markers visible on every floor', () => {
    expect(markerVisibleOnFloor({
      id: 'customs-debut',
      mapId: 'customs',
      type: 'quest',
      layerId: 'quest.zone',
      title: 'Дебют',
      description: '',
      position: [1, 1],
      floor: '2-й этаж',
    }, 'Основной')).toBe(true)
  })
})
