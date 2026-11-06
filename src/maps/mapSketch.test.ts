import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { addStroke, clearAllMapSketches, editedStrokes, mapSketchKey, readMapSketch, redoStroke, sketchLineWidth, SKETCH_LINE_PX, startEdit, undoStroke, useMapSketch, type SketchStroke } from './mapSketch'

const stroke = (x: number): SketchStroke => ({ zoom: 2, points: [[x, x], [x + 1, x + 1]] })

describe('the history of a drawing', () => {
  it('back takes the last stroke off, forward brings it back, a new stroke forgets what was taken', () => {
    let edit = addStroke(addStroke(startEdit([]), stroke(1)), stroke(2))
    edit = undoStroke(edit)
    expect(editedStrokes(edit)).toEqual([stroke(1)])
    edit = redoStroke(edit)
    expect(editedStrokes(edit)).toEqual([stroke(1), stroke(2)])
    edit = addStroke(undoStroke(edit), stroke(3))
    expect(editedStrokes(edit)).toEqual([stroke(1), stroke(3)])
    expect(redoStroke(edit)).toBe(edit)
  })

  it('back reaches no stroke kept earlier', () => {
    const edit = startEdit([stroke(1)])
    expect(undoStroke(edit)).toBe(edit)
    expect(editedStrokes(undoStroke(addStroke(edit, stroke(2))))).toEqual([stroke(1)])
  })
})

describe('the line of a stroke', () => {
  it('follows the map: half as wide at half the size, twice as wide at twice, a hair at the far end', () => {
    expect(sketchLineWidth(1)).toBe(SKETCH_LINE_PX)
    expect(sketchLineWidth(0.5)).toBe(SKETCH_LINE_PX / 2)
    expect(sketchLineWidth(2)).toBe(SKETCH_LINE_PX * 2)
    expect(sketchLineWidth(0.001)).toBeGreaterThan(0)
  })
})

describe('«Зарисовка» on a map', () => {
  beforeEach(() => localStorage.clear())
  const open = (mapId = 'customs', mode: 'pvp' | 'pve' = 'pvp') => renderHook(({ map, raid }) => useMapSketch('p1', raid, map), { initialProps: { map: mapId, raid: mode } })

  it('✓ keeps it, on this map and mode only; the cross deletes it', () => {
    const { result, rerender } = open()
    expect([result.current.editing, result.current.kept]).toEqual([false, false])
    act(() => result.current.begin())
    act(() => result.current.draw(stroke(1)))
    expect(result.current.strokes).toEqual([stroke(1)])
    // Not kept until ✓.
    expect(localStorage.getItem(mapSketchKey('p1', 'pvp', 'customs'))).toBeNull()
    act(() => result.current.accept())
    expect([result.current.editing, result.current.kept]).toEqual([false, true])
    expect(readMapSketch(mapSketchKey('p1', 'pvp', 'customs'))).toEqual([stroke(1)])

    rerender({ map: 'woods', raid: 'pvp' })
    expect(result.current.strokes).toEqual([])
    rerender({ map: 'customs', raid: 'pve' })
    expect(result.current.strokes).toEqual([])
    rerender({ map: 'customs', raid: 'pvp' })
    expect(result.current.strokes).toEqual([stroke(1)])

    act(() => result.current.close())
    expect([result.current.strokes, result.current.kept]).toEqual([[], false])
    expect(localStorage.getItem(mapSketchKey('p1', 'pvp', 'customs'))).toBeNull()
  })

  it('✕ drops what was drawn this time and leaves what was kept', () => {
    localStorage.setItem(mapSketchKey('p1', 'pvp', 'customs'), JSON.stringify([stroke(1)]))
    const { result } = open()
    act(() => result.current.begin())
    expect([result.current.canUndo, result.current.canRedo]).toEqual([false, false])
    act(() => result.current.draw(stroke(2)))
    expect(result.current.strokes).toEqual([stroke(1), stroke(2)])
    act(() => result.current.undo())
    expect([result.current.canUndo, result.current.canRedo]).toEqual([false, true])
    act(() => result.current.redo())
    expect(result.current.canUndo).toBe(true)
    act(() => result.current.cancel())
    expect([result.current.editing, result.current.strokes]).toEqual([false, [stroke(1)]])
    expect(readMapSketch(mapSketchKey('p1', 'pvp', 'customs'))).toEqual([stroke(1)])
  })

  it('another map drops what was being drawn', () => {
    const { result, rerender } = open()
    act(() => result.current.begin())
    act(() => result.current.draw(stroke(1)))
    rerender({ map: 'woods', raid: 'pvp' })
    expect([result.current.editing, result.current.strokes]).toEqual([false, []])
    rerender({ map: 'customs', raid: 'pvp' })
    expect(result.current.strokes).toEqual([])
  })

  it('a damaged value reads as no drawing; «Удалить все данные» takes them all', () => {
    const key = mapSketchKey('p1', 'pvp', 'customs')
    localStorage.setItem(key, '{not json')
    expect(readMapSketch(key)).toEqual([])
    localStorage.setItem(key, JSON.stringify([{ zoom: 'x', points: [] }, { zoom: 1, points: [[1], [1, 2], ['a', 2]] }]))
    expect(readMapSketch(key)).toEqual([{ zoom: 1, points: [[1, 2]] }])
    clearAllMapSketches()
    expect(localStorage.getItem(key)).toBeNull()
  })
})
