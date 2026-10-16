import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { AppStateProvider } from '../state/AppState'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { sanitizeOverviewDefaults } from '../overview/overviewDefaults'
import { reloadOverviewDefaultsForTests, setOverviewDefaults } from '../overview/overviewDefaultsStore'
import { OVERVIEW_LAYOUT_KEY } from '../overview/overviewLayout'
import { DashboardPage } from './DashboardPage'

/** «Админ панель» → «Блоки» on the players' Overview (owner, 16.10.2026). */
const OWNER = sanitizeOverviewDefaults({
  layout: { stats: ['stat-kappa', 'stat-tasks', 'stat-conditions', 'stat-goons'], rows: ['stats', 'priority', 'columns'], left: ['raid', 'squad', 'requirements'], right: ['favorites', 'tasks', 'gunsmith'] },
  hidden: ['stat-goons'],
  titles: { favorites: { ru: 'Мой рынок', en: 'My market' }, 'stat-tasks': { ru: 'Задачи', en: '' } },
})

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], demoDataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter><DashboardPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}
const order = (container: HTMLElement, selector: string) => [...container.querySelectorAll(selector)].map((element) => element.getAttribute('data-block'))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  reloadOverviewDefaultsForTests()
})
afterEach(() => {
  setOverviewDefaults(null)
  setRenderLanguage('ru')
})

describe('DashboardPage with the owner\'s blocks', () => {
  it('shows the owner\'s order, hides his hidden blocks and uses his headings; a change arrives live', () => {
    setOverviewDefaults(OWNER)
    const { container } = renderDashboard()
    expect(order(container, '.stat-grid > .overview-block')).toEqual(['stat-kappa', 'stat-tasks', 'stat-conditions'])
    expect(container.querySelector('.goon-card')).toBeNull()
    expect(order(container, '.dashboard-column:last-child > .overview-block')).toEqual(['favorites', 'tasks', 'gunsmith'])
    expect(screen.getByText('Мой рынок')).toHaveClass('panel-title')
    expect(screen.getByText('Задачи')).toHaveClass('stat-label')

    act(() => setOverviewDefaults(sanitizeOverviewDefaults({ hidden: ['favorites'], titles: {} })))
    expect(order(container, '.stat-grid > .overview-block')).toEqual(['stat-tasks', 'stat-conditions', 'stat-kappa', 'stat-goons'])
    expect(order(container, '.dashboard-column:last-child > .overview-block')).toEqual(['tasks', 'gunsmith'])
    expect(screen.queryByText('Мой рынок')).toBeNull()
  })

  it('a player\'s own «Настроить блоки» order wins over the owner\'s; the hidden block stays hidden', () => {
    localStorage.setItem(OVERVIEW_LAYOUT_KEY, JSON.stringify({ stats: ['stat-goons', 'stat-conditions', 'stat-tasks', 'stat-kappa'], rows: ['stats', 'priority', 'columns'], left: ['raid', 'squad', 'requirements'], right: ['gunsmith', 'tasks', 'favorites'] }))
    setOverviewDefaults(OWNER)
    const { container } = renderDashboard()
    expect(order(container, '.stat-grid > .overview-block')).toEqual(['stat-conditions', 'stat-tasks', 'stat-kappa'])
    expect(order(container, '.dashboard-column:last-child > .overview-block')).toEqual(['gunsmith', 'tasks', 'favorites'])
  })

  it('in English: the owner\'s English heading, or the standard one when he wrote none', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    setOverviewDefaults(OWNER)
    renderDashboard()
    expect(screen.getByText('My market')).toHaveClass('panel-title')
    expect(screen.queryByText('Задачи')).toBeNull()
  })
})
