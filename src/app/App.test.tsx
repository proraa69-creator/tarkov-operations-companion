import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { demoDataset } from '../data/demo'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { installCatalogTranslations } from '../i18n/renderText'

function renderApp(route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], demoDataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={[route]}><App /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}

describe('App', () => {
  it('round trips RU → EN → RU without changing quest progress, catalog, or navigation', async () => {
    const user = userEvent.setup()
    let profile = createLocalProfile('TEST', 'locale-regression')
    profile = setTaskProgress(profile, 'pvp', { taskId: demoDataset.quests[0].id, status: 'active', source: 'eft-log', updatedAt: '2026-09-28T00:00:00Z' })
    profile = setTaskProgress(profile, 'pve', { taskId: demoDataset.quests[1].id, status: 'completed', source: 'screen-scan', updatedAt: '2026-09-28T00:00:00Z' })
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
    installCatalogTranslations([[demoDataset.quests[0].name, 'Test quest']])
    renderApp('/quests')
    const saved = localStorage.getItem('tarkov-operations-profiles-v2')
    for (let pass = 0; pass < 2; pass++) {
      await user.click(screen.getByRole('button', { name: 'EN' }))
      expect(screen.getByRole('heading', { name: 'Current tasks' })).toBeInTheDocument()
      expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Maps' })).toBeInTheDocument()
      expect(screen.getAllByText('Test quest').length).toBeGreaterThan(0)
      expect(localStorage.getItem('tarkov-operations-profiles-v2')).toBe(saved)
      await user.click(screen.getByRole('button', { name: 'RU' }))
      expect(within(screen.getByRole('navigation', { name: 'Основная навигация' })).getByRole('link', { name: 'Карты' })).toBeInTheDocument()
      expect(screen.getAllByText(demoDataset.quests[0].name).length).toBeGreaterThan(0)
      expect(localStorage.getItem('tarkov-operations-profiles-v2')).toBe(saved)
    }
    expect(document.querySelector('.sidebar-footer')).toBeNull()
  })
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('renders the command center', () => {
    renderApp()
    expect(screen.getByRole('heading', { name: /следующий рейд начинается здесь/i })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Основная навигация' })).getByRole('link', { name: 'Карты' })).toBeInTheDocument()
  })

  it('renders quest catalog on its route', () => {
    renderApp('/quests')
    expect(screen.getByRole('heading', { name: 'Текущие задания' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Текущие' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Все' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сюжетные' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Доступные' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Недоступные' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Поиск квестов в игре/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/в журналах этого режима нет принятых заданий/i).length).toBeGreaterThan(0)
    expect(screen.queryByText('Гренадёр')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Тур' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Отметить выполненным:/ })).not.toBeInTheDocument()
  })

  it('lists story chapters without a manual stage picker', async () => {
    const user = userEvent.setup()
    renderApp('/quests')
    await user.click(screen.getByRole('button', { name: 'Сюжетные' }))
    expect(screen.getByRole('heading', { name: 'Сюжетные квесты' })).toBeInTheDocument()
    expect(screen.getByText(/когда в игре открыта вкладка сюжета/i)).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Тур' }).length).toBeGreaterThan(0)
    expect(screen.queryByText('Где вы в этой главе')).not.toBeInTheDocument()
  })

  it('puts the rest of the catalog on the All tab', async () => {
    const user = userEvent.setup()
    renderApp('/quests')
    await user.click(screen.getByRole('button', { name: 'Все' }))
    expect(screen.getByRole('heading', { name: 'Все задания' })).toBeInTheDocument()
    expect(screen.getByText('Гренадёр')).toBeInTheDocument()
    expect(screen.getAllByText('Дебют').length).toBeGreaterThan(0)
  })

  it('keeps trader portraits compact and does not show extra trader details', () => {
    renderApp('/traders')
    expect(screen.getByRole('heading', { name: 'Торговцы' })).toBeInTheDocument()
    expect(screen.getByText(/выберите портрет торговца, подробные данные появятся в следующих версиях/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Прапор' })).toBeInTheDocument()
    expect(screen.queryByText(/ассортимент, репутация/i)).not.toBeInTheDocument()
  })

  it('adds a selected flea item to the raid list', async () => {
    const user = userEvent.setup()
    renderApp('/flea?selected=graphics-card')
    await user.click(screen.getByRole('button', { name: 'В список рейда' }))
    expect(screen.getByRole('button', { name: 'В списке рейда' })).toBeInTheDocument()
  })
})
