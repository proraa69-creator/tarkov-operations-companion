import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { addStroke, changeStrokes, clearAllMapSketches, eraseStrokes, ERASER_RADIUS_PX, mapSketchKey, readMapSketch, redoStroke, SKETCH_COLORS, SKETCH_DEFAULT_COLOR, sketchLineWidth, SKETCH_LINE_PX, startEdit, undoStroke, useMapSketch, type SketchPoint, type SketchStroke } from './mapSketch'

const stroke = (x: number): SketchStroke => ({ zoom: 2, points: [[x, x], [x + 1, x + 1]] })

describe('the history of a drawing', () => {
  it('back takes the last stroke off, forward brings it back, a new stroke forgets what was taken', () => {
    let edit = addStroke(addStroke(startEdit([]), stroke(1)), stroke(2))
    edit = undoStroke(edit)
    expect(edit.strokes).toEqual([stroke(1)])
    edit = redoStroke(edit)
    expect(edit.strokes).toEqual([stroke(1), stroke(2)])
    edit = addStroke(undoStroke(edit), stroke(3))
    expect(edit.strokes).toEqual([stroke(1), stroke(3)])
    expect(redoStroke(edit)).toBe(edit)
  })

  it('back reaches no stroke kept earlier', () => {
    const edit = startEdit([stroke(1)])
    expect(undoStroke(edit)).toBe(edit)
    expect(undoStroke(addStroke(edit, stroke(2))).strokes).toEqual([stroke(1)])
  })

  it('what the eraser did goes back too, kept strokes with it, as one step', () => {
    const edit = changeStrokes(startEdit([stroke(1), stroke(2)]), [stroke(2)])
    expect(undoStroke(edit).strokes).toEqual([stroke(1), stroke(2)])
    expect(redoStroke(undoStroke(edit)).strokes).toEqual([stroke(2)])
    // The eraser touched nothing: no step.
    expect(changeStrokes(edit, edit.strokes)).toBe(edit)
  })
})

describe('the eraser', () => {
  // Here a metre is a pixel: [y, x].
  const flat = ([y, x]: SketchPoint) => ({ x, y })
  const line = (points: SketchPoint[], color?: string): SketchStroke => ({ zoom: 3, points, ...(color ? { color } : {}) })
  const at = (x: number, y = 0) => ({ x, y })

  it('splits a line it crosses, leaves the two sides their colour and zoom, however long the segment', () => {
    const left = eraseStrokes([line([[0, 0], [0, 100]], '#ffd60a')], flat, at(50), at(50))
    expect(left).toEqual([line([[0, 0], [0, 50 - ERASER_RADIUS_PX]], '#ffd60a'), line([[0, 50 + ERASER_RADIUS_PX], [0, 100]], '#ffd60a')])
  })

  it('takes the end of a line, and a whole line under it', () => {
    expect(eraseStrokes([line([[0, 0], [0, 100]])], flat, at(100), at(100))).toEqual([line([[0, 0], [0, 100 - ERASER_RADIUS_PX]])])
    expect(eraseStrokes([line([[0, 0], [0, 5]])], flat, at(2), at(2))).toEqual([])
  })

  it('takes a dot, and only one it reaches', () => {
    const dot = line([[0, 0], [0, 0]])
    expect(eraseStrokes([dot], flat, at(5), at(5))).toEqual([])
    const missed = [dot]
    expect(eraseStrokes(missed, flat, at(50), at(50))).toBe(missed)
  })

  it('misses nothing on a fast move, and a stroke it did not touch stays the same stroke', () => {
    const near = line([[0, 300], [20, 300]])
    const far = line([[100, 0], [100, 500]])
    const left = eraseStrokes([near, far], flat, at(0, 10), at(600, 10))
    expect(left).toEqual([far])
    expect(left[0]).toBe(far)
  })

  it('measures on screen: with the axes at different scales its circle is still round there', () => {
    const stretched = ([y, x]: SketchPoint) => ({ x: x * 2, y })
    // 12 px on either side of x = 100 px is 6 m of this stroke's 100.
    expect(eraseStrokes([line([[0, 0], [0, 100]])], stretched, at(100), at(100))).toEqual([line([[0, 0], [0, 44]]), line([[0, 56], [0, 100]])])
  })
})

describe('the colours', () => {
  beforeEach(() => localStorage.clear())
  const key = mapSketchKey('p1', 'pvp', 'customs')

  it('red first; a stroke remembers its colour, an old one has none and an unknown one is dropped', () => {
    expect(SKETCH_DEFAULT_COLOR).toBe('#ff2b2b')
    expect(new Set(SKETCH_COLORS.map(({ color }) => color)).size).toBe(SKETCH_COLORS.length)
    localStorage.setItem(key, JSON.stringify([{ ...stroke(1), color: '#2ab7ff' }, stroke(2), { ...stroke(3), color: 'url(x)' }]))
    expect(readMapSketch(key)).toEqual([{ ...stroke(1), color: '#2ab7ff' }, stroke(2), stroke(3)])
  })

  it('the last colour stays for the next time; «Удалить все данные» takes it', () => {
    const first = renderHook(() => useMapSketch('p1', 'pvp', 'customs'))
    expect(first.result.current.color).toBe(SKETCH_DEFAULT_COLOR)
    act(() => first.result.current.chooseColor('#2fe06b'))
    expect(first.result.current.color).toBe('#2fe06b')
    first.unmount()
    expect(renderHook(() => useMapSketch('p1', 'pvp', 'woods')).result.current.color).toBe('#2fe06b')
    clearAllMapSketches()
    expect(renderHook(() => useMapSketch('p1', 'pvp', 'woods')).result.current.color).toBe(SKETCH_DEFAULT_COLOR)
  })

  it('a colour takes the pencil back from the eraser, and each drawing starts with the pencil', () => {
    const { result } = renderHook(() => useMapSketch('p1', 'pvp', 'customs'))
    act(() => result.current.begin())
    act(() => result.current.chooseTool('eraser'))
    expect(result.current.tool).toBe('eraser')
    act(() => result.current.chooseColor('#ffffff'))
    expect(result.current.tool).toBe('pencil')
    act(() => result.current.chooseTool('eraser'))
    act(() => result.current.cancel())
    act(() => result.current.begin())
    expect(result.current.tool).toBe('pencil')
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

  it('the eraser reaches what was kept, ✓ keeps that, ✕ brings it back; all of it rubbed out and kept, there is no drawing', () => {
    const storage = mapSketchKey('p1', 'pvp', 'customs')
    localStorage.setItem(storage, JSON.stringify([stroke(1), stroke(2)]))
    const { result } = open()
    act(() => result.current.begin())
    act(() => result.current.replace([stroke(2)]))
    expect([result.current.strokes, result.current.canUndo]).toEqual([[stroke(2)], true])
    act(() => result.current.cancel())
    expect(result.current.strokes).toEqual([stroke(1), stroke(2)])
    act(() => result.current.begin())
    act(() => result.current.replace([stroke(2)]))
    act(() => result.current.accept())
    expect(readMapSketch(storage)).toEqual([stroke(2)])
    act(() => result.current.begin())
    act(() => result.current.replace([]))
    act(() => result.current.accept())
    expect([result.current.kept, localStorage.getItem(storage)]).toEqual([false, null])
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
