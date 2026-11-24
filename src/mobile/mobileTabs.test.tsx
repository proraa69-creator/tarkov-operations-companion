import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { MobileTabBar } from './MobileNav'
import { DEFAULT_TABS, clearMobileTabs, replaceTab, tabsOf } from './mobileTabs'

const Where = () => <output data-testid="where">{useLocation().pathname}</output>

function bar(path = '/', owner = false) {
  return render(<LocaleProvider><MemoryRouter initialEntries={[path]}><MobileTabBar owner={owner} onSearch={() => {}} onRefresh={() => {}} refreshing={false} /><Where /></MemoryRouter></LocaleProvider>)
}
const tabbar = () => document.querySelector('.mobile-tabbar') as HTMLElement
const tabNames = () => [...tabbar().querySelectorAll('.mobile-tab span')].map((name) => name.textContent)
const hold = (name: string | RegExp) => {
  const tab = within(tabbar()).getByRole('link', { name })
  fireEvent.pointerDown(tab)
  act(() => { vi.advanceTimersByTime(1000) })
  return tab
}

describe('the bottom bar is the player\'s own (owner, 07.11.2026)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    clearMobileTabs()
  })
  afterEach(() => { vi.useRealTimers() })

  it('a held tab opens the window with the sections of «Ещё»; a chosen one takes its place and the replaced one goes to «Ещё»', () => {
    bar()
    expect(tabNames()).toEqual(['Обзор', 'Квесты', 'Карты', 'Оружейник', 'Ещё'])
    hold('Оружейник')
    const window_ = screen.getByRole('dialog', { name: 'Заменить «Оружейник»' })
    expect(within(window_).getByRole('button', { name: 'Барахолка' })).toBeInTheDocument()
    expect(within(window_).getByRole('button', { name: 'Чат с поддержкой' })).toBeInTheDocument()
    expect(within(window_).queryByRole('button', { name: 'Квесты' })).toBeNull()
    expect(within(window_).queryByRole('button', { name: 'Оружейник' })).toBeNull()
    fireEvent.click(within(window_).getByRole('button', { name: 'Барахолка' }))
    expect(screen.queryByRole('dialog', { name: /Заменить/ })).toBeNull()
    expect(tabNames()).toEqual(['Обзор', 'Квесты', 'Карты', 'Барахолка', 'Ещё'])
    fireEvent.click(within(tabbar()).getByRole('button', { name: /Ещё/ }))
    const more = screen.getByRole('dialog', { name: 'Ещё' })
    expect(within(more).getByRole('link', { name: 'Оружейник' })).toBeInTheDocument()
    expect(within(more).queryByRole('link', { name: 'Барахолка' })).toBeNull()
  })

  it('the click that ends a hold opens nothing, and the choice is still there at the next start', () => {
    const { unmount } = bar('/quests')
    const tab = hold('Карты')
    fireEvent.pointerUp(tab)
    fireEvent.click(tab)
    expect(screen.getByTestId('where')).toHaveTextContent('/quests')
    expect(screen.getByRole('dialog', { name: 'Заменить «Карты»' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Торговцы' }))
    unmount()
    bar('/quests')
    expect(tabNames()).toEqual(['Обзор', 'Квесты', 'Торговцы', 'Оружейник', 'Ещё'])
  })

  it('a tap stays a tap, a finger that moves is no hold, and «Ещё» itself cannot be replaced', () => {
    bar()
    const maps = within(tabbar()).getByRole('link', { name: 'Карты' })
    fireEvent.pointerDown(maps)
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.pointerUp(maps)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(maps)
    expect(screen.getByTestId('where')).toHaveTextContent('/maps')
    const more = within(tabbar()).getByRole('button', { name: /Ещё/ })
    fireEvent.pointerDown(more)
    act(() => { vi.advanceTimersByTime(1500) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a section with a window of its own works on the bar too; the name there is the short one', () => {
    bar()
    hold('Обзор')
    fireEvent.click(screen.getByRole('button', { name: 'Ключи для квестов' }))
    expect(tabNames()[0]).toBe('Ключи')
    hold('Квесты')
    fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }))
    fireEvent.click(within(tabbar()).getByRole('button', { name: /Уведомл/ }))
    expect(screen.getByRole('dialog', { name: 'Уведомления' })).toBeInTheDocument()
  })

  it('with «Обзор» in «Ещё», only the home page marks «Ещё» as the place you are', () => {
    localStorage.setItem('raidos-mobile-tabs-v1', JSON.stringify(['/flea', '/quests', '/maps', '/gunsmith']))
    const { unmount } = bar('/quests')
    expect(within(tabbar()).getByRole('button', { name: /Ещё/ })).not.toHaveClass('active')
    unmount()
    bar('/')
    expect(within(tabbar()).getByRole('button', { name: /Ещё/ })).toHaveClass('active')
  })

  it('English', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    bar()
    fireEvent.pointerDown(within(tabbar()).getByRole('link', { name: 'Gunsmith' }))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('dialog', { name: 'Replace “Gunsmith”' })).toBeInTheDocument()
  })
})

describe('the saved bar made safe', () => {
  const all = [...DEFAULT_TABS, '/flea', '/squad', '/admin', 'chat']
  it('always a section per slot, none twice, whatever is stored', () => {
    expect(tabsOf([], all)).toEqual(DEFAULT_TABS)
    expect(tabsOf(['/flea', '/flea', 'gone', '/gunsmith'], all)).toEqual(['/flea', '/quests', '/maps', '/gunsmith'])
    expect(new Set(tabsOf(['/gunsmith', '/quests', '/maps', 'gone'], all)).size).toBe(4)
  })

  it('the owner\'s panel while the account loads: another section for now, and the saved order is not touched', () => {
    const saved = ['/admin', '/quests', '/maps', '/gunsmith']
    expect(tabsOf(saved, all.filter((id) => id !== '/admin'))).toEqual(['/', '/quests', '/maps', '/gunsmith'])
    expect(tabsOf(saved, all)).toEqual(saved)
  })

  it('a section already on the bar is not put there twice', () => {
    clearMobileTabs()
    localStorage.clear()
    replaceTab(DEFAULT_TABS, 3, '/quests')
    expect(localStorage.getItem('raidos-mobile-tabs-v1')).toBeNull()
    replaceTab(DEFAULT_TABS, 3, '/flea')
    expect(JSON.parse(localStorage.getItem('raidos-mobile-tabs-v1')!)).toEqual(['/', '/quests', '/maps', '/flea'])
  })
})
