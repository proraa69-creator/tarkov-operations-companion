import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BodyHealthFigure } from './BodyHealthFigure'

describe('BodyHealthFigure', () => {
  it('shows the owner picture with a full «HP/HP» window for every body part of this boss', () => {
    const { container } = render(<BodyHealthFigure body={[70, 210, 170, 100, 100, 120, 120]} />)
    expect(container.querySelector('img')).not.toBeNull()
    const names = [...container.querySelectorAll('.body-figure-name')].map((node) => node.textContent)
    expect(names).toEqual(['Голова', 'Грудь', 'Живот', 'Левая рука', 'Правая рука', 'Левая нога', 'Правая нога'])
    const values = [...container.querySelectorAll('.body-figure-value')].map((node) => node.textContent)
    expect(values).toEqual(['70/70', '210/210', '170/170', '100/100', '100/100', '120/120', '120/120'])
  })
  it('another boss has its own HP', () => {
    const { container } = render(<BodyHealthFigure body={[100, 320, 260, 130, 130, 140, 140]} />)
    expect(container.querySelector('.body-figure-value')?.textContent).toBe('100/100')
    expect(container.querySelector('figure')?.getAttribute('aria-label')).toContain('Грудь 320')
  })
})
