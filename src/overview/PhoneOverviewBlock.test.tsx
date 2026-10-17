import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PhoneOverviewBlock } from './PhoneOverviewBlock'
import type { PhoneOverview } from './usePhoneOverview'

const overview = (sizes?: Record<string, { w?: number; h?: number }>) => ({
  layout: { order: ['raid'], narrow: [], ...(sizes ? { sizes } : {}) },
  editing: true, isDefault: !sizes, register: vi.fn(), toggleEditing: vi.fn(), reset: vi.fn(), move: vi.fn(), toggleNarrow: vi.fn(), resize: vi.fn(),
}) as unknown as PhoneOverview & { resize: ReturnType<typeof vi.fn> }

describe('«Настроить блоки» on the phone: any size by the corner', () => {
  it('the corner follows the finger: width as a share of the screen, height in pixels', () => {
    const state = overview()
    render(<div style={{ width: 400 }}><PhoneOverviewBlock overview={state} id="raid" label="План рейда" index={0} count={1}><p>map</p></PhoneOverviewBlock></div>)
    const handle = screen.getByRole('button', { name: 'Изменить размер' })
    const block = handle.closest('.phone-block') as HTMLElement
    const rect = (left: number, top: number, width: number) => ({ left, top, width, height: 200, right: left + width, bottom: top + 200, x: left, y: top, toJSON: () => ({}) })
    block.getBoundingClientRect = () => rect(0, 100, 400) as DOMRect
    ;(block.parentElement as HTMLElement).getBoundingClientRect = () => rect(0, 100, 400) as DOMRect
    ;(block.querySelector('.overview-block-content') as HTMLElement).getBoundingClientRect = () => rect(0, 142, 400) as DOMRect
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400, clientY: 342 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 240, clientY: 442 })
    expect(state.resize).toHaveBeenLastCalledWith('raid', { h: 300, w: 0.6 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 395, clientY: 242 })
    expect(state.resize).toHaveBeenLastCalledWith('raid', { h: 100 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 200 })
    expect(state.resize).toHaveBeenCalledTimes(2)
  })

  it('a sized block shows its size and can go back to the default', () => {
    const state = overview({ raid: { w: 0.4, h: 180 } })
    render(<PhoneOverviewBlock overview={state} id="raid" label="План рейда" index={0} count={1}><p>map</p></PhoneOverviewBlock>)
    const block = document.querySelector('.phone-block') as HTMLElement
    expect(block.style.getPropertyValue('--w')).toBe('0.4')
    expect(block.style.getPropertyValue('--h')).toBe('180px')
    fireEvent.click(screen.getByRole('button', { name: 'Размер по умолчанию' }))
    expect(state.resize).toHaveBeenCalledWith('raid', undefined)
  })
})
