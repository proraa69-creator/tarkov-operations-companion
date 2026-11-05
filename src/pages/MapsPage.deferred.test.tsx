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

function renderCustoms(extraMarkers: unknown[] = []) {
  let profile = createLocalProfile('TEST', 'deferred')
  for (const taskId of ACTIVE) profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-10-09T10:00:00.000Z' })
  profileId = profile.id
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], { ...demoDataset, markers: [...demoDataset.markers, ...extraMarkers] as typeof demoDataset.markers })
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

// Owner, 04.11.2026: «Справа сверху в этом окне нижнем с квестом будет кнопка "Чего-то не хватает" и знак вопроса».
describe('Maps page: «Нашли неточность?» on the quest window', () => {
  it('opens the report on the quest that is open, on this map, with the map to place a point on', async () => {
    renderCustoms()
    await waitFor(() => expect(row('Проверка')).not.toBeNull())
    expect(screen.queryByRole('button', { name: 'Нашли неточность?' })).toBeNull()
    fireEvent.click((row('Проверка') as HTMLElement).querySelector('.quest-map-row-main')!)
    const report = await screen.findByRole('button', { name: 'Нашли неточность?' })
    expect(report.closest('.map-quest-sheet-body')).toHaveTextContent('Проверка')
    fireEvent.click(report)
    const dialog = await screen.findByRole('dialog', { name: /Отправить отчёт об ошибке|Сообщить об ошибке/ })
    expect(dialog).toBeInTheDocument()
  })
})

describe('Maps page: «Отложенные квесты»', () => {
  it('a right click puts a quest aside: its row and points go, the button counts it, «Вернуть» brings it back', async () => {
    renderCustoms()
    await waitFor(() => expect(row('Проверка')).not.toBeNull())
    await waitFor(() => expect(questLayerCount()).toBe(ACTIVE.length))
    const before = questLayerCount()
    expect(screen.getByRole('button', { name: 'Отложенные квесты' })).not.toHaveClass('has-deferred')

    fireEvent.contextMenu(row('Проверка')!, { clientX: 300, clientY: 200 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Меню квеста' })).getByRole('menuitem', { name: 'Отложить квест' }))
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
    fireEvent.click(within(screen.getByRole('menu', { name: 'Меню квеста' })).getByRole('menuitem', { name: 'Отложить квест' }))
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
    fireEvent.click(within(screen.getByRole('menu', { name: 'Меню квеста' })).getByRole('menuitem', { name: 'Отложить квест' }))
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

describe('Maps page: «Документы боевого пропуска»', () => {
  const documentLayer = () => screen.getByRole('button', { name: /^Документы боевого пропуска\s*\d+$/ })
  const documentCount = () => Number(within(documentLayer()).getByText(/^\d+$/).textContent)

  it('«Нашёл» takes the point off the map and the count, «Вернуть найденные» brings it back', async () => {
    const markers = [
      { id: 'customs-battle-pass-documents-2', mapId: 'customs', title: 'Документы боевого пропуска', description: 'Финансовая документация.', type: 'cache', layerId: 'loot.documents', position: [-186.86, 318.24], approximate: true, source: 'battle-pass-documents' },
      { id: 'customs-battle-pass-documents-12', mapId: 'customs', title: 'Документы боевого пропуска', description: 'Проектная документация.', type: 'cache', layerId: 'loot.documents', position: [-180.25, 315.76], approximate: true, source: 'battle-pass-documents' },
    ]
    renderCustoms(markers)
    await waitFor(() => expect(documentCount()).toBe(2))
    fireEvent.click(documentLayer())
    await waitFor(() => expect(document.querySelectorAll('.map-marker.is-document').length).toBe(2))

    // Under the layer's button no lists: the kinds are on the map.
    expect(screen.queryByText('Финансовая документация')).toBeNull()

    fireEvent.click(document.querySelector('.map-marker.is-document')!.closest('.leaflet-marker-icon')!)
    const found = await screen.findByRole('button', { name: 'Нашёл' })
    // The card: the kind as its title and the floor; the common name and the kind a second time are gone.
    const card = found.closest('.map-marker-detail-card') as HTMLElement
    expect(within(card).getByRole('heading', { name: 'Финансовая документация' })).toBeInTheDocument()
    expect(card).not.toHaveTextContent('Документы боевого пропуска')
    expect(card).not.toHaveTextContent('Боевой пропуск')
    expect(within(card).getAllByText('Финансовая документация')).toHaveLength(1)
    fireEvent.click(found)
    await waitFor(() => expect(documentCount()).toBe(1))
    expect(document.querySelectorAll('.map-marker.is-document').length).toBe(1)
    expect(screen.queryByRole('button', { name: 'Нашёл' })).toBeNull()
    expect(JSON.parse(localStorage.getItem(`raidos-found-documents-v1:${profileId}:pvp`)!)).toHaveProperty('customs-battle-pass-documents-2')

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть найденные (1)' }))
    await waitFor(() => expect(documentCount()).toBe(2))
    expect(localStorage.getItem(`raidos-found-documents-v1:${profileId}:pvp`)).toBeNull()
  })
})
