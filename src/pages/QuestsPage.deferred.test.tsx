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
  fireEvent.click(within(screen.getByRole('menu', { name: 'Меню квеста' })).getByRole('menuitem', { name: 'Добавить в отложенные' }))
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(cleanup)

describe('Quests page: «Отложенные квесты»', () => {
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

  it('a quest not taken has no menu', async () => {
    renderQuests('/quests?filter=all')
    const notTaken = dataset.quests.find((quest) => ![CHECKING.id, OTHER.id].includes(quest.id))!
    await waitFor(() => expect(row(notTaken.name)).not.toBeNull())
    fireEvent.contextMenu(row(notTaken.name)!)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
