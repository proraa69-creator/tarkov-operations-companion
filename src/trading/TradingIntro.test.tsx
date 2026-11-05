import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, NavLink, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { TRADING_INTRO_KEY, TradingIntro } from './TradingIntro'

const state = vi.hoisted(() => ({ raid: null as unknown }))
vi.mock('../app/useRaidState', () => ({ useRaidState: () => state.raid, raidRunning: (raid: { inRaid?: boolean } | null) => Boolean(raid?.inRaid) }))

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

const renderIntro = (path = '/', menu = true) => render(
  <LocaleProvider><MemoryRouter initialEntries={[path]}>
    {menu && <aside><NavLink className="nav-link" to="/economy/trading">Торговля</NavLink></aside>}
    <TradingIntro /><Where />
  </MemoryRouter></LocaleProvider>,
)

beforeEach(() => {
  localStorage.clear()
  state.raid = null
  setRenderLanguage('ru')
})

describe('what is new at the start (owner, 05.11.2026: «при запуске укажи на блок торговли указатели»)', () => {
  it('points at «Торговля» in the menu, says it in a few words, what it is not, and of the modules', () => {
    renderIntro()
    expect(screen.getByRole('dialog', { name: 'Новое: Торговля' })).toBeInTheDocument()
    expect(document.querySelector('.nav-link')).toHaveClass('nav-link-spotlight')
    expect(document.querySelector('.trading-intro-arrow')).toBeInTheDocument()
    expect(screen.getByText(/Минимум, максимум и цена сейчас/)).toBeInTheDocument()
    expect(screen.getByText(/«Продажа модулей»/)).toBeInTheDocument()
    expect(screen.getByText(/Не гарантия заработка, а статистика/)).toBeInTheDocument()
  })

  it('«Понятно» closes it for good and takes the light off the menu', () => {
    const first = renderIntro()
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.nav-link')).not.toHaveClass('nav-link-spotlight')
    expect(localStorage.getItem(TRADING_INTRO_KEY)).toBe('1')
    first.unmount()
    renderIntro()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('«Открыть» goes to the page, once', () => {
    renderIntro()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    expect(screen.getByTestId('where').textContent).toBe('/economy/trading')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(TRADING_INTRO_KEY)).toBe('1')
  })

  it('not over the page itself: being there counts as seen', () => {
    renderIntro('/economy/trading')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(TRADING_INTRO_KEY)).toBe('1')
  })

  it('not in a raid, and it is still to come after it', () => {
    state.raid = { inRaid: true }
    renderIntro()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(TRADING_INTRO_KEY)).toBeNull()
  })

  it('with no menu to point at, on a phone, it stands by itself', () => {
    renderIntro('/', false)
    expect(document.querySelector('.trading-intro.free')).toBeInTheDocument()
    expect(document.querySelector('.trading-intro-arrow')).toBeNull()
  })
})
