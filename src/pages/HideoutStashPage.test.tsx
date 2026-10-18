import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppDataset } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { AppStateProvider } from '../state/AppState'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { item, quest, station } from '../raidprep/fixtures'
import { loadCollected } from '../kappa/collector'
import { HideoutStashPage } from './HideoutStashPage'

const dataset: AppDataset = {
  ...demoDataset,
  items: [item('egg', 'Golden egg', { shortName: 'Egg' }), item('bolts', 'Bolts', { shortName: 'Bolts' })],
  quests: [quest('5c51aac186f77432ea65c552', 'Коллекционер', { trader: 'Скупщик', kappa: true, requiredItems: ['egg'] })],
  hideout: [station('gen', 'Генератор', [{ level: 1, requirements: [], bonus: '', itemRequirements: [{ itemId: 'bolts', count: 3 }] }])],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={['/hideout-stash']}><HideoutStashPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop') })

describe('HideoutStashPage «Синхронизация по экрану»', () => {
  it('one button: Kappa items go to «Каппа», hideout pieces to «Убежище»', async () => {
    const scanScreenText = vi.fn().mockResolvedValue({ text: 'Egg\nBolts\nBolts', gameWindow: true, read: 3, pending: 0 })
    Object.assign(window, { tarkovDesktop: { scanScreenText } })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Синхронизация по экрану/ }))
    expect(await screen.findByText(/Каппа: \+1, Убежище: \+2/)).toBeInTheDocument()
    // A second press stops the scan.
    await user.click(screen.getByRole('button', { name: /Остановить/ }))
    expect(loadCollected('pvp')).toEqual(['egg'])
    expect(await screen.findByText('2/3')).toBeInTheDocument()
  })

  it('has no screen sync without the Windows app', async () => {
    renderPage()
    expect(await screen.findByText('0/3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Синхронизация по экрану/ })).toBeNull()
  })
})
