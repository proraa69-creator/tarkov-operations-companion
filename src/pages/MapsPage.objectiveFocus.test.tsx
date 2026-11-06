import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { demoDataset } from '../data/demo'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import type { AppDataset, MapMarker } from '../domain/types'

// «Золотая добыча» with a point for each objective: the lighter in room 303, then two places to hide it.
const point = (id: string, objectiveId: string, description: string, position: [number, number]): MapMarker => ({
  id, mapId: 'customs', type: 'quest', layerId: 'quest.item', title: 'Золотая добыча', description, position, questId: 'golden-swag', objectiveId,
})
const dataset: AppDataset = {
  ...demoDataset,
  quests: demoDataset.quests.map((quest) => (quest.id === 'golden-swag' ? {
    ...quest,
    objectiveIds: ['gs-find', 'gs-plant'],
    objectiveDetails: [
      { id: 'gs-find', type: 'findQuestItem', description: 'Найти зажигалку Зиббо', count: 1, mapIds: ['customs'] },
      { id: 'gs-plant', type: 'plantItem', description: 'Спрятать зажигалку в бытовке', count: 1, mapIds: ['customs'] },
    ],
  } : quest)),
  markers: [
    ...demoDataset.markers.filter((marker) => marker.questId !== 'golden-swag'),
    point('gs-find', 'gs-find', 'Комната 303 трёхэтажного общежития', [548, 510]),
    point('gs-plant', 'gs-plant', 'Бытовка на стройке', [470, 690]),
    point('gs-plant-b', 'gs-plant', 'Вторая бытовка у забора', [455, 705]),
  ],
}

function Search() {
  return <p data-testid="search">{useLocation().search}</p>
}

function renderMaps(path: string) {
  const profile = setTaskProgress(createLocalProfile('TEST', 'objective-focus'), 'pvp', { taskId: 'golden-swag', status: 'active', source: 'eft-log', updatedAt: '2026-11-03T10:00:00.000Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={[path]}><Routes><Route path="/maps/:mapId" element={<><MapsPage /><Search /></>} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
const pickedPoint = () => document.querySelector('.map-quest-sheet-point')
const litObjective = () => document.querySelector('.sheet-objective.is-focus')

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Maps page: a quest opened at an objective (?objective=, «Требования рейда» on the Overview)', () => {
  it('picks the first point of that objective and lights it in the quest window', async () => {
    renderMaps('/maps/customs?quest=golden-swag&objective=gs-plant')
    await waitFor(() => expect(pickedPoint()).toHaveTextContent('Бытовка на стройке'), { timeout: 5000 })
    expect(litObjective()).toHaveTextContent('Спрятать зажигалку в бытовке')
    // every point of the quest stays on the map
    for (const id of ['gs-find', 'gs-plant', 'gs-plant-b']) expect(document.querySelector(`[data-marker-id="${id}"]`)).not.toBeNull()
  })

  it('without it, the quest opens at its first point', async () => {
    renderMaps('/maps/customs?quest=golden-swag')
    await waitFor(() => expect(pickedPoint()).toHaveTextContent('Комната 303 трёхэтажного общежития'), { timeout: 5000 })
    expect(litObjective()).toHaveTextContent('Найти зажигалку Зиббо')
  })

  it('«Открыть задание» leads to the card on a tab that has the quest, taken or not', async () => {
    renderMaps('/maps/customs?quest=golden-swag')
    await waitFor(() => expect(document.querySelector('.map-quest-sheet-link')).toHaveAttribute('href', '/quests?filter=all&selected=golden-swag'), { timeout: 5000 })
  })

  it('an unknown objective falls back to the first point', async () => {
    renderMaps('/maps/customs?quest=golden-swag&objective=gs-nowhere')
    await waitFor(() => expect(pickedPoint()).toHaveTextContent('Комната 303 трёхэтажного общежития'), { timeout: 5000 })
  })

  it('another point picked afterwards stays picked and the address drops the objective', async () => {
    renderMaps('/maps/customs?quest=golden-swag&objective=gs-plant')
    await waitFor(() => expect(pickedPoint()).toHaveTextContent('Бытовка на стройке'), { timeout: 5000 })
    fireEvent.click(document.querySelector('[data-marker-id="gs-plant-b"]')!)
    await waitFor(() => expect(screen.getByTestId('search').textContent).not.toContain('objective='))
    expect(screen.getByTestId('search')).toHaveTextContent('quest=golden-swag')
    expect(pickedPoint()).toHaveTextContent('Вторая бытовка у забора')
  })
})
