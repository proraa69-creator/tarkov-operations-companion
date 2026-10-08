import { describe, expect, it } from 'vitest'
import { floorBadge, floorLabel, localizeFloorName, markerFloor, markerPosition, markerVisibleOnFloor, playerFloor, positionToLatLng } from './mapProjection'
import { adaptMapRenderingConfigs } from './mapConfigClient'
import type { GameMap } from '../domain/types'

/** A map as the live catalog builds it from tarkov.dev maps.json (the heights and building boxes published there). */
function liveMap(id: string, heightRange: number[] | undefined, layers: Array<{ name: string; extents: Array<{ height: number[]; bounds?: unknown[] }> }>) {
  const config = adaptMapRenderingConfigs([{ normalizedName: id, maps: [{ key: id, tilePath: `https://assets.tarkov.dev/maps/${id}/main/{z}/{x}/{y}.png`, heightRange, layers }] }]).get(id)
  return { id, ...config } as GameMap
}

const labs = liveMap('the-lab', [-0.9, 3], [
  { name: 'Second Level', extents: [{ height: [3, 10000], bounds: [[[-101, -422], [-271, -270]]] }] },
  { name: 'Technical', extents: [{ height: [-10000, -0.9] }] },
])
const interchange = liveMap('interchange', undefined, [
  { name: '2nd Floor', extents: [{ height: [25, 34], bounds: [[[120, 218], [-222, -327], 'mall']] }] },
  { name: '3rd Floor', extents: [{ height: [34, 1000], bounds: [[[120, 218], [-222, -327], 'mall']] }] },
])
const factory = liveMap('factory', [-1, 3], [
  { name: '2nd Floor', extents: [{ height: [3, 6] }] },
  { name: '3rd Floor', extents: [{ height: [6, 10000] }] },
  { name: 'Tunnels', extents: [{ height: [-10000, -1] }] },
])

describe('the floor the player is on (screenshot position)', () => {
  it('finds the Labs second level from a real raid screenshot', () => {
    // 2026-09-04[04-56]_-230.88, 3.59, -375.83_… (src/overlay/screenshotPosition.test.ts): inside the second-level box.
    expect(playerFloor(labs, { x: -230.88, y: 3.59, z: -375.83 })).toBe('2 уровень')
    expect(playerFloor(labs, { x: -50, y: 3.59, z: -375.83 })).toBe('Основной')
    expect(playerFloor(labs, { x: -230.88, y: -2, z: -375.83 })).toBe('Технический уровень')
  })

  it('switches Interchange floors only inside the mall', () => {
    expect(playerFloor(interchange, { x: 0, y: 28, z: -100 })).toBe('2 этаж')
    expect(playerFloor(interchange, { x: 0, y: 40, z: -100 })).toBe('3 этаж')
    // The same height outside the mall box (the parking lot, the roads) stays on the main level.
    expect(playerFloor(interchange, { x: 200, y: 28, z: -100 })).toBe('Основной')
  })

  it('reads Factory floors by height alone', () => {
    expect(playerFloor(factory, { x: 10, y: -2, z: 10 })).toBe('Тоннели')
    expect(playerFloor(factory, { x: 10, y: 1, z: 10 })).toBe('Основной')
    expect(playerFloor(factory, { x: 10, y: 4, z: 10 })).toBe('2 этаж')
  })

  it('puts a height exactly at a border on the floor above, as tarkov.dev does', () => {
    expect(playerFloor(factory, { x: 10, y: 6, z: 10 })).toBe('3 этаж')
    expect(playerFloor(interchange, { x: 0, y: 34, z: -100 })).toBe('3 этаж')
    expect(playerFloor(factory, { x: 10, y: -1, z: 10 })).toBe('Основной')
    // Markers keep their own rule (both ends included): a point at 6 m is still labelled with the 2nd floor.
    expect(markerFloor(factory, undefined, [10, 10], 6)).toBe('2 этаж')
  })

  it('leaves the floor alone without floor heights or a usable position', () => {
    // The offline catalog names the floors but has no heights (src/data/demo.ts).
    expect(playerFloor({ floors: ['Основной', '2-й этаж', '3-й этаж'] }, { x: 0, y: 5, z: 0 })).toBeUndefined()
    expect(playerFloor({ floors: ['Основной'], layers: [{ id: 'main', name: 'Основной', heightRange: [-1000, 1000] }] }, { x: 0, y: 5, z: 0 })).toBeUndefined()
    expect(playerFloor(factory, { x: 10, y: Number.NaN, z: 10 })).toBeUndefined()
  })
})

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

  it('places the marker at the feed position, not at a drifted outline centre', () => {
    // Labs «Parking Gate»: the exit zone is the parking lot outside, the marker belongs at the gate.
    expect(markerPosition({ x: -231.73, z: -434.8 }, [
      { x: -251.9, z: -477.7 }, { x: -211.1, z: -477.7 }, { x: -211.1, z: -437 }, { x: -251.9, z: -437 },
    ])).toEqual([-434.8, -231.73])
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
