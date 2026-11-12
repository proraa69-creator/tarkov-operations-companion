import { describe, expect, it } from 'vitest'
import { pointDraftState, type PointDraft } from './SuggestPointSection'
import type { GameMap, MapMarker } from '../domain/types'

const GAME_SHOT = '2026-11-10[11-05]_-181.42, 3.27, -77.07_0.02063, -0.84017, 0.03179, 0.54108_11.02 (0).png'
const customs = { id: 'customs', name: 'Таможня', bounds: [[-400, -300], [700, 300]] } as unknown as GameMap
const woods = { id: 'woods', name: 'Лес', bounds: [[1000, 1000], [2000, 2000]] } as unknown as GameMap
const exit = (x: number, z: number): MapMarker => ({ id: `e${x}`, mapId: 'customs', type: 'extract', layerId: 'extract.pmc', title: 'Старая заправка', description: '', position: [z, x] })
const data = (markers: MapMarker[] = []) => ({ maps: [customs, woods], markers })
const draft = (extra: Partial<PointDraft> = {}): PointDraft => ({ icon: 'extract.pmc', name: 'Старая заправка', mapId: 'customs', ...extra })

describe('«Добавить точку»: what is still missing, read from the game screenshot', () => {
  it('needs a game screenshot: none, a renamed one, then the place from its name', () => {
    expect(pointDraftState(draft(), [], data(), 'pvp').problem).toBe('Приложите скриншот из игры.')
    expect(pointDraftState(draft(), [{ name: 'my-photo.png' }], data(), 'pvp').problem).toMatch(/нет координат/)
    const ready = pointDraftState(draft(), [{ name: 'my-photo.png' }, { name: GAME_SHOT }], data(), 'pve')
    expect(ready.problem).toBe('')
    expect(ready.at).toMatchObject({ x: -181.42, y: 3.27, z: -77.07 })
    expect(ready.payload).toEqual({ icon: 'extract.pmc', name: 'Старая заправка', mapId: 'customs', shot: GAME_SHOT, mode: 'pve' })
    expect(ready.topic).toBe('Точка: Выход ЧВК — Старая заправка')
  })

  it('a quest point needs its quest, a key point the key itself', () => {
    expect(pointDraftState(draft({ icon: 'quest.zone' }), [{ name: GAME_SHOT }], data(), 'pvp').problem).toMatch(/квест/)
    expect(pointDraftState(draft({ icon: 'quest.zone', questId: 'q1' }), [{ name: GAME_SHOT }], data(), 'pvp').payload?.questId).toBe('q1')
    expect(pointDraftState(draft({ icon: 'loot.key' }), [{ name: GAME_SHOT }], data(), 'pvp').problem).toMatch(/ключ/)
  })

  it('refuses a screenshot from another map and a point that already stands there', () => {
    expect(pointDraftState(draft({ mapId: 'woods' }), [{ name: GAME_SHOT }], data(), 'pvp').problem).toMatch(/не с этой карты/)
    const twin = pointDraftState(draft(), [{ name: GAME_SHOT }], data([exit(-176, -75)]), 'pvp')
    expect(twin.duplicate).toBe(true)
    expect(twin.payload).toBeUndefined()
    // Another emblem at the same place is a new point.
    expect(pointDraftState(draft({ icon: 'switch', name: 'Рубильник' }), [{ name: GAME_SHOT }], data([exit(-176, -75)]), 'pvp').payload).toBeDefined()
  })
})
