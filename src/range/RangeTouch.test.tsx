import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RangeLookArea, RangeTouchSlider } from './RangeTouch'

/**
 * Owner, 24.11.2026: «В прицеле нужно сделать не джойстик а левую часть экрана для наведения… в режиме прицеливания должен быть
 * ползунок для увеличения дистанции до персонажа и увеличение кратности прицела».
 */
afterEach(cleanup)

const touch = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', target: Element, id: number, x: number, y: number) =>
  fireEvent[type](target, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y })

describe('the finger aims over the left half', () => {
  it('passes the finger’s way, and turns it back where the picture is turned a quarter', () => {
    const onLook = vi.fn()
    const { container, rerender } = render(<RangeLookArea onLook={onLook} turned={false} hint="Ведите пальцем — наведение" />)
    const area = container.querySelector('.range-look')!
    expect(screen.getByText('Ведите пальцем — наведение')).toBeInTheDocument()
    touch('pointerDown', area, 1, 100, 100)
    expect(screen.queryByText('Ведите пальцем — наведение')).toBeNull()
    touch('pointerMove', area, 1, 112, 95)
    expect(onLook).toHaveBeenLastCalledWith(12, -5)
    // a second finger landing meanwhile does not aim
    touch('pointerDown', area, 2, 300, 300)
    touch('pointerMove', area, 2, 340, 300)
    expect(onLook).toHaveBeenCalledTimes(1)
    touch('pointerUp', area, 1, 112, 95)

    // turned clockwise: the glass' down is the picture's right, the glass' right its up
    rerender(<RangeLookArea onLook={onLook} turned hint="" />)
    touch('pointerDown', area, 3, 100, 100)
    touch('pointerMove', area, 3, 110, 120)
    expect(onLook).toHaveBeenLastCalledWith(20, -10)
  })
})

describe('the upright sliders', () => {
  const box = (element: Element, rect: { left: number; top: number; width: number; height: number }) => {
    element.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) })
  }

  it('stands where the finger is: the least at the bottom, or on the left of the glass when turned', () => {
    const onShare = vi.fn()
    const { container, rerender } = render(<RangeTouchSlider share={0.25} onShare={onShare} turned={false} label="Дистанция" value="250 м" caption="Дист." />)
    const slider = screen.getByRole('slider', { name: 'Дистанция' })
    expect(slider).toHaveAttribute('aria-valuetext', '250 м')
    box(container.querySelector('.range-slider-track')!, { left: 0, top: 100, width: 8, height: 200 })
    touch('pointerDown', slider, 1, 4, 250)
    expect(onShare).toHaveBeenLastCalledWith(0.25)
    touch('pointerMove', slider, 1, 4, 80)
    expect(onShare).toHaveBeenLastCalledWith(1)
    touch('pointerUp', slider, 1, 4, 80)

    rerender(<RangeTouchSlider share={0.25} onShare={onShare} turned label="Дистанция" value="250 м" caption="Дист." />)
    box(container.querySelector('.range-slider-track')!, { left: 100, top: 0, width: 200, height: 8 })
    touch('pointerDown', slider, 2, 250, 4)
    expect(onShare).toHaveBeenLastCalledWith(0.75)
  })

  it('marks the fixed magnifications and steps them by keys', () => {
    const onShare = vi.fn()
    const { container } = render(<RangeTouchSlider share={0} onShare={onShare} turned={false} label="Кратность" value="×1" caption="Кратн." stops={3} />)
    expect(container.querySelectorAll('.range-slider-stop')).toHaveLength(3)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Кратность' }), { key: 'ArrowUp' })
    expect(onShare).toHaveBeenLastCalledWith(0.5)
  })
})
