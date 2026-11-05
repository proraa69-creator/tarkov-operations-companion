import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFitBelow } from './useFitBelow'

let content: HTMLElement
let column: HTMLElement
let top = 0
/** Animation frames asked for and not drawn yet; `scroll()` draws them, as the browser would. */
let frames: FrameRequestCallback[] = []
const scroll = (to: number) => {
  top = to
  act(() => {
    window.dispatchEvent(new Event('scroll'))
    const due = frames
    frames = []
    due.forEach((callback) => callback(0))
  })
}

beforeEach(() => {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1040)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback))
  document.documentElement.style.setProperty('--topbar', '68px')
  content = document.createElement('main')
  content.className = 'content'
  content.style.paddingBottom = '42px'
  column = document.createElement('div')
  vi.spyOn(column, 'getBoundingClientRect').mockImplementation(() => ({ top } as DOMRect))
  content.append(column)
  document.body.append(content)
})

afterEach(() => {
  vi.restoreAllMocks()
  frames = []
  content.remove()
  document.documentElement.style.removeProperty('--topbar')
})

describe('a column that ends at the bottom of the window', () => {
  it('gets the room under its top edge, less the page\'s bottom padding', () => {
    top = 179
    renderHook(() => useFitBelow({ current: column }))
    expect(column.style.getPropertyValue('--fit-below')).toBe('819px')
  })

  it('grows while the page scrolls, until it sticks under the top bar', () => {
    top = 680
    renderHook(() => useFitBelow({ current: column }))
    expect(column.style.getPropertyValue('--fit-below')).toBe('320px')
    scroll(170)
    expect(column.style.getPropertyValue('--fit-below')).toBe('828px')
    scroll(-300)
    expect(column.style.getPropertyValue('--fit-below')).toBe('918px')
  })

  it('does nothing when off (the phone), and leaves nothing behind', () => {
    top = 179
    const { rerender, unmount } = renderHook(({ on }) => useFitBelow({ current: column }, on), { initialProps: { on: false } })
    expect(column.style.getPropertyValue('--fit-below')).toBe('')
    rerender({ on: true })
    expect(column.style.getPropertyValue('--fit-below')).toBe('819px')
    unmount()
    expect(column.style.getPropertyValue('--fit-below')).toBe('')
  })
})
