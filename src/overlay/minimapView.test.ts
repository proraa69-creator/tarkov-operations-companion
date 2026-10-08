import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MinimapMarker, MinimapPayload } from './types'
import {
  MINIMAP_VIEW_KEY, NO_QUEST, ROOM_HEIGHT_M, ROOM_SPAN_M, STOP_MIN_SPAN_M, clearQuest, clusterPoints, gameLatLng, pointsBounds, pressQuest, questClusters,
  questStepLabel, questTarget, readMinimapView, saveMinimapView, stablePayload, type QuestCycle,
} from './minimapView'

const point = (id: string, z: number, x: number, height?: number, questId = 'q1'): MinimapMarker =>
  ({ id, position: [z, x], height, layerId: 'quest.item', title: id, questId })

describe('saved minimap view', () => {
  afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks() })

  it('keeps the centre and zoom of each map apart', () => {
    saveMinimapView('woods', { center: [10, 20], zoom: 1.5 })
    saveMinimapView('customs', { center: [-5, 3], zoom: 3 })
    expect(readMinimapView('woods')).toEqual({ center: [10, 20], zoom: 1.5 })
    expect(readMinimapView('customs')).toEqual({ center: [-5, 3], zoom: 3 })
    expect(readMinimapView('factory')).toBeNull()
  })

  it('ignores broken data and blocked storage', () => {
    window.localStorage.setItem(MINIMAP_VIEW_KEY, '{not json')
    expect(readMinimapView('woods')).toBeNull()
    window.localStorage.setItem(MINIMAP_VIEW_KEY, JSON.stringify({ woods: { center: [1], zoom: 'x' } }))
    expect(readMinimapView('woods')).toBeNull()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => saveMinimapView('woods', { center: [1, 2], zoom: 2 })).not.toThrow()
    expect(readMinimapView('woods')).toBeNull()
  })
})

describe('quest points grouped by room', () => {
  it('keeps item spawns of one room together and splits rooms and buildings', () => {
    const clusters = clusterPoints([
      point('shelf-a', 0, 0, 1), point('far', 100, 100, 1), point('shelf-b', 4, 6, 2.2), point('table', -3, 5, 0.5),
    ])
    expect(clusters.map((members) => members.map((member) => member.id))).toEqual([['shelf-a', 'shelf-b', 'table'], ['far']])
  })

  it('splits the same spot on different floors and ignores height when it is unknown', () => {
    expect(clusterPoints([point('ground', 0, 0, 0), point('upstairs', 1, 1, 4)])).toHaveLength(2)
    expect(clusterPoints([point('ground', 0, 0, 0), point('unknown', 1, 1)])).toHaveLength(1)
  })

  it('does not chain a row of rooms into one group', () => {
    const step = ROOM_SPAN_M * 0.75
    const clusters = clusterPoints([0, 1, 2, 3].map((index) => point(`r${index}`, 0, index * step)))
    expect(clusters.map((members) => members.map((member) => member.id))).toEqual([['r0', 'r1'], ['r2', 'r3']])
  })

  it('counts points up to 12 m apart and 2.5 m in height as one room, farther ones as another stop', () => {
    expect(clusterPoints([point('a', 0, 0, 1), point('b', 0, ROOM_SPAN_M, 1 + ROOM_HEIGHT_M)])).toHaveLength(1)
    expect(clusterPoints([point('a', 0, 0, 1), point('b', 0, ROOM_SPAN_M + 0.5, 1)])).toHaveLength(2)
    expect(clusterPoints([point('a', 0, 0, 1), point('b', 0, 1, 1 + ROOM_HEIGHT_M + 0.5)])).toHaveLength(2)
    // Horizontal distance only (x and z): the height never adds to it.
    expect(clusterPoints([point('a', 0, 0, 0), point('b', 6, 8, 2)])).toHaveLength(1)
  })

  it('takes only the chosen quest', () => {
    const markers = [point('a', 0, 0), point('b', 50, 0, undefined, 'q2'), point('c', 80, 0)]
    expect(questClusters(markers, 'q1').map((members) => members.map((member) => member.id))).toEqual([['a'], ['c']])
    expect(questClusters(markers, null)).toEqual([])
  })
})

describe('quest button cycle', () => {
  // Three stops: a lone shelf, a room of two shelves, a building far away.
  const markers = [point('a', 0, 0, 1), point('b', 50, 0, 1), point('b2', 52, 1, 1.5), point('far', -300, 400, 1)]
  const clusters = questClusters(markers, 'q1')
  const press = (cycle: QuestCycle, questId = 'q1', stops = clusters.length) => pressQuest(cycle, questId, stops)
  const targetOf = (cycle: QuestCycle) => questTarget(clusters, cycle.step)

  it('goes stop by stop, then shows every point of the quest, then the first stop again', () => {
    expect(clusters).toHaveLength(3)
    let cycle = press(NO_QUEST)
    expect(targetOf(cycle)).toMatchObject({ kind: 'stop', index: 0, count: 3, points: [[0, 0]] })
    expect(questStepLabel(targetOf(cycle))).toBe('Точка 1 из 3')
    cycle = press(cycle)
    expect(targetOf(cycle)).toMatchObject({ kind: 'stop', index: 1, points: [[50, 0], [52, 1]] })
    cycle = press(cycle)
    expect(targetOf(cycle)).toMatchObject({ kind: 'stop', index: 2, points: [[-300, 400]] })
    expect(questStepLabel(targetOf(cycle))).toBe('Точка 3 из 3')
    cycle = press(cycle)
    // The overview fits all four points (not the whole map: there are several stops).
    expect(targetOf(cycle)).toEqual({ kind: 'overview', count: 3, wholeMap: false, points: [[0, 0], [50, 0], [52, 1], [-300, 400]], bounds: [[-300, 0], [52, 400]] })
    expect(questStepLabel(targetOf(cycle))).toBe('Все точки задания')
    // Wraps around to the first stop, and keeps going.
    cycle = press(cycle)
    expect(targetOf(cycle)).toMatchObject({ kind: 'stop', index: 0 })
    cycle = press(cycle)
    expect(targetOf(cycle)).toMatchObject({ kind: 'stop', index: 1 })
    expect(cycle.seq).toBe(6)
  })

  it('a single stop takes turns with the whole map', () => {
    const single = questClusters([point('shelf-a', 10, 10, 1), point('shelf-b', 14, 13, 1.2)], 'q1')
    expect(single).toHaveLength(1)
    let cycle = pressQuest(NO_QUEST, 'q1', 1)
    expect(questTarget(single, cycle.step)).toMatchObject({ kind: 'stop', index: 0, count: 1 })
    expect(questStepLabel(questTarget(single, cycle.step))).toBe('')
    cycle = pressQuest(cycle, 'q1', 1)
    expect(questTarget(single, cycle.step)).toMatchObject({ kind: 'overview', wholeMap: true })
    expect(questStepLabel(questTarget(single, cycle.step))).toBe('Вся карта')
    cycle = pressQuest(cycle, 'q1', 1)
    expect(questTarget(single, cycle.step)).toMatchObject({ kind: 'stop', index: 0 })
  })

  it('another quest starts at its first stop; clearing starts over', () => {
    let cycle = press(press(NO_QUEST))
    expect(cycle.step).toBe(1)
    cycle = press(cycle, 'q2', 5)
    expect(cycle).toMatchObject({ questId: 'q2', step: 0 })
    const cleared = clearQuest(cycle)
    expect(cleared).toMatchObject({ questId: null, step: 0, seq: cycle.seq + 1 })
    expect(press(cleared, 'q2', 5)).toMatchObject({ questId: 'q2', step: 0 })
  })

  it('a step kept from before the points changed still lands on a stop or the overview', () => {
    // Was on the 3rd stop (step 2) or the overview (step 3) of a 3-stop quest; now the quest has 1 stop left.
    expect(questTarget(clusters.slice(0, 1), 2)).toMatchObject({ kind: 'stop', index: 0 })
    expect(questTarget(clusters.slice(0, 1), 3)).toMatchObject({ kind: 'overview', wholeMap: true })
    // Step 7 of a 1-stop quest reads as its overview: the next press goes to the stop.
    expect(pressQuest({ questId: 'q1', step: 7, seq: 2 }, 'q1', 1)).toMatchObject({ step: 0, seq: 3 })
    expect(pressQuest({ questId: 'q1', step: 6, seq: 2 }, 'q1', 1)).toMatchObject({ step: 1, seq: 3 })
    expect(questTarget(clusters, Number.NaN)).toMatchObject({ kind: 'stop', index: 0 })
  })

  it('has nothing to show for a quest without points', () => {
    expect(questTarget([], 0)).toBeNull()
    expect(questStepLabel(null)).toBe('')
  })
})

describe('quest bounds', () => {
  it('are never NaN or empty: broken positions are left out, a single point gets the smallest stop box', () => {
    const broken = [
      point('ok', 10, 20), { ...point('nan', 0, 0), position: [Number.NaN, 5] as [number, number] },
      { ...point('inf', 0, 0), position: [Infinity, 1] as [number, number] }, { ...point('none', 0, 0), position: undefined as unknown as [number, number] },
    ]
    const stops = questClusters(broken, 'q1')
    expect(stops.flat().map((marker) => marker.id)).toEqual(['ok'])
    const target = questTarget(stops, 0)!
    const half = STOP_MIN_SPAN_M / 2
    expect(target.bounds).toEqual([[10 - half, 20 - half], [10 + half, 20 + half]])
    expect(target.bounds.flat().every(Number.isFinite)).toBe(true)
    expect(pointsBounds([])).toBeNull()
    expect(pointsBounds([[Number.NaN, 1]])).toBeNull()
    expect(pointsBounds([[1, 2], [5, -3]], Number.NaN)).toEqual([[1, -3], [5, 2]])
  })

  it('keep Leaflet order: [[south, west], [north, east]] in [z, x], from game x/z and never the height', () => {
    // A screenshot position: x east, y the height (Unity is Y-up), z north.
    expect(gameLatLng({ x: 120, z: -45 })).toEqual([-45, 120])
    expect(gameLatLng({ x: 120, y: 3.5, z: -45 } as { x: number; z: number })).toEqual([-45, 120])
    expect(pointsBounds([gameLatLng({ x: 300, z: 10 }), gameLatLng({ x: -20, z: 90 })])).toEqual([[10, -20], [90, 300]])
    const [[south, west], [north, east]] = questTarget(questClusters([point('p', -45, 120), point('q', 400, -300)], 'q1'), 2)!.bounds
    expect(south).toBeLessThan(north)
    expect(west).toBeLessThan(east)
    expect([south, west, north, east]).toEqual([-45, -300, 400, 120])
  })
})

describe('payload kept stable', () => {
  const payload = (opacity: number, markers = [point('a', 1, 2)]): MinimapPayload => ({
    state: 'ready', map: { id: 'woods', name: 'Лес', layers: [{ id: 'main', name: 'Основной' }] } as unknown as Extract<MinimapPayload, { state: 'ready' }>['map'],
    markers, quests: [], questCount: 0, opacity,
  })

  it('keeps the old map, markers and quests when only the settings changed', () => {
    const first = payload(0.9)
    const next = stablePayload(first, payload(0.5)) as Extract<MinimapPayload, { state: 'ready' }>
    expect(next.opacity).toBe(0.5)
    expect(next.map).toBe((first as typeof next).map)
    expect(next.markers).toBe((first as typeof next).markers)
  })

  it('takes new markers or another map as they come', () => {
    const first = payload(0.9) as Extract<MinimapPayload, { state: 'ready' }>
    const moved = stablePayload(first, payload(0.9, [point('a', 5, 5)])) as typeof first
    expect(moved.markers).not.toBe(first.markers)
    expect(moved.map).toBe(first.map)
    const other = { ...payload(0.9), map: { ...first.map, id: 'customs' } } as typeof first
    expect((stablePayload(first, other) as typeof first).map.id).toBe('customs')
    expect(stablePayload(null, first)).toBe(first)
    expect(stablePayload(first, { state: 'no-data' })).toEqual({ state: 'no-data' })
  })
})
