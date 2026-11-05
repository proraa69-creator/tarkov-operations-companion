import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppTooltips } from './AppTooltips'

const over = (element: Element) => {
  // jsdom has no PointerEvent: a missing pointerType counts as the mouse.
  fireEvent(element, new MouseEvent('pointerover', { bubbles: true }))
}
const wait = () => act(() => { vi.advanceTimersByTime(300) })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('small windows on hover (owner, 05.11.2026: «не белые, а в стиле нашего приложения»)', () => {
  it('takes the title off while the mouse is there, so the white one never opens, and shows its own after a moment', () => {
    render(<><AppTooltips /><button type="button" title="Шесть из девяти">6/9</button></>)
    const button = screen.getByRole('button')
    over(button)
    expect(button.hasAttribute('title')).toBe(false)
    expect(screen.queryByRole('tooltip')).toBeNull()
    wait()
    expect(screen.getByRole('tooltip').textContent).toBe('Шесть из девяти')
  })

  it('puts the title back when the mouse leaves: the page and a screen reader keep it', () => {
    render(<><AppTooltips /><button type="button" title="Настройки"><svg /></button><span>нет</span></>)
    const button = screen.getByRole('button')
    over(button)
    over(screen.getByText('нет'))
    expect(button.getAttribute('title')).toBe('Настройки')
    expect(screen.getByRole('button', { name: 'Настройки' })).toBeTruthy()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('goes on a press and on a scroll, and the white one does not come in its place while the mouse stays', () => {
    render(<><AppTooltips /><button type="button" title="Подсказка">A</button></>)
    const button = screen.getByRole('button')
    over(button)
    wait()
    fireEvent.pointerDown(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button.hasAttribute('title')).toBe(false)
    over(button)
    wait()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('the inside of an element with a hint is the same element; a hint inside it has its own', () => {
    render(<><AppTooltips /><div title="Снаружи"><span>текст</span><b title="Внутри">жирный</b></div></>)
    over(screen.getByText('текст'))
    wait()
    expect(screen.getByRole('tooltip').textContent).toBe('Снаружи')
    over(screen.getByText('текст'))
    expect(screen.getByRole('tooltip').textContent).toBe('Снаружи')
    over(screen.getByText('жирный'))
    wait()
    expect(screen.getByRole('tooltip').textContent).toBe('Внутри')
  })

  it('a text that changed is the one shown next time; one the page wrote meanwhile is not overwritten', () => {
    const { rerender } = render(<><AppTooltips /><button type="button" title="Первая">A</button><span>нет</span></>)
    const button = screen.getByRole('button')
    rerender(<><AppTooltips /><button type="button" title="Вторая">A</button><span>нет</span></>)
    over(button)
    wait()
    expect(screen.getByRole('tooltip').textContent).toBe('Вторая')
    rerender(<><AppTooltips /><button type="button" title="Третья">A</button><span>нет</span></>)
    over(screen.getByText('нет'))
    expect(button.getAttribute('title')).toBe('Третья')
  })

  it('a finger is not a mouse', () => {
    render(<><AppTooltips /><button type="button" title="Подсказка">A</button></>)
    const button = screen.getByRole('button')
    const touch = new MouseEvent('pointerover', { bubbles: true })
    Object.defineProperty(touch, 'pointerType', { value: 'touch' })
    fireEvent(button, touch)
    wait()
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button.getAttribute('title')).toBe('Подсказка')
  })
})
