import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppDataset } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { AppStateProvider } from '../state/AppState'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { item, quest } from '../raidprep/fixtures'
import { isKappaBadgeMissingOnly } from '../kappa/kappaBadgeSetting'
import { KappaItemsPage } from './KappaItemsPage'

const dataset: AppDataset = {
  ...demoDataset,
  items: [item('egg', 'Golden egg', { shortName: 'Egg' }), item('axe', 'Antique axe', { shortName: 'Axe' })],
  quests: [quest('5c51aac186f77432ea65c552', 'Коллекционер', { trader: 'Скупщик', kappa: true, requiredItems: ['egg', 'axe'] })],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={['/kappa-items']}><KappaItemsPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}

const SWITCH = 'Значок «Каппа» в рейде только на недостающих'

beforeEach(() => { localStorage.clear() })
afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop') })

describe('KappaItemsPage', () => {
  it('has the «Значок «Каппа» в рейде только на недостающих» switch in the Windows app: on by default, off and on again (owner, 13.10.2026)', async () => {
    Object.assign(window, { tarkovDesktop: {} })
    const user = userEvent.setup()
    renderPage()
    const toggle = await screen.findByRole('switch', { name: SWITCH })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle).toHaveClass('toggle', 'on')
    expect(isKappaBadgeMissingOnly()).toBe(true)
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(isKappaBadgeMissingOnly()).toBe(false)
    expect(localStorage.getItem('tarkov-kappa-badge-missing-only')).toBe('0')
    // The caption is part of the switch: clicking it turns the badge mode back on.
    await user.click(screen.getByText(SWITCH))
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(isKappaBadgeMissingOnly()).toBe(true)
  })

  it('has no switch without the Windows app: there is no in-raid card there', async () => {
    renderPage()
    // the two item tiles are there, the switch is not
    expect(await screen.findAllByRole('button', { pressed: false })).toHaveLength(2)
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
