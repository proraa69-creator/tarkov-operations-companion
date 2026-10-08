import { act, renderHook } from '@testing-library/react'
import { StrictMode, useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GameMap } from '../domain/types'
import { useAutoFloor } from './useAutoFloor'

/** Factory floors as tarkov.dev publishes them (height only, no building boxes). */
const factory = {
  id: 'factory',
  floors: ['Основной', '2 этаж', '3 этаж', 'Тоннели'],
  layers: [
    { id: 'main', name: 'Основной', heightRange: [-1, 3] },
    { id: 'layer-0', name: '2 этаж', extents: [{ height: [3, 6] }] },
    { id: 'layer-1', name: '3 этаж', extents: [{ height: [6, 10000] }] },
    { id: 'layer-2', name: 'Тоннели', extents: [{ height: [-10000, -1] }] },
  ],
} as GameMap
/** The same map from the offline catalog: floor names, no heights. */
const offlineFactory = { id: 'factory', floors: ['Подземный', 'Основной', 'Галереи'] } as GameMap
const woods = { id: 'woods', floors: ['Основной'] } as GameMap

type Position = { x: number; y: number; z: number; at: number } | null
const onSecond = { x: 10, y: 4, z: 10, at: 1000 }

/** The map page / minimap: the shown floor in state, switched by the hook. */
function useShownFloor({ map, position, enabled = true }: { map: GameMap; position: Position; enabled?: boolean }) {
  const [floor, setFloor] = useState('Основной')
  const player = useAutoFloor(map, position, setFloor, enabled)
  return { floor, setFloor, player }
}

describe('«Этаж по скриншоту»: the shown floor follows the screenshot', () => {
  it('switches to the player\'s floor once per screenshot and returns that floor', () => {
    const setFloor = vi.fn()
    const { result, rerender } = renderHook((position: Position) => useAutoFloor(factory, position, setFloor), { initialProps: onSecond })
    expect(setFloor).toHaveBeenCalledExactlyOnceWith('2 этаж')
    expect(result.current).toBe('2 этаж')
    // The minimap gets the same position again on every open: a new object, the same screenshot.
    rerender({ ...onSecond })
    expect(setFloor).toHaveBeenCalledOnce()
  })

  it('keeps a floor picked by hand until the next screenshot', () => {
    const { result, rerender } = renderHook(useShownFloor, { initialProps: { map: factory, position: onSecond } })
    expect(result.current.floor).toBe('2 этаж')
    act(() => result.current.setFloor('3 этаж'))
    // A catalog refresh (a new map object) and the same position sent again do not undo the choice.
    rerender({ map: { ...factory }, position: { ...onSecond } })
    expect(result.current.floor).toBe('3 этаж')
    expect(result.current.player).toBe('2 этаж')
    // A new screenshot (the player went down into the tunnels) switches again.
    rerender({ map: factory, position: { x: 10, y: -2, z: 10, at: 2000 } })
    expect(result.current.floor).toBe('Тоннели')
  })

  it('waits for the live floor heights instead of giving up on the offline map', () => {
    const { result, rerender } = renderHook(useShownFloor, { initialProps: { map: offlineFactory, position: onSecond } })
    expect(result.current.floor).toBe('Основной')
    expect(result.current.player).toBeUndefined()
    rerender({ map: factory, position: onSecond })
    expect(result.current.floor).toBe('2 этаж')
  })

  it('wins over the page\'s own floor reset on opening the map, also when Strict Mode runs the effects twice', () => {
    // The Maps page resets the floor to the main level when a map opens; the hook is declared after that reset.
    function useMapsPageFloor({ map, position }: { map: GameMap; position: Position }) {
      const [floor, setFloor] = useState('3 этаж')
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the page's reset, as in MapsPage.tsx
      useEffect(() => { setFloor('Основной') }, [map.id])
      useAutoFloor(map, position, setFloor)
      return floor
    }
    const { result } = renderHook(useMapsPageFloor, { initialProps: { map: factory, position: onSecond }, wrapper: StrictMode })
    expect(result.current).toBe('2 этаж')
  })

  it('stays put while switched off (owner editing modes) and follows afterwards', () => {
    const { result, rerender } = renderHook(useShownFloor, { initialProps: { map: factory, position: onSecond, enabled: false } })
    expect(result.current.floor).toBe('Основной')
    rerender({ map: factory, position: onSecond, enabled: true })
    expect(result.current.floor).toBe('2 этаж')
  })

  it('shows the player\'s floor again when the map is opened again', () => {
    const { result, rerender } = renderHook(useShownFloor, { initialProps: { map: factory, position: onSecond } as { map: GameMap; position: Position } })
    act(() => result.current.setFloor('Основной'))
    // Another map (the position is not drawn there), then back: the page resets the floor and the hook applies it again.
    rerender({ map: woods, position: null })
    act(() => result.current.setFloor('Основной'))
    rerender({ map: factory, position: onSecond })
    expect(result.current.floor).toBe('2 этаж')
  })

  it('does nothing without a position', () => {
    const setFloor = vi.fn()
    const { result } = renderHook(() => useAutoFloor(factory, null, setFloor))
    expect(result.current).toBeUndefined()
    expect(setFloor).not.toHaveBeenCalled()
  })
})
