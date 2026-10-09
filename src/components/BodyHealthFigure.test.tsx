import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BodyHealthFigure } from './BodyHealthFigure'

describe('BodyHealthFigure', () => {
  it('shows a full «HP/HP» window for every body part of this boss', () => {
    const { container } = render(<BodyHealthFigure body={[70, 210, 170, 100, 100, 120, 120]} />)
    const names = [...container.querySelectorAll('.body-figure-name')].map((node) => node.textContent)
    expect(names).toEqual(['Голова', 'Грудь', 'Живот', 'Левая рука', 'Правая рука', 'Левая нога', 'Правая нога'])
    const values = [...container.querySelectorAll('.body-figure-value')].map((node) => node.textContent)
    expect(values).toEqual(['70/70', '210/210', '170/170', '100/100', '100/100', '120/120', '120/120'])
    expect(container.querySelector('figure')?.getAttribute('aria-label')).toContain('Грудь 210')
  })
  it('pointing at a window lights that body part only, and leaving clears it', () => {
    const { container } = render(<BodyHealthFigure body={[100, 320, 260, 130, 130, 140, 140]} />)
    const windows = container.querySelectorAll('.body-figure-window')
    const glows = container.querySelectorAll('.body-figure-glow')
    fireEvent.pointerEnter(windows[5])
    expect([...glows].map((node) => node.classList.contains('is-active'))).toEqual([false, false, false, false, false, true, false])
    expect(container.querySelector('figure')?.classList.contains('has-active')).toBe(true)
    fireEvent.pointerLeave(windows[5])
    expect(container.querySelectorAll('.body-figure-glow.is-active')).toHaveLength(0)
  })
  it('pointing at the body lights the part and its window', () => {
    const { container } = render(<BodyHealthFigure body={[100, 320, 260, 130, 130, 140, 140]} />)
    fireEvent.pointerEnter(container.querySelectorAll('.body-figure-areas polygon')[0])
    expect(container.querySelector('.body-figure-window.is-active .body-figure-value')?.textContent).toBe('100/100')
  })
})
