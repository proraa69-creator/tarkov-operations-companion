import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { QuestsHelpButton, questsHelpText } from './QuestsHelp'
import { manualAddText } from './ManualAdd'
import { uiText, setRenderLanguage } from '../i18n/renderText'

afterEach(() => { cleanup(); setRenderLanguage('ru') })

describe('«Не хватает квеста?» on the Quests page (owner, 04.11.2026)', () => {
  it('says why and what to do, and closes by its cross, Esc and a click beside it', () => {
    render(<QuestsHelpButton locale="ru" />)
    expect(screen.getByTestId('quests-help').textContent).toContain('Не хватает квеста?')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('quests-help'))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('логов игры')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Не хватает нескольких: нажмите «Ручное добавление» и отметьте их.',
      'Не хватает многих: нажмите «Найти квесты по экрану» и пролистайте в игре «Персонаж» → «Задания».',
    ])

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

  it('names the real buttons by their own labels, in both languages, and stays short', () => {
    for (const locale of ['ru', 'en'] as const) {
      const text = questsHelpText(locale)
      expect(text.few.then).toContain(manualAddText(locale).button)
      expect(text.button.length).toBeLessThanOrEqual(20)
      expect(text.why.length).toBeLessThanOrEqual(190)
      expect(`${text.few.when} ${text.few.then}`.length).toBeLessThanOrEqual(80)
      expect(`${text.many.when} ${text.many.then}`.length).toBeLessThanOrEqual(110)
    }
    expect(questsHelpText('ru').many.then).toContain('Найти квесты по экрану')
    setRenderLanguage('en')
    expect(questsHelpText('en').many.then).toContain(uiText('Найти квесты по экрану'))
  })
})
