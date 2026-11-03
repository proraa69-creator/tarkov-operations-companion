import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { demoDataset } from '../data/demo'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { deferredQuestsKey } from '../progression/deferredQuests'
import { deferredFavoritesOn } from '../progression/questDeferral'

// Two current Customs quests of the demo catalog, each with its own point on the map and its key.
const ACTIVE = ['checking', 'operation-aquarius']
let profileId = ''

function renderCustoms() {
  let profile = createLocalProfile('TEST', 'deferred')
  for (const taskId of ACTIVE) profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-10-09T10:00:00.000Z' })
  profileId = profile.id
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], demoDataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={['/maps/customs']}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
// In the demo catalog the quest points of Customs are on the «Квестовые предметы» layer.
const questLayerCount = () => Number(within(screen.getByRole('button', { name: /^Квестовые предметы\s*\d+$/ })).getByText(/^\d+$/).textContent)
const row = (name: string) => screen.queryByRole('button', { name: `Сделал в этом рейде: ${name}` })?.closest('.quest-map-row') ?? null
/** «Избранное» of the profile as the app keeps it. */
const favorites = () => (JSON.parse(localStorage.getItem('tarkov-operations-profiles-v2')!) as { profiles: Array<{ modes: { pvp: { favoriteItemIds: string[] } } }> }).profiles[0]!.modes.pvp.favoriteItemIds

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Maps page: «Отложенные квесты»', () => {
  it('a right click puts a quest aside: its row and points go, the button counts it, «Вернуть» brings it back', async () => {
    renderCustoms()
    await waitFor(() => expect(row('Проверка')).not.toBeNull())
    await waitFor(() => expect(questLayerCount()).toBe(ACTIVE.length))
    const before = questLayerCount()
    expect(screen.getByRole('button', { name: 'Отложенные квесты' })).not.toHaveClass('has-deferred')

    fireEvent.contextMenu(row('Проверка')!, { clientX: 300, clientY: 200 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Меню квеста' })).getByRole('menuitem', { name: 'Добавить в отложенные' }))
    await waitFor(() => expect(row('Проверка')).toBeNull())
    expect(row('Операция «Водолей»')).not.toBeNull()
    await waitFor(() => expect(questLayerCount()).toBeLessThan(before))
    expect(Object.keys(JSON.parse(localStorage.getItem(deferredQuestsKey(profileId, 'pvp'))!))).toEqual(['checking'])

    // The window: the quest with the key it waits for.
    fireEvent.click(screen.getByRole('button', { name: 'Отложенные квесты: 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Отложенные квесты' })
    const checking = within(dialog).getByRole('checkbox', { name: /Проверка/ })
    expect(checking.closest('label')).toHaveTextContent('Ключ от спецтехники')
    // its key went to «Избранное» while it waits
    const key = demoDataset.items.find((item) => item.name === 'Ключ от спецтехники')!
    expect(favorites()).toContain(key.id)
    fireEvent.click(checking)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вернуть (1)' }))
    await waitFor(() => expect(row('Проверка')).not.toBeNull())
    await waitFor(() => expect(questLayerCount()).toBe(before))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Отложенные квесты' })).toBeInTheDocument()
    expect(localStorage.getItem(deferredQuestsKey(profileId, 'pvp'))).toBeNull()
    // back: the key the feature added leaves «Избранное» (owner, 03.11.2026)
    await waitFor(() => expect(favorites()).not.toContain(key.id))
  })

  // Owner, 03.11.2026: «предмет или ключ который требуется для квеста который отложен, сам добавлялся в избранное как
  // напоминание… при нажатии кнопки отложенные квесты, открывается окно и там справа будет эта кнопка».
  it('the key of a quest put aside goes to «Избранное»; the switch on the right of the window turns that off', async () => {
    const key = demoDataset.items.find((item) => item.name === 'Ключ от спецтехники')!
    renderCustoms()
    await waitFor(() => expect(row('Проверка')).not.toBeNull())
    expect(favorites()).not.toContain(key.id)
    fireEvent.contextMenu(row('Проверка')!, { clientX: 300, clientY: 200 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Меню квеста' })).getByRole('menuitem', { name: 'Добавить в отложенные' }))
    await waitFor(() => expect(favorites()).toContain(key.id))

    fireEvent.click(screen.getByRole('button', { name: 'Отложенные квесты: 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Отложенные квесты' })
    const toggle = within(dialog).getByRole('switch', { name: 'Предметы в избранное' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(deferredFavoritesOn()).toBe(false)
    // off: the next quest put aside adds nothing
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    const before = favorites()
    fireEvent.contextMenu(row('Операция «Водолей»')!, { clientX: 300, clientY: 260 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Меню квеста' })).getByRole('menuitem', { name: 'Добавить в отложенные' }))
    await waitFor(() => expect(row('Операция «Водолей»')).toBeNull())
    expect(favorites()).toEqual(before)
  })

  it('with every quest of the map put aside, says where they are', async () => {
    renderCustoms()
    await waitFor(() => expect(row('Проверка')).not.toBeNull())
    localStorage.setItem(deferredQuestsKey(profileId, 'pvp'), JSON.stringify({ checking: 1, 'operation-aquarius': 2 }))
    window.dispatchEvent(new Event('tarkov-deferred-quests-changed'))
    expect(await screen.findByText('Квесты этой карты отложены')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отложенные квесты: 2' })).toBeInTheDocument()
  })
})
