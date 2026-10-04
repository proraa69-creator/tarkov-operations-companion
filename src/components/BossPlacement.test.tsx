import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapMarker } from '../domain/types'

type Placed = { bossKey: string; x: number; z: number; hidden?: boolean }
const editor = vi.hoisted(() => ({
  place: vi.fn<(placement: Placed) => Promise<void>>(async () => {}),
  remove: vi.fn<(id: string) => Promise<void>>(async () => {}),
}))
vi.mock('../app/buildEdition', () => ({ isOwnerApp: () => true }))
vi.mock('../data/mapBossPlacements', async (importOriginal) => ({ ...(await importOriginal<typeof import('../data/mapBossPlacements')>()), useMapBossEditor: () => editor }))

const { useBossPlacement } = await import('./BossPlacement')

const auto = (id: string, key: string, position: [number, number]): MapMarker => ({ id, mapId: 'customs', type: 'boss', layerId: 'boss', title: key, description: '', position, boss: { key, name: key === 'reshala' ? 'Решала' : key }, source: 'json.tarkov.dev/maps' })
const manual = (id: string, key: string, position: [number, number]): MapMarker => ({ ...auto(`owner-boss-${id}`, key, position), source: 'owner-placed' })

describe('«Расставить боссов»: drag, delete and replace save at once', () => {
  beforeEach(() => { editor.place.mockClear(); editor.remove.mockClear() })

  it('dragging an automatic boss keeps its other points and saves the moved one', async () => {
    const a = auto('a', 'reshala', [10, 20]), b = auto('b', 'reshala', [30, 40])
    const { result } = renderHook(() => useBossPlacement('customs', 'Основной', 'Основной', [a, b]))
    await act(async () => { await result.current.move(a, 25, 15) })
    expect(editor.place.mock.calls.map(([p]) => [p.x, p.z, p.hidden ?? false])).toEqual([[40, 30, false], [25, 15, false]])
    expect(editor.remove).not.toHaveBeenCalled()
  })

  it('dragging a hand-placed boss places it anew and removes the old point', async () => {
    const m = manual('c'.repeat(24), 'killa', [5, 6])
    const { result } = renderHook(() => useBossPlacement('customs', 'Основной', 'Основной', [m]))
    await act(async () => { await result.current.move(m, 7, 8) })
    expect(editor.place).toHaveBeenCalledWith(expect.objectContaining({ bossKey: 'killa', x: 7, z: 8 }))
    expect(editor.remove).toHaveBeenCalledWith('c'.repeat(24))
  })

  it('deleting the only automatic point leaves a hidden placement; replacing swaps the boss', async () => {
    const a = auto('a', 'reshala', [10, 20])
    const { result } = renderHook(() => useBossPlacement('customs', 'Основной', 'Основной', [a]))
    await act(async () => { await result.current.remove(a) })
    expect(editor.place).toHaveBeenCalledWith(expect.objectContaining({ bossKey: 'reshala', hidden: true }))
    editor.place.mockClear()
    await act(async () => { await result.current.replace(a, 'killa') })
    expect(editor.place.mock.calls.map(([p]) => [p.bossKey, p.hidden ?? false])).toEqual([['killa', false], ['reshala', true]])
  })
})
