import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { demoDataset } from '../data/demo'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import type { AppDataset, MapMarker } from '../domain/types'
import { clearQuestChecksBefore } from '../progression/questChecks'

// Two current Customs quests of the demo catalog, each with its own point on the map.
const ACTIVE = ['checking', 'operation-aquarius']

function renderCustoms() {
  let profile = createLocalProfile('TEST', 'raid-checks')
  for (const taskId of ACTIVE) profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-10-09T10:00:00.000Z' })
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

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Maps page: «Сделал в этом рейде»', () => {
  it('takes the points of a checked quest off the map and brings them back when the check is removed', async () => {
    renderCustoms()
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Сделал в этом рейде: / }).length).toBeGreaterThan(0))
    await waitFor(() => expect(questLayerCount()).toBe(ACTIVE.length))
    const before = questLayerCount()
    const check = screen.getAllByRole('button', { name: /^Сделал в этом рейде: / })[0]
    fireEvent.click(check)
    await waitFor(() => expect(questLayerCount()).toBeLessThan(before))
    fireEvent.click(screen.getByRole('button', { name: check.getAttribute('aria-label')! }))
    await waitFor(() => expect(questLayerCount()).toBe(before))
  })
})

// A player, 04.11.2026: «При закрытии всех целей в квесте … можно сделать так что он сам закрывался в меню справа, слишком
// неудобно ставить все галочки и еще ставить галочку о закрытии квеста».
// Owner, 04.11.2026: «если человек нажимает "Цель выполнена", например, пометить банкомат, то и найти первый банкомат на улице
// тоже закрывается. Так как он один».
describe('Maps page: «Пометить» closes the «Найти» at its place', () => {
  const NAME = 'Финансовая пирамида'
  const spot = (id: string, objectiveId: string, x: number): MapMarker => ({ id, mapId: 'customs', type: 'quest', layerId: 'quest.item', title: NAME, description: '', position: [x, 500], questId: 'golden-swag', objectiveId })
  const dataset: AppDataset = {
    ...demoDataset,
    quests: demoDataset.quests.map((quest) => (quest.id === 'golden-swag' ? {
      ...quest,
      name: NAME,
      objectiveIds: ['fp-mark', 'fp-far', 'fp-atm'],
      objectiveDetails: [
        { id: 'fp-mark', type: 'mark', description: 'Пометить банкомат', count: 1, mapIds: ['customs'] },
        { id: 'fp-far', type: 'visit', description: 'Найти первую группу банкоматов', count: 1, mapIds: ['customs'] },
        { id: 'fp-atm', type: 'visit', description: 'Найти первый банкомат', count: 1, mapIds: ['customs'] },
      ],
    } : quest)),
    markers: [...demoDataset.markers.filter((marker) => marker.questId !== 'golden-swag'), spot('mark-spot', 'fp-mark', 500), spot('far-spot', 'fp-far', 700), spot('atm-spot', 'fp-atm', 500.4)],
  }
  const line = (text: string) => [...document.querySelectorAll('.sheet-objective')].find((entry) => entry.textContent?.includes(text)) as HTMLElement
  const box = (text: string) => within(line(text)).getByRole('button', { name: /^(Цель выполнена|Снять галочку): / })
  const ticked = (text: string) => box(text).getAttribute('aria-pressed') === 'true'

  it('takes its own find with it and no other; a find alone closes only itself; taken back, the find stays', async () => {
    const profile = setTaskProgress(createLocalProfile('TEST', 'pairs'), 'pvp', { taskId: 'golden-swag', status: 'active', source: 'eft-log', updatedAt: '2026-11-04T05:00:00.000Z' })
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
    render(
      <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
        <MemoryRouter initialEntries={['/maps/customs']} useTransitions={false}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
      </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
    )
    await waitFor(() => expect(document.querySelector('.quest-map-row-main')).toBeTruthy())
    fireEvent.click(document.querySelector('.quest-map-row-main') as HTMLElement)
    await waitFor(() => expect(document.querySelectorAll('.sheet-objective').length).toBe(3))
    fireEvent.click(box('Найти первый банкомат'))
    expect(ticked('Пометить банкомат')).toBe(false)
    fireEvent.click(box('Найти первый банкомат'))
    expect(ticked('Найти первый банкомат')).toBe(false)
    fireEvent.click(box('Пометить банкомат'))
    expect(ticked('Пометить банкомат')).toBe(true)
    expect(ticked('Найти первый банкомат')).toBe(true)
    expect(ticked('Найти первую группу банкоматов')).toBe(false)
    fireEvent.click(box('Пометить банкомат'))
    expect(ticked('Пометить банкомат')).toBe(false)
    expect(ticked('Найти первый банкомат')).toBe(true)
  })
})

describe('Maps page: a quest closes by itself when its objectives on this map are all ticked', () => {
  const NAME = 'Золотая добыча'
  const point = (id: string, objectiveId: string): MapMarker => ({ id, mapId: 'customs', type: 'quest', layerId: 'quest.item', title: NAME, description: '', position: [500, 500], questId: 'golden-swag', objectiveId })
  const dataset: AppDataset = {
    ...demoDataset,
    quests: demoDataset.quests.map((quest) => (quest.id === 'golden-swag' ? {
      ...quest,
      objectiveIds: ['gs-find', 'gs-plant', 'gs-give'],
      objectiveDetails: [
        { id: 'gs-find', type: 'findQuestItem', description: 'Найти зажигалку', count: 1, mapIds: ['customs'] },
        { id: 'gs-plant', type: 'plantItem', description: 'Спрятать зажигалку', count: 1, mapIds: ['customs'] },
        // at the trader: it does not hold the quest open on the map
        { id: 'gs-give', type: 'giveItem', description: 'Сдать торговцу', count: 1 },
      ],
    } : quest)),
    markers: [...demoDataset.markers.filter((marker) => marker.questId !== 'golden-swag'), point('gs-find-spot', 'gs-find'), point('gs-plant-spot', 'gs-plant')],
  }
  const rows = () => [...document.querySelectorAll('.quest-map-row')]
  const quest = () => rows().find((entry) => entry.textContent?.includes(NAME)) as HTMLElement
  const lines = () => document.querySelectorAll('.sheet-objective')
  const tickLine = (text: string) => fireEvent.click(within([...lines()].find((line) => line.textContent?.includes(text)) as HTMLElement).getByRole('button', { name: /^(Цель выполнена|Снять галочку): / }))
  const open = () => fireEvent.click(quest().querySelector('.quest-map-row-main') as HTMLElement)

  function renderQuest() {
    let profile = createLocalProfile('TEST', 'settled')
    for (const taskId of ['golden-swag', 'checking']) profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-11-04T05:00:00.000Z' })
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
    return render(
      <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
        {/* as in main.tsx: a change of the address renders at once */}
        <MemoryRouter initialEntries={['/maps/customs']} useTransitions={false}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
      </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
    )
  }

  it('the last tick closes the row and the window without a second check; a tick taken back opens it again', async () => {
    renderQuest()
    await waitFor(() => expect(quest()).toBeTruthy())
    open()
    await waitFor(() => expect(lines().length).toBe(3))
    tickLine('Найти зажигалку')
    // one of the two: still open
    expect(quest()).not.toHaveClass('is-raid-checked')
    expect(lines().length).toBe(3)
    tickLine('Спрятать зажигалку')
    await waitFor(() => expect(document.querySelector('.map-quest-sheet.is-open')).toBeNull())
    expect(quest()).toHaveClass('is-raid-checked')
    const check = within(quest()).getByRole('button', { name: `Все цели отмечены: ${NAME}` })
    expect(check).toHaveAttribute('aria-pressed', 'true')
    expect(check).toBeDisabled()
    expect(check).toHaveAttribute('title', 'Все цели отмечены. Снять можно в целях квеста')
    // last in its list, and it is no check for one raid: no note about the next raid
    expect(rows().at(-1)).toBe(quest())
    expect(document.querySelector('.quest-raid-note')).toBeNull()
    // the next raid's start leaves it closed, and the quest stays current for the game to complete
    act(() => { clearQuestChecksBefore('settled', Date.now() + 1000) })
    expect(quest()).toHaveClass('is-raid-checked')
    expect(JSON.parse(localStorage.getItem('tarkov-operations-profiles-v2')!).profiles[0].modes.pvp.taskProgress['golden-swag'].status).toBe('active')

    open()
    await waitFor(() => expect(lines().length).toBe(3))
    tickLine('Спрятать зажигалку')
    await waitFor(() => expect(quest()).not.toHaveClass('is-raid-checked'))
    expect(within(quest()).getByRole('button', { name: `Сделал в этом рейде: ${NAME}` })).toBeEnabled()
  })
})
