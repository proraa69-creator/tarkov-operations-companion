import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { DAY_NIGHT_THEME, THEMES, cycleTheme, currentTheme, saveAppearance } from './theme'
import { useThemeSchemeMenu } from './ThemeSchemeMenu'
import { stopDayNight } from './dayNight'

/**
 * Owner, 15.11.2026: «правой кнопкой нажимаем на цветовые схемы, там будут обычные схемы и ниже надпись смена дня и ночи…
 * вылезает только единоразово при первом включении… при обычном щелкании левой кнопкой… переключаются только обычные схемы».
 */
function Button() {
  const [theme, setTheme] = useState(currentTheme)
  const menu = useThemeSchemeMenu(theme, setTheme)
  return <><button type="button" onClick={() => setTheme(cycleTheme().id)} onContextMenu={menu.onContextMenu}>Схема</button>{menu.overlay}</>
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  stopDayNight()
  act(() => { saveAppearance('tarkov') })
})

describe('the scheme button\'s right-click menu', () => {
  it('lists the ordinary schemes and, under them, «Смена дня и ночи»', () => {
    render(<Button />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Схема' }))
    const items = screen.getAllByRole('menuitemradio').map((item) => item.textContent)
    expect(items).toEqual([...THEMES.map((theme) => theme.label), DAY_NIGHT_THEME.label])
  })

  it('turns «Смена дня и ночи» on with its window the first time only', () => {
    render(<Button />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Схема' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Смена дня и ночи' }))
    expect(currentTheme()).toBe('daynight')
    expect(document.documentElement.getAttribute('data-theme')).toBe('daynight')
    expect(document.documentElement.style.getPropertyValue('--bg')).not.toBe('')
    expect(screen.getByRole('dialog')).toHaveTextContent('Цветовая схема меняется в зависимости от вашего времени суток.')
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // Back to an ordinary one and to it again: no window now.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Схема' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Металл' }))
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('')
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Схема' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Смена дня и ночи' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the left click goes through the ordinary schemes only, from «Смена дня и ночи» to the first one', () => {
    act(() => { saveAppearance('daynight') })
    render(<Button />)
    const seen = THEMES.map(() => { fireEvent.click(screen.getByRole('button', { name: 'Схема' })); return currentTheme() })
    expect(seen).toEqual(THEMES.map((theme) => theme.id))
  })
})
