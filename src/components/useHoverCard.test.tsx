import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX, useHoverCard } from './useHoverCard'

function Probe({ onOpenLink }: { onOpenLink: () => void }) {
  const { anchorProps, card } = useHoverCard(<span>Подходит и: АКМ</span>)
  return <><a href="#/flea" onClick={(event) => { event.preventDefault(); onOpenLink() }} {...anchorProps}>Предмет</a>{card}</>
}

const touch = (type: string, x = 20, y = 20) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerType: 'touch', clientX: x, clientY: y, pointerId: 1 })

describe('useHoverCard on a touch screen (owner, 13.10.2026)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('a held finger shows the card; moving it scrolls nothing; lifting it hides the card without opening the link', () => {
    vi.useFakeTimers()
    const onOpenLink = vi.fn()
    render(<Probe onOpenLink={onOpenLink} />)
    const link = screen.getByText('Предмет')
    act(() => { link.dispatchEvent(touch('pointerdown')) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS) })
    expect(screen.getByRole('tooltip').textContent).toContain('АКМ')

    const move = new Event('touchmove', { bubbles: true, cancelable: true })
    act(() => { link.dispatchEvent(move) })
    expect(move.defaultPrevented).toBe(true)

    act(() => { link.dispatchEvent(touch('pointerup')) })
    fireEvent.click(link)
    expect(onOpenLink).not.toHaveBeenCalled()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('a finger that moves at once is scrolling: no card, and a later tap opens the link', () => {
    vi.useFakeTimers()
    const onOpenLink = vi.fn()
    render(<Probe onOpenLink={onOpenLink} />)
    const link = screen.getByText('Предмет')
    act(() => { link.dispatchEvent(touch('pointerdown')) })
    act(() => { link.dispatchEvent(touch('pointermove', 20, 20 + LONG_PRESS_SLOP_PX + 5)) })
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { link.dispatchEvent(touch('pointercancel')) })
    // A plain tap later: the link opens, and the mouse events the browser makes up after it show no card.
    act(() => { link.dispatchEvent(touch('pointerdown')) })
    act(() => { link.dispatchEvent(touch('pointerup')) })
    fireEvent.mouseEnter(link)
    fireEvent.click(link)
    act(() => { vi.advanceTimersByTime(500) })
    expect(onOpenLink).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('the mouse still shows the card on hover', () => {
    vi.useFakeTimers()
    render(<Probe onOpenLink={() => {}} />)
    const link = screen.getByText('Предмет')
    fireEvent.mouseEnter(link)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.mouseLeave(link)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
