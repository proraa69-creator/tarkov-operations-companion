import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { translateUiText } from '../i18n/uiEnglish'
import { NotificationsButton } from './NotificationsButton'
import { addNotification, MAX_NOTIFICATIONS, unreadNotifications } from './notificationCenter'

const Where = () => <div data-testid="where">{useLocation().pathname}</div>
const draw = () => render(<MemoryRouter><NotificationsButton /><Where /></MemoryRouter>)

beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); localStorage.clear() })

describe('«Уведомления» (owner, 07.11.2026)', () => {
  it('a square button with the count of what is not read; opening reads them and the count goes', () => {
    addNotification({ title: 'Скоро ресток', text: 'Прапор: через 5 мин' })
    addNotification({ title: 'Торговля', text: '+10 000 ₽' })
    draw()
    const button = screen.getByRole('button', { name: 'Уведомления: 2' })
    expect(button.querySelector('.nav-badge')?.textContent).toBe('2')
    fireEvent.click(button)
    expect(screen.getByRole('dialog', { name: 'Уведомления' })).toBeInTheDocument()
    expect(screen.getByText('Прапор: через 5 мин')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Уведомления' }).querySelector('.nav-badge')).toBeNull()
  })

  it('the newest stands first; a press leads to its place; «Очистить» empties the list', () => {
    addNotification({ title: 'Первое', text: 'а' }, 1000)
    addNotification({ title: 'Ключи', text: 'б', open: '/quest-keys' }, 2000)
    draw()
    fireEvent.click(screen.getByRole('button', { name: /^Уведомления/ }))
    const rows = document.querySelectorAll('.notification-entry strong')
    expect(rows[0]?.textContent).toBe('Ключи')
    fireEvent.click(screen.getByRole('button', { name: /^Ключи/ }))
    expect(screen.getByTestId('where').textContent).toBe('/quest-keys')
    fireEvent.click(screen.getByRole('button', { name: /^Уведомления/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }))
    expect(screen.getByText('Уведомлений пока нет.')).toBeInTheDocument()
  })

  it('keeps the newest only', () => {
    for (let index = 0; index < MAX_NOTIFICATIONS + 5; index += 1) addNotification({ title: `Т${index}`, text: 'х' }, index)
    const saved = JSON.parse(localStorage.getItem('raidos-notifications-v1')!) as Array<{ title: string; read?: boolean }>
    expect(saved).toHaveLength(MAX_NOTIFICATIONS)
    expect(saved[0]!.title).toBe(`Т${MAX_NOTIFICATIONS + 4}`)
    expect(unreadNotifications(saved as never)).toBe(MAX_NOTIFICATIONS)
  })

  it('every text has its English', () => {
    for (const text of ['Уведомления', 'Очистить', 'Уведомлений пока нет.']) expect(translateUiText(text)).toMatch(/^[A-Za-z .]+$/)
  })

  it('the system message never comes while the game is in front', () => {
    const main = readFileSync('electron/main.ts', 'utf8')
    const handler = main.slice(main.indexOf("ipcMain.handle('app:notify'"), main.indexOf("ipcMain.handle('local-server:status'"))
    expect(handler).toContain('foregroundGame() !== null')
  })
})
