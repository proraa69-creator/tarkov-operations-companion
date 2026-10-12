import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { cubicBezier, easeOut } from '../shared/motion'
import { CountUp } from './CountUp'

describe('CountUp', () => {
  it('always renders the real number (tests, screen readers, reduced motion)', () => {
    const { rerender } = render(<CountUp value={27} />)
    expect(screen.getByText('27')).toHaveClass('count-up')
    rerender(<CountUp value={31} />)
    expect(screen.getByText('31')).toBeInTheDocument()
  })

  it('counts with the strong ease-out of the app: fast at first, settling at the end', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.25)).toBeGreaterThan(0.6)
    expect(easeOut(0.5)).toBeGreaterThan(0.85)
    // a linear curve stays linear
    expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 4)
  })
})
