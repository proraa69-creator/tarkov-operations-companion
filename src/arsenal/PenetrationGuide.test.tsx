import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PenetrationGuide } from './PenetrationGuide'
import { PENETRATION_POINTS } from './penetrationPoints'
import { setRenderLanguage, uiText } from '../i18n/renderText'
import { effectiveResistance, penetrationChance } from './ballistics'
import { keptAfterPenetration, penetrationChancePercent } from '../range/rangeModel'

describe('«Как работает пробитие»', () => {
  it('is folded until opened and has 5–7 points', () => {
    const { container } = render(<PenetrationGuide />)
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false)
    expect(screen.getByText('Как работает пробитие')).toBeTruthy()
    expect(PENETRATION_POINTS.length).toBeGreaterThanOrEqual(5)
    expect(PENETRATION_POINTS.length).toBeLessThanOrEqual(7)
  })

  it('says only what the app counts', () => {
    // about 90 % at equal penetration, nothing 15 or more below (both formulas the app uses)
    expect(penetrationChance(effectiveResistance(4), 4)).toBeCloseTo(0.9, 5)
    expect(penetrationChancePercent(40, 40)).toBeCloseTo(90, 5)
    expect(penetrationChance(25, 4)).toBe(0)
    expect(penetrationChancePercent(40, 25)).toBe(0)
    // going through keeps at least 60 % of damage and penetration
    expect(keptAfterPenetration(60, 1)).toBe(0.6)
  })

  it('has every point in English', () => {
    setRenderLanguage('en')
    try {
      for (const point of ['Как работает пробитие', ...PENETRATION_POINTS]) expect(uiText(point)).not.toMatch(/[а-яё]/i)
    } finally {
      setRenderLanguage('ru')
    }
  })
})
