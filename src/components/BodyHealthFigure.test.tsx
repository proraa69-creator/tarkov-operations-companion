import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BodyHealthFigure } from './BodyHealthFigure'

describe('BodyHealthFigure', () => {
  it('shows a tag with «current/max» for every body part, full for a boss', () => {
    const { container } = render(<BodyHealthFigure body={[70, 210, 170, 100, 100, 120, 120]} />)
    const values = [...container.querySelectorAll('.body-figure-value')].map((node) => node.textContent)
    expect(values).toEqual(['70/70', '210/210', '170/170', '100/100', '100/100', '120/120', '120/120'])
    const names = [...container.querySelectorAll('.body-figure-name')].map((node) => node.textContent)
    expect(names).toEqual(['Голова', 'Грудь', 'Живот', 'Левая рука', 'Правая рука', 'Левая нога', 'Правая нога'])
    // full bars; the glow filter reference is a valid SVG id
    const fills = [...container.querySelectorAll('.body-figure-bar-fill')].map((node) => Number(node.getAttribute('width')))
    expect(new Set(fills)).toEqual(new Set([106]))
    const filter = container.querySelector('filter')!.id
    expect(filter).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(container.querySelector('.body-figure-body')?.getAttribute('filter')).toBe(`url(#${filter})`)
  })

  it('draws a damaged part shorter', () => {
    const { container } = render(<BodyHealthFigure body={[35, 85, 70, 60, 60, 65, 65]} current={[13, 30, 25, 22, 22, 24, 24]} />)
    expect(container.querySelector('.body-figure-value')?.textContent).toBe('13/35')
    expect(Number(container.querySelector('.body-figure-bar-fill')?.getAttribute('width'))).toBeCloseTo(106 * 13 / 35)
  })
})
