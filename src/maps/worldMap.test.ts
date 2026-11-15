import { describe, expect, it } from 'vitest'
import { latLng } from 'leaflet'
import { createMapCrs } from '../components/mapCrs'
import { withMapGeometry } from '../data/mapGeometry'
import { createModeProgress } from '../domain/progress'
import type { GameMap, MapMarker, Quest } from '../domain/types'
import { LABEL_AT, WORLD_LAYOUT, WORLD_SIZE, labelPoint, locationAt, locationPixel, pictureSize, rectsMeet, placeLocation, toWorld, worldBounds, worldLatLng, worldTiles } from './worldMap'
import { worldPlacements, worldQuestPoints } from './worldMapQuests'

const mapOf = (id: string, extra: Partial<GameMap> = {}): GameMap => withMapGeometry({
  id, name: id, subtitle: '', raidTime: 40, players: '', difficulty: 'Средняя', accent: '#888', markerCount: 0, ...extra,
})
const LOCATIONS = Object.keys(WORLD_LAYOUT).map((id) => mapOf(id))

describe('world map transform', () => {
  it('projects a game point as the location map\'s own Leaflet CRS does at zoom 0', () => {
    for (const map of LOCATIONS) {
      const crs = createMapCrs(map)
      const [[x1, z1], [x2, z2]] = map.bounds!
      for (const [z, x] of [[z1, x1], [z2, x2], [(z1 + z2) / 2, (x1 + x2) / 3], [17.5, -42.25]] as Array<[number, number]>) {
        const leaflet = crs.latLngToPoint(latLng(z, x), 0)
        const [px, py] = locationPixel(map, [z, x])
        expect(px, map.id).toBeCloseTo(leaflet.x, 6)
        expect(py, map.id).toBeCloseTo(leaflet.y, 6)
      }
    }
  })

  it('gives a game metre the location scale on the drawing, the same along both axes', () => {
    for (const map of LOCATIONS) {
      const placement = placeLocation(map)!
      const a = toWorld(placement, map, [10, 20])
      const b = toWorld(placement, map, [10, 120])
      const c = toWorld(placement, map, [110, 20])
      const metre = WORLD_LAYOUT[map.id]!.scale
      expect(Math.hypot(b[0] - a[0], b[1] - a[1]), map.id).toBeCloseTo(100 * metre, 6)
      expect(Math.hypot(c[0] - a[0], c[1] - a[1]), map.id).toBeCloseTo(100 * metre, 6)
    }
  })

  it('puts the corners of the scheme\'s bounds on the corners of the location\'s place, centred on its layout point', () => {
    for (const map of LOCATIONS) {
      const placement = placeLocation(map)!
      const [[x1, z1], [x2, z2]] = map.svgBounds ?? map.bounds!
      const corners = [[z1, x1], [z1, x2], [z2, x1], [z2, x2]].map(([z, x]) => toWorld(placement, map, [z, x]))
      const [[rx1, ry1], [rx2, ry2]] = placement.rect
      for (const [x, y] of corners) {
        expect([rx1, rx2].some((edge) => Math.abs(edge - x) < 1e-6), map.id).toBe(true)
        expect([ry1, ry2].some((edge) => Math.abs(edge - y) < 1e-6), map.id).toBe(true)
      }
      expect((rx1 + rx2) / 2).toBeCloseTo(WORLD_LAYOUT[map.id]!.center[0], 6)
      expect((ry1 + ry2) / 2).toBeCloseTo(WORLD_LAYOUT[map.id]!.center[1], 6)
    }
  })

  it('keeps the same relative place inside the location as on its own map', () => {
    // Customs: a point a third across and a quarter down the scheme stays there on the canvas
    const map = mapOf('customs')
    const placement = placeLocation(map)!
    const crs = createMapCrs(map)
    const [[x1, z1], [x2, z2]] = map.bounds!
    const point: [number, number] = [z1 + (z2 - z1) * 0.25, x1 + (x2 - x1) / 3]
    const nw = crs.latLngToPoint(latLng(Math.max(z1, z2), Math.min(x1, x2)), 0)
    const se = crs.latLngToPoint(latLng(Math.min(z1, z2), Math.max(x1, x2)), 0)
    const own = crs.latLngToPoint(latLng(...point), 0)
    const ownShare = [(own.x - Math.min(nw.x, se.x)) / Math.abs(se.x - nw.x), (own.y - Math.min(nw.y, se.y)) / Math.abs(se.y - nw.y)]
    const [wx, wy] = toWorld(placement, map, point)
    const [[rx1, ry1], [rx2, ry2]] = placement.rect
    expect((wx - rx1) / (rx2 - rx1)).toBeCloseTo(ownShare[0]!, 6)
    expect((wy - ry1) / (ry2 - ry1)).toBeCloseTo(ownShare[1]!, 6)
  })

  it('puts the centre of every location on the drawing', () => {
    for (const map of LOCATIONS) {
      const [[x1, y1], [x2, y2]] = placeLocation(map)!.rect
      for (const value of [(x1 + x2) / 2, (y1 + y2) / 2]) {
        expect(value, map.id).toBeGreaterThan(0)
        expect(value, map.id).toBeLessThan(WORLD_SIZE)
      }
    }
  })

  it('puts every name on the drawing, at its own spot or over the top middle of its place', () => {
    for (const map of LOCATIONS) {
      const placement = placeLocation(map)!
      const [x, y] = labelPoint(placement)
      expect(x, map.id).toBeGreaterThan(0)
      expect(x, map.id).toBeLessThan(WORLD_SIZE)
      expect(y, map.id).toBeGreaterThan(0)
      if (!LABEL_AT[map.id]) expect(y).toBe(placement.rect[0][1])
    }
  })

  it('finds the location under a point, the smaller one where two places overlap', () => {
    const placed = LOCATIONS.map((map) => placeLocation(map)!)
    const customs = placed.find((placement) => placement.mapId === 'customs')!
    const factory = placed.find((placement) => placement.mapId === 'factory')!
    const centre = (placement: typeof customs): [number, number] => [(placement.rect[0][0] + placement.rect[1][0]) / 2, (placement.rect[0][1] + placement.rect[1][1]) / 2]
    expect(locationAt(placed, centre(customs))).toBe('customs')
    expect(rectsMeet(customs.rect, factory.rect)).toBe(true)
    expect(locationAt(placed, centre(factory))).toBe('factory')
    expect(locationAt(placed, [WORLD_SIZE - 5, WORLD_SIZE / 2])).toBeNull()
  })

  it('keeps the light pictures small and the close ones sharp but bounded, in the proportions of the place', () => {
    for (const map of LOCATIONS) {
      const placement = placeLocation(map)!
      const [[x1, y1], [x2, y2]] = placement.rect
      for (const close of [false, true]) {
        const [width, height] = pictureSize(placement, close)
        expect(Math.max(width, height), map.id).toBeLessThanOrEqual(close ? 2560 : 768)
        expect(Math.max(width, height), map.id).toBeGreaterThanOrEqual(close ? 1024 : 256)
        expect(width / height).toBeCloseTo((x2 - x1) / (y2 - y1), 1)
      }
    }
  })

  it('leaves out a location with no geometry or no place in the layout', () => {
    expect(placeLocation(mapOf('icebreaker'))).toBeNull()
    expect(placeLocation({ id: 'customs' })).toBeNull()
  })

  it('draws the canvas in CRS.Simple with y down', () => {
    expect(worldLatLng([5, 7])).toEqual([-7, 5])
    expect(worldBounds([[0, 0], [10, 20]])).toEqual([[-20, 0], [-0, 10]])
  })

  it('places a scheme-less location\'s tiles over its bounds, inside the zooms it has', () => {
    const lab = mapOf('the-lab', { tileUrl: 'https://raidos.app/v1/map-tiles/maps/labs/{z}/{x}/{y}.png', tileSize: 175, minZoom: 2, maxZoom: 6 })
    const placement = placeLocation(lab)!
    const tiles = worldTiles(lab, placement)
    expect(tiles.length).toBeGreaterThan(4)
    expect(tiles.every((tile) => /\/3\/\d+\/\d+\.png$/.test(tile.url))).toBe(true)
    const [[rx1, ry1], [rx2, ry2]] = placement.rect
    const xs = tiles.flatMap((tile) => [tile.rect[0][0], tile.rect[1][0]])
    const ys = tiles.flatMap((tile) => [tile.rect[0][1], tile.rect[1][1]])
    expect(Math.min(...xs)).toBeLessThanOrEqual(rx1 + 1e-6)
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(rx2 - 1e-6)
    expect(Math.min(...ys)).toBeLessThanOrEqual(ry1 + 1e-6)
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(ry2 - 1e-6)
  })
})

describe('world map quest points', () => {
  const quest = (id: string, extra: Partial<Quest> = {}) => ({ id, name: id, trader: 'Prapor', mapId: 'customs', objectives: [], ...extra }) as unknown as Quest
  const marker = (id: string, questId: string, mapId: string, extra: Partial<MapMarker> = {}): MapMarker => ({
    id, mapId, type: 'quest', layerId: 'quest.zone', title: id, description: '', position: [10, 20], questId, ...extra,
  })
  const progress = createModeProgress()
  progress.taskProgress = {
    held: { taskId: 'held', status: 'active', source: 'eft-log', updatedAt: '2026-11-15T00:00:00Z' },
    woods: { taskId: 'woods', status: 'active', source: 'eft-log', updatedAt: '2026-11-15T00:00:00Z' },
    checked: { taskId: 'checked', status: 'active', source: 'eft-log', updatedAt: '2026-11-15T00:00:00Z' },
    done: { taskId: 'done', status: 'completed', source: 'eft-log', updatedAt: '2026-11-15T00:00:00Z' },
  }
  const maps = [mapOf('customs'), mapOf('woods'), mapOf('icebreaker')]
  const quests = [quest('held'), quest('woods', { mapId: 'woods' }), quest('checked'), quest('done')]
  const markers = [
    marker('a', 'held', 'customs'),
    marker('fallback', 'held', 'customs', { source: 'quest-fallback' }),
    marker('b', 'woods', 'woods', { position: [-100, 300] }),
    marker('c', 'checked', 'customs'),
    marker('d', 'done', 'customs'),
    marker('elsewhere', 'held', 'woods'),
    marker('loot', 'held', 'customs', { type: 'key', layerId: 'loot.key' }),
  ]

  it('takes the current quests\' own points of every location, on their place on the canvas', () => {
    const placements = worldPlacements(maps)
    const points = worldQuestPoints({ quests, markers, maps, progress, checked: new Set(['checked']), deferred: new Set(), placements })
    expect(points.map((point) => point.marker.id).sort()).toEqual(['a', 'b'])
    const b = points.find((point) => point.marker.id === 'b')!
    expect(b.world).toEqual(toWorld(placements.get('woods')!, maps[1]!, [-100, 300]))
    expect(b.href).toBe('/maps/woods?quest=woods')
  })

  it('leaves out quests put aside', () => {
    const points = worldQuestPoints({ quests, markers, maps, progress, checked: new Set(), deferred: new Set(['held']) })
    expect(points.map((point) => point.marker.id).sort()).toEqual(['b', 'c'])
  })

  it('opens the quest on its objective', () => {
    const points = worldQuestPoints({ quests, markers: [marker('o', 'held', 'customs', { objectiveId: 'obj 1' })], maps, progress, checked: new Set(), deferred: new Set() })
    expect(points[0]!.href).toBe('/maps/customs?quest=held&objective=obj%201')
  })
})
