import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BodyHealthFigure } from './BodyHealthFigure'

describe('BodyHealthFigure', () => {
  it('writes the HP on every body part and compares with a PMC (440 HP)', () => {
    const { container } = render(<BodyHealthFigure body={[70, 210, 170, 100, 100, 120, 120]} />)
    const values = [...container.querySelectorAll('.body-figure-value')].map((node) => node.textContent)
    expect(values).toEqual(['70', '210', '170', '100', '100', '120', '120'])
    const pmc = [...container.querySelectorAll('.body-figure-compare')].map((node) => Number(node.textContent))
    expect(pmc).toEqual([35, 85, 70, 60, 60, 65, 65])
    expect(pmc.reduce((sum, value) => sum + value, 0)).toBe(440)
    expect(container.querySelector('.body-figure-total')?.textContent).toBe('890 HP')
    expect(container.querySelector('.body-figure-ref')?.textContent).toContain('440 HP')
    expect(container.querySelector('.body-figure-ref')?.textContent).toContain('×2.0')
  })
})
