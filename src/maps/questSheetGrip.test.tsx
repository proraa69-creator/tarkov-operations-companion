import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QuestSheetGrip, SHEET_MIN, clampSheetMax, readSheetMax, useQuestSheetMax } from './questSheetGrip'

function Sheet() {
  const ref = useRef<HTMLDivElement>(null)
  const { max, sizing, handlers } = useQuestSheetMax(ref)
  return <div data-testid="stage">
    <div ref={ref} data-testid="sheet" data-sizing={sizing} style={max != null ? { maxHeight: max } : undefined}>
      <QuestSheetGrip max={max} handlers={handlers} />
    </div>
  </div>
}

function renderSheet(height = 200, stage = 800) {
  render(<Sheet />)
  Object.defineProperty(screen.getByTestId('stage'), 'clientHeight', { configurable: true, value: stage })
  screen.getByTestId('sheet').getBoundingClientRect = () => ({ height, width: 600, top: 0, left: 0, right: 600, bottom: height, x: 0, y: 0, toJSON: () => ({}) })
  return screen.getByRole('separator', { name: 'Высота окна' })
}

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

// Owner, 15.11.2026: «на краю этого блока сверху можно нажать на край, и эту шторку квеста можно выставить вверх или вниз…
// больше выставленного они не будут».
describe('the quest window grip', () => {
  it('a drag up or down sets the greatest height, kept on this device; a double click gives back the usual one', () => {
    const grip = renderSheet()
    fireEvent.pointerDown(grip, { button: 0, clientY: 500, pointerId: 1 })
    expect(screen.getByTestId('sheet').dataset.sizing).toBe('true')
    fireEvent.pointerMove(grip, { clientY: 400, pointerId: 1 })
    fireEvent.pointerUp(grip, { clientY: 380, pointerId: 1 })
    expect(screen.getByTestId('sheet').dataset.sizing).toBe('false')
    expect(screen.getByTestId('sheet').style.maxHeight).toBe('320px')
    expect(readSheetMax()).toBe(320)
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(readSheetMax()).toBe(296)
    fireEvent.doubleClick(grip)
    expect(screen.getByTestId('sheet').style.maxHeight).toBe('')
    expect(readSheetMax()).toBeNull()
  })

  it('never goes below the least height nor above what the map leaves', () => {
    expect(clampSheetMax(40, 600)).toBe(SHEET_MIN)
    expect(clampSheetMax(900, 600)).toBe(600)
    const grip = renderSheet(200, 500)
    fireEvent.pointerDown(grip, { button: 0, clientY: 500, pointerId: 1 })
    fireEvent.pointerUp(grip, { clientY: 0, pointerId: 1 })
    expect(readSheetMax()).toBe(500 - 72)
  })
})
