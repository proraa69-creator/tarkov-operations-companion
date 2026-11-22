import '@testing-library/jest-dom/vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDataset } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { QuestsPage } from './QuestsPage'
import { AppStateProvider } from '../state/AppState'

const quests = demoDataset.quests.filter((quest) => quest.kind !== 'story')
const TAKEN = quests.find((quest) => quest.id === 'checking')!
const NOT_TAKEN = quests.find((quest) => quest.id !== TAKEN.id && !quest.storyChapterId)!
const item = demoDataset.items[0]!
const trader = demoDataset.traders[0]!
// Both quests open the same item at a trader (report 171).
const dataset: AppDataset = { ...demoDataset, quests: quests.map((quest) => quest.id === TAKEN.id || quest.id === NOT_TAKEN.id ? { ...quest, offerUnlocks: [{ itemId: item.id, traderId: trader.id, level: 2 }] } : quest) }

function Where() { return <output data-testid="where">{useLocation().search}</output> }
const search = () => document.querySelector('[data-testid="where"]')?.textContent ?? ''

function renderQuests(path: string) {
  let profile = createLocalProfile('TEST', 'unlocks')
  profile = setTaskProgress(profile, 'pvp', { taskId: TAKEN.id, status: 'active', source: 'eft-log', updatedAt: '2026-11-16T10:00:00.000Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={[path]}><QuestsPage /><Where /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}
const detail = () => document.querySelector('.quest-detail')!
const activeTab = () => document.querySelector('.segmented-filter button.active')?.textContent

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(cleanup)

describe('Quests page: a quest opened from an item’s card (report 171)', () => {
  it('a current quest opens in «Текущие» with what it opens in «Награды»', async () => {
    renderQuests(`/quests?selected=${TAKEN.id}&find=1`)
    await waitFor(() => expect(search()).not.toContain('find'))
    expect(activeTab()).toBe('Текущие')
    expect(detail().textContent).toContain(TAKEN.name)
    expect(detail().textContent).toContain('Открывает у торговцев')
    expect(detail().querySelector(`a[href="/flea?selected=${item.id}"]`)).not.toBeNull()
  })

  it('a quest not among the current ones opens in «Все»', async () => {
    renderQuests(`/quests?selected=${NOT_TAKEN.id}&find=1`)
    await waitFor(() => expect(activeTab()).toBe('Все'))
    expect(search()).toContain('filter=all')
    expect(search()).not.toContain('find')
    expect(detail().textContent).toContain(NOT_TAKEN.name)
    expect(detail().textContent).toContain('Открывает у торговцев')
  })
})
