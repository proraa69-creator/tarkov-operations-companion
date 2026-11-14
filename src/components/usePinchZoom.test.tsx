import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageViewerBase } from './ImageViewerBase'
import { BuildImage } from '../gunsmith/BuildImage'

/**
 * Owner, 15.11.2026: «на телефоне, чтобы можно было увеличивать и уменьшать… уменьшить до обычного размера, до стандартного…
 * Увеличил, отпустил пальцы, и размер зафиксировался… не сбрасывается обратно… вооружейники… в чате».
 */
afterEach(cleanup)

const touch = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', target: Element, id: number, x: number, y = 100) =>
  fireEvent[type](target, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y })

/** Two fingers from `from` apart to `to` apart, then off the glass. */
function pinch(target: Element, from: number, to: number) {
  touch('pointerDown', target, 1, 100 - from / 2)
  touch('pointerDown', target, 2, 100 + from / 2)
  touch('pointerMove', target, 1, 100 - to / 2)
  touch('pointerMove', target, 2, 100 + to / 2)
  touch('pointerUp', target, 1, 100 - to / 2)
  touch('pointerUp', target, 2, 100 + to / 2)
}

describe('two fingers enlarge a picture on a phone', () => {
  it('the viewer keeps the size the fingers left, a tap then closes nothing, and it goes back no smaller than standard', () => {
    const onClose = vi.fn()
    render(<ImageViewerBase images={['a.png', 'b.png']} index={0} onIndex={() => {}} onClose={onClose} closeOnClick />)
    const image = within(screen.getByRole('dialog')).getByRole('img')
    pinch(image, 50, 150)
    expect(image.style.transform).toContain('scale(3)')
    fireEvent.click(image)
    expect(onClose).not.toHaveBeenCalled()
    // Back down past the standard size: the standard size.
    pinch(image, 150, 10)
    expect(image.style.transform).toBe('')
    // A tap of its own, at the standard size, closes it as before.
    touch('pointerDown', image, 4, 100)
    touch('pointerUp', image, 4, 100)
    fireEvent.click(image)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('one finger moves an enlarged picture, and the next image opens at its standard size', () => {
    const { rerender } = render(<ImageViewerBase images={['a.png', 'b.png']} index={0} onIndex={() => {}} onClose={() => {}} />)
    const image = within(screen.getByRole('dialog')).getByRole('img')
    // The picture's centre where the fingers meet: the spread does not move it.
    image.getBoundingClientRect = () => ({ left: 50, top: 50, width: 100, height: 100, right: 150, bottom: 150, x: 50, y: 50, toJSON: () => ({}) })
    pinch(image, 50, 100)
    expect(image.style.transform).toBe('translate(0px, 0px) scale(2)')
    image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) })
    touch('pointerDown', image, 3, 100)
    touch('pointerMove', image, 3, 140)
    touch('pointerUp', image, 3, 140)
    expect(image.style.transform).toMatch(/^translate\(40px, 0px\) scale\(2\)$/)
    rerender(<ImageViewerBase images={['a.png', 'b.png']} index={1} onIndex={() => {}} onClose={() => {}} />)
    expect(within(screen.getByRole('dialog')).getByRole('img').style.transform).toBe('')
  })

  it('the mouse is left alone: a click still closes', () => {
    const onClose = vi.fn()
    render(<ImageViewerBase images={['a.png']} index={0} onIndex={() => {}} onClose={onClose} closeOnClick />)
    const image = within(screen.getByRole('dialog')).getByRole('img')
    fireEvent.pointerDown(image, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10 })
    fireEvent.click(image)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the gunsmith\'s build screenshot stays open and enlarged after the fingers leave', () => {
    render(<BuildImage src="build.png" alt="AK-74N" />)
    fireEvent.click(screen.getByRole('button', { name: 'Открыть сборку на весь экран' }))
    const image = within(screen.getByRole('dialog')).getByRole('img')
    pinch(image, 50, 100)
    fireEvent.click(image)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(image.style.transform).toContain('scale(2)')
  })
})
