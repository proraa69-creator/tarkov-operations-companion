import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { HOLD_MS, SETTLE_MS, moved, targetIndex, useHoldToReorder } from './useHoldToReorder'

// jsdom has no PointerEvent: a MouseEvent with a pointer id is enough here
class FakePointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 }
}

function List({ ids, onCommit, onPick }: { ids: string[]; onCommit: (ids: string[]) => void; onPick: (id: string) => void }) {
  const { itemProps } = useHoldToReorder(ids, onCommit)
  return <ul>{ids.map((id) => <li key={id} {...itemProps(id)}><button type="button" onClick={() => onPick(id)}>{id}</button><span className="screen-preset-tools"><button type="button">tool {id}</button></span></li>)}</ul>
}

const ROW = 44, GAP = 6
function setup(ids = ['a', 'b', 'c', 'd']) {
  const onCommit = vi.fn()
  const onPick = vi.fn()
  render(<List ids={ids} onCommit={onCommit} onPick={onPick} />)
  ids.forEach((id, index) => {
    const row = screen.getByText(id).closest('li')!
    row.getBoundingClientRect = () => ({ top: index * (ROW + GAP), height: ROW, bottom: index * (ROW + GAP) + ROW, left: 0, right: 300, width: 300, x: 0, y: index * (ROW + GAP), toJSON: () => ({}) })
  })
  return { onCommit, onPick, row: (id: string) => screen.getByText(id).closest('li')! }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('PointerEvent', FakePointerEvent)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('report 179: hold a block, drag it up or down', () => {
  it('works out where a lifted block lands', () => {
    const centers = [22, 72, 122, 172]
    expect(targetIndex(centers, 3, 10)).toBe(0)
    expect(targetIndex(centers, 3, 100)).toBe(2)
    expect(targetIndex(centers, 0, 130)).toBe(2)
    expect(moved(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('held, dragged to the top and let go: the others move aside, it glides in, the new order is saved, it is not chosen', () => {
    const { onCommit, onPick, row } = setup()
    fireEvent.pointerDown(row('d'), { button: 0, clientY: 172, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(HOLD_MS) })
    expect(row('d').dataset.reorder).toBe('lifted')
    fireEvent.pointerMove(window, { clientY: 172 - 3 * (ROW + GAP) - 5, pointerId: 1 })
    // the three above move down by a row while it passes
    expect(row('a').style.transform).toBe(`translateY(${ROW + GAP}px)`)
    expect(row('c').style.transform).toBe(`translateY(${ROW + GAP}px)`)
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(row('d').dataset.reorder).toBe('landing')
    expect(row('d').style.transform).toBe(`translateY(${-3 * (ROW + GAP)}px)`)
    fireEvent.click(screen.getByText('d'))
    act(() => { vi.advanceTimersByTime(SETTLE_MS) })
    expect(onCommit).toHaveBeenCalledWith(['d', 'a', 'b', 'c'])
    expect(onPick).not.toHaveBeenCalled()
  })

  it('a short click still chooses; a press that moves is not a hold; Esc puts it back; the tool buttons never lift it', () => {
    const { onCommit, onPick, row } = setup()
    fireEvent.pointerDown(row('b'), { button: 0, clientY: 72, pointerId: 1 })
    fireEvent.pointerUp(row('b'), { pointerId: 1 })
    fireEvent.click(screen.getByText('b'))
    act(() => { vi.advanceTimersByTime(HOLD_MS) })
    expect(onPick).toHaveBeenCalledWith('b')
    expect(row('b').dataset.reorder).toBeUndefined()

    fireEvent.pointerDown(row('b'), { button: 0, clientX: 0, clientY: 72, pointerId: 2 })
    fireEvent.pointerMove(row('b'), { clientX: 0, clientY: 90, pointerId: 2 })
    act(() => { vi.advanceTimersByTime(HOLD_MS) })
    expect(row('b').dataset.reorder).toBeUndefined()

    fireEvent.pointerDown(screen.getByText('tool c'), { button: 0, clientY: 122, pointerId: 3 })
    act(() => { vi.advanceTimersByTime(HOLD_MS) })
    expect(row('c').dataset.reorder).toBeUndefined()

    fireEvent.pointerDown(row('a'), { button: 0, clientY: 22, pointerId: 4 })
    act(() => { vi.advanceTimersByTime(HOLD_MS) })
    fireEvent.pointerMove(window, { clientY: 160, pointerId: 4 })
    fireEvent.keyDown(window, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(SETTLE_MS) })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('Alt + ↓ moves the focused block a place down', () => {
    const { onCommit } = setup()
    fireEvent.keyDown(screen.getByText('a'), { key: 'ArrowDown', altKey: true })
    expect(onCommit).toHaveBeenCalledWith(['b', 'a', 'c', 'd'])
  })
})
