import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { QuestsHelpButton, questsHelpText } from './QuestsHelp'
import { manualAddText } from './ManualAdd'
import { manualMarksText } from './manualMarksSetting'

afterEach(cleanup)

describe('«Не все квесты?» on the Quests page (owner, 04.11.2026)', () => {
  it('opens with both cases, and closes by its cross, Esc and a click beside it', () => {
    render(<QuestsHelpButton locale="ru" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('quests-help'))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Не хватает квеста')
    expect(dialog.textContent).toContain('Лишний квест')

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByTestId('quests-help'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByTestId('quests-help'))
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays open on a click inside', () => {
    render(<QuestsHelpButton locale="ru" />)
    fireEvent.click(screen.getByTestId('quests-help'))
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('names the real buttons by their own labels, in both languages', () => {
    for (const locale of ['ru', 'en'] as const) {
      const text = questsHelpText(locale)
      expect(text.missing).toContain(manualAddText(locale).button)
      expect(text.extra).toContain(manualMarksText(locale).completed)
    }
    expect(questsHelpText('ru').missing).toContain('Найти квесты по экрану')
    expect(questsHelpText('ru').extra).toContain('Отложить квест')
  })

  it('is short: one sentence or two for each case', () => {
    for (const locale of ['ru', 'en'] as const) {
      const text = questsHelpText(locale)
      expect(text.button.length).toBeLessThanOrEqual(16)
      expect(text.missing.length).toBeLessThanOrEqual(150)
      expect(text.extra.length).toBeLessThanOrEqual(120)
    }
  })
})
