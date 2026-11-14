import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SquadSettingsPanel } from './SquadSettingsPanel'
import { readSquadSettings } from './squadSettings'

describe('«Настройки отряда» (owner, 14.11.2026)', () => {
  beforeEach(() => localStorage.clear())

  it('sending the place and the drawings is off until turned on; «Квесты отряда» is on; each switch is kept', () => {
    render(<SquadSettingsPanel />)
    const location = screen.getByRole('switch', { name: 'Местоположение отряда' })
    const sketches = screen.getByRole('switch', { name: 'Зарисовки отряда' })
    const quests = screen.getByRole('switch', { name: 'Квесты отряда' })
    expect([location, sketches, quests].map((entry) => entry.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
    fireEvent.click(location)
    fireEvent.click(quests)
    expect(location).toHaveAttribute('aria-checked', 'true')
    expect(quests).toHaveAttribute('aria-checked', 'false')
    expect(readSquadSettings()).toEqual({ location: true, sketches: false, quests: false })
  })
})
