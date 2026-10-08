import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MinimapMarker } from './types'
import { MINIMAP_VIEW_KEY, NO_QUEST, ROOM_SPAN_M, clearQuest, clusterPoints, pressQuest, questClusters, questTarget, readMinimapView, saveMinimapView } from './minimapView'

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

  it('takes only the chosen quest', () => {
    const markers = [point('a', 0, 0), point('b', 50, 0, undefined, 'q2'), point('c', 80, 0)]
    expect(questClusters(markers, 'q1').map((members) => members.map((member) => member.id))).toEqual([['a'], ['c']])
    expect(questClusters(markers, null)).toEqual([])
  })
})

describe('quest button cycle', () => {
  const clusters = [[point('a', 0, 0)], [point('b', 50, 0), point('b2', 52, 1)]]

  it('goes room by room, then the whole map, then the first room again', () => {
    let cycle = pressQuest(NO_QUEST, 'q1', 2)
    expect(questTarget(clusters, cycle.step)).toEqual({ kind: 'room', points: [[0, 0]] })
    cycle = pressQuest(cycle, 'q1', 2)
    expect(questTarget(clusters, cycle.step)).toEqual({ kind: 'room', points: [[50, 0], [52, 1]] })
    cycle = pressQuest(cycle, 'q1', 2)
    expect(questTarget(clusters, cycle.step)).toEqual({ kind: 'map' })
    cycle = pressQuest(cycle, 'q1', 2)
    expect(cycle.step).toBe(0)
    expect(cycle.seq).toBe(4)
  })

  it('a single room alternates with the whole map; another quest starts at its first room', () => {
    let cycle = pressQuest(NO_QUEST, 'q1', 1)
    cycle = pressQuest(cycle, 'q1', 1)
    expect(cycle.step).toBe(1)
    cycle = pressQuest(cycle, 'q2', 3)
    expect(cycle).toMatchObject({ questId: 'q2', step: 0 })
    expect(clearQuest(cycle)).toMatchObject({ questId: null, step: 0, seq: cycle.seq + 1 })
  })

  it('has nothing to show for a quest without points', () => {
    expect(questTarget([], 0)).toBeNull()
  })
})
