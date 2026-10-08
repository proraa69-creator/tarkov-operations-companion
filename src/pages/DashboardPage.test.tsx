import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppDataset, Item, Quest } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { AppStateProvider } from '../state/AppState'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { DashboardPage } from './DashboardPage'

// «Сорвать сделку»: one stash objective that accepts any 7.62x51 pack (tarkov.dev ids and Russian names).
const PACKS: Array<[string, string]> = [
  ['65702566bfc87b3a3409324d', 'ТПЗ SP'], ['65702561cfc010a0f5006a28', 'БПЗ FMJ'], ['6570255dbfc87b3a3409324a', 'Ultra Nosler'],
  ['65702558cfc010a0f5006a25', 'M80'], ['65702554bfc87b3a34093247', 'M62 Tracer'], ['6570254fcfc010a0f5006a22', 'M61'],
  ['648984e3f09d032aa9399d53', 'M993'], ['6769b8e3c1a1466c850658a8', 'M80A1'],
]
const ELCAN: Array<[string, string]> = [['57ac965c24597706be5f975c', 'Оптический прицел ELCAN "SpecterDR 1x/4x"'], ['57aca93d2459771f2c7e26db', 'Оптический прицел ELCAN "SpecterDR 1x/4x" (FDE)']]
const item = (id: string, name: string, types: string[]): Item => ({ id, name, shortName: name, category: 'Бартер', description: '', types, prices: [] })
const task = (id: string, name: string, level: number, raidRequirements: Quest['raidRequirements']): Quest => ({
  id, name, trader: 'Барахольщик', mapId: 'customs', mapIds: ['customs'], level, kappa: false, description: '', objectives: [], rewards: [], raidRequirements,
})
const dataset: AppDataset = {
  ...demoDataset,
  quests: [
    ...demoDataset.quests,
    task('break-the-deal', 'Сорвать сделку', 12, PACKS.map(([itemId]) => ({ itemId, count: 1, purpose: 'place', mapIds: ['customs'], objectiveId: 'break-the-deal-stash', alternatives: PACKS.length }))),
    task('scope-stash', 'Оптика', 14, ELCAN.map(([itemId]) => ({ itemId, count: 1, purpose: 'place', mapIds: ['customs'], objectiveId: 'scope-stash-obj', alternatives: 2 }))),
  ],
  items: [
    ...demoDataset.items,
    ...PACKS.map(([id, name]) => item(id, `Пачка патронов 7.62x51мм ${name} (20 штук)`, ['ammoBox'])),
    ...ELCAN.map(([id, name]) => item(id, name, ['mods'])),
    // Favourites: a trader quote above the flea price (the old Math.max picked it), and an item priced only in PvE.
    { ...item('fav-odd', 'Флешка', ['barter']), prices: [
      { source: 'Барахолка', price: 36500, mode: 'pvp', updatedAt: '', kind: 'flea', basis: 'last-low' },
      { source: 'Терапевт', price: 40000, mode: 'pvp', updatedAt: '', kind: 'trader' },
    ] },
    { ...item('fav-pve', 'Тетрис', ['barter']), prices: [{ source: 'Барахолка', price: 410000, mode: 'pve', updatedAt: '', kind: 'flea' }] },
  ],
}
// «Дебют» is not in the log: «Проверка», which requires it, is current, so the chain counts «Дебют» as done.
const CUSTOMS_TASKS = ['checking', 'operation-aquarius', 'golden-swag', 'bp-depot', 'pharmacist', 'break-the-deal', 'scope-stash']

function renderDashboard(favoriteItemIds?: string[]) {
  let profile = createLocalProfile('TEST', 'overview')
  if (favoriteItemIds) profile = { ...profile, modes: { ...profile.modes, pvp: { ...profile.modes.pvp, favoriteItemIds } } }
  for (const taskId of [...CUSTOMS_TASKS, 'grenadier']) profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-10-08T10:00:00.000Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter><DashboardPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => setRenderLanguage('ru'))

describe('DashboardPage', () => {
  it('puts «Приоритет карт» across the page under the cards and the raid requirements in the left column, with one row for any 7.62x51 pack', () => {
    const { container } = renderDashboard()
    const priority = container.querySelector('.map-priority') as HTMLElement
    expect(priority.previousElementSibling).toHaveClass('stat-grid')
    expect(priority.closest('.dashboard-layout')).toBeNull()
    expect(priority.querySelectorAll('.map-priority-tile')).toHaveLength(dataset.maps.length)
    const [left, right] = [...container.querySelectorAll('.dashboard-column')]
    const needs = left.querySelector('.raid-needs') as HTMLElement
    expect(needs).not.toBeNull()
    expect(right.querySelector('.raid-needs')).toBeNull()
    expect(within(needs).getByText('Любая пачка патронов 7.62x51')).toBeInTheDocument()
    expect(within(needs).queryByText(/M80 \(20 штук\)/)).toBeNull()
    expect(within(needs).getAllByText(/ELCAN/)).toHaveLength(2)
    expect(within(needs).getByText('Любая пачка патронов 7.62x51').closest('a')?.getAttribute('title')).toContain('Пачка патронов 7.62x51мм M80A1 (20 штук)')
  })

  it('shows three current tasks of the map, «11 на Таможне»-style count and the rest behind «Ещё»', async () => {
    const user = userEvent.setup()
    const { container } = renderDashboard()
    const panel = container.querySelector('.current-tasks') as HTMLElement
    expect(within(panel).getByRole('link', { name: `${CUSTOMS_TASKS.length} на Таможне` })).toHaveClass('panel-title')
    const visible = [...panel.querySelectorAll(':scope > .panel-body > .quest-row strong')].map((node) => node.textContent)
    // earliest first (level, then chain depth), not catalog order
    expect(visible).toEqual(['Проверка', 'БП «Топливо»', 'Операция «Водолей»'])
    // four more tasks of Customs and «Гренадёр» from «Любая карта»
    const toggle = within(panel).getByRole('button', { name: /Ещё 5 заданий/ })
    await user.click(toggle)
    expect(panel.querySelector('.current-tasks-more')).toHaveClass('is-open')
    expect(within(panel).getByRole('button', { name: /Свернуть/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps the four stat cards in order; «Квесты» on the Kappa card opens the four key tasks for «Коллекционер»', async () => {
    const user = userEvent.setup()
    const { container } = renderDashboard()
    const cards = [...container.querySelectorAll('.stat-grid > .stat-card')]
    expect(cards).toHaveLength(4)
    expect(cards[2]).toHaveClass('kappa-card')
    expect(cards[2]).toHaveTextContent('Выполнено 0 из 4')
    await user.click(within(cards[2] as HTMLElement).getByRole('button', { name: 'Квесты' }))
    const dialog = document.querySelector('[role=dialog]') as HTMLElement
    expect([...dialog.querySelectorAll('.kappa-quest strong')].map((node) => node.textContent))
      .toEqual(['Реагент. Часть 4', 'Стрелок от бога', 'Тарковский стрелок. Часть 4', 'Шить — не тужить. Часть 4'])
  })
  it('market favourites show the PvP flea price (cheapest offer), not the highest quote nor another mode\'s price', () => {
    const { container } = renderDashboard(['fav-odd', 'fav-pve'])
    const rows = [...container.querySelectorAll('.market-favorites .item-row')].map((row) => row.textContent?.replace(/\s+/g, ' '))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('барахолка, минимальное предложение')
    expect(rows[0]).toMatch(/36 500 ₽/)
    expect(rows[0]).not.toMatch(/40 000/)
    expect(rows[1]).toContain('нет цены')
    expect(rows[1]).not.toMatch(/410 000/)
  })
})
