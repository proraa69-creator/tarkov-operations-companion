import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'

function renderApp(route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={[route]}><App /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider>)
}

describe('App', () => {
  it('renders the command center', () => {
    renderApp()
    expect(screen.getByRole('heading', { name: /следующий рейд начинается здесь/i })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Основная навигация' })).getByRole('link', { name: 'Карты' })).toBeInTheDocument()
  })

  it('renders quest catalog on its route', () => {
    renderApp('/quests')
    expect(screen.getByRole('heading', { name: 'Задания' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Доступные' })).toHaveClass('active')
    expect(screen.getAllByRole('button', { name: /Отметить выполненным:/ }).length).toBeGreaterThan(0)
  })
})
