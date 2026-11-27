import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleProvider, useLocale } from '../i18n/LocaleProvider'
import { LanguageButtons } from './LanguagePicker'

function Current() {
  const { language } = useLocale()
  return <output data-testid="language">{language}</output>
}

afterEach(() => { cleanup(); localStorage.clear() })

describe('the phone\'s language: one globe button and a window with every language (owner, 28.11.2026)', () => {
  it('shows one button with the language\'s own name, not a button per language', () => {
    render(<LocaleProvider><LanguageButtons /><Current /></LocaleProvider>)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the window, a pick changes the language and closes it; Escape closes it too', () => {
    render(<LocaleProvider><LanguageButtons /><Current /></LocaleProvider>)
    fireEvent.click(screen.getByRole('button'))
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThanOrEqual(11)
    expect(screen.getByRole('dialog')).toBeTruthy()
    const english = options.find((option) => option.getAttribute('lang')?.startsWith('en'))!
    fireEvent.click(english)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('language').textContent).toBe('en')
    fireEvent.click(screen.getByRole('button'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
