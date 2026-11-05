import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDataset } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { QuestsPage } from './QuestsPage'
import { AppStateProvider } from '../state/AppState'

const dataset: AppDataset = { ...demoDataset, quests: demoDataset.quests.filter((quest) => quest.kind !== 'story') }
const CHECKING = dataset.quests.find((quest) => quest.id === 'checking')!
const OTHER = dataset.quests.find((quest) => quest.id === 'operation-aquarius')!

function renderQuests(path = '/quests') {
  let profile = createLocalProfile('TEST', 'deferred')
  // The logs: two quests taken.
  for (const taskId of [CHECKING.id, OTHER.id]) profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-10-15T10:00:00.000Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={[path]}><QuestsPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}
/** A quest's row in «Каталог заданий». */
const row = (name: string) => [...document.querySelectorAll('.catalog-list .quest-map-row')].find((entry) => entry.querySelector('h3')?.textContent === name) ?? null
const deferThrough = (name: string) => {
  fireEvent.contextMenu(row(name)!, { clientX: 200, clientY: 300 })
  fireEvent.click(within(screen.getByRole('menu', { name: 'Меню квеста' })).getByRole('menuitem', { name: 'Отложить квест' }))
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(cleanup)

describe('Quests page: «Отложенные квесты»', () => {
  it('«У меня нет этого квеста» on the right click: the quest leaves «Текущие», not into «Отложенные» (owner, 04.11.2026)', async () => {
    renderQuests()
    await waitFor(() => expect(row(CHECKING.name)).not.toBeNull())
    fireEvent.contextMenu(row(CHECKING.name)!, { clientX: 200, clientY: 300 })
    const menu = screen.getByRole('menu', { name: 'Меню квеста' })
    expect(within(menu).getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual(['Отложить квест', 'Добавить в текущие', 'У меня нет этого квеста'])
    expect(within(menu).getByRole('menuitem', { name: 'Добавить в текущие' })).toBeDisabled()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'У меня нет этого квеста' }))
    await waitFor(() => expect(row(CHECKING.name)).toBeNull())
    expect(row(OTHER.name)).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Отложенные квесты: 1' })).toBeNull()
  })

  it('«Добавить в текущие» on the right click of a quest not taken: it is current at once, without a scan (owner, 05.11.2026)', async () => {
    const NOT_TAKEN = dataset.quests.find((quest) => quest.id !== CHECKING.id && quest.id !== OTHER.id)!
    renderQuests('/quests?filter=all')
    await waitFor(() => expect(row(NOT_TAKEN.name)).not.toBeNull())
    fireEvent.contextMenu(row(NOT_TAKEN.name)!, { clientX: 200, clientY: 300 })
    const menu = screen.getByRole('menu', { name: 'Меню квеста' })
    expect(within(menu).getByRole('menuitem', { name: 'Отложить квест' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'У меня нет этого квеста' })).toBeDisabled()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Добавить в текущие' }))
    fireEvent.contextMenu(row(NOT_TAKEN.name)!, { clientX: 200, clientY: 300 })
    await waitFor(() => expect(within(screen.getByRole('menu', { name: 'Меню квеста' })).getByRole('menuitem', { name: 'У меня нет этого квеста' })).toBeEnabled())
    expect(within(screen.getByRole('menu', { name: 'Меню квеста' })).getByRole('menuitem', { name: 'Добавить в текущие' })).toBeDisabled()
  })

  it('a quest put aside leaves «Текущие», the button next to the tabs counts it and brings it back', async () => {
    renderQuests()
    await waitFor(() => expect(row(CHECKING.name)).not.toBeNull())
    deferThrough(CHECKING.name)
    await waitFor(() => expect(row(CHECKING.name)).toBeNull())
    expect(row(OTHER.name)).not.toBeNull()
    const button = screen.getByRole('button', { name: 'Отложенные квесты: 1' })
    expect(button.closest('.quest-filter-bar')).not.toBeNull()

    // A search for it in «Текущие» says where it went.
    fireEvent.change(screen.getByPlaceholderText('Поиск задания…'), { target: { value: CHECKING.name } })
    expect(await screen.findByText(/Это в «Отложенных квестах»/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Поиск задания…'), { target: { value: '' } })

    // «Все» still lists it, without the menu (it is put aside already).
    fireEvent.click(screen.getByRole('button', { name: 'Все' }))
    await waitFor(() => expect(row(CHECKING.name)).not.toBeNull())
    fireEvent.contextMenu(row(CHECKING.name)!)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Текущие' }))

    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: 'Отложенные квесты' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Проверка/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вернуть (1)' }))
    await waitFor(() => expect(row(CHECKING.name)).not.toBeNull())
    expect(screen.getByRole('button', { name: 'Отложенные квесты' })).toBeInTheDocument()
  })
})
