import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

// The floor a quest point opens (owner, 12.11.2026): one floor → that floor; several floors → the main one; a press on the
// map → the main one again.
const other = demoDataset.quests.find((quest) => quest.id !== 'golden-swag' && !quest.stages)!
const point = (id: string, questId: string, objectiveId: string, position: [number, number], floor?: string): MapMarker => ({
  id, mapId: 'customs', type: 'quest', layerId: 'quest.item', title: id, description: id, position, questId, objectiveId, ...(floor ? { floor } : {}),
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
    ...demoDataset.markers.filter((marker) => marker.questId !== 'golden-swag' && marker.questId !== other.id),
    point('gs-find', 'golden-swag', 'gs-find', [548, 510], '3-й этаж'),
    point('gs-plant', 'golden-swag', 'gs-plant', [470, 690]),
    point('other-one', other.id, 'other-objective', [500, 600], '2-й этаж'),
  ],
}

function renderMaps() {
  let profile = createLocalProfile('TEST', 'quest-floor')
  for (const taskId of ['golden-swag', other.id]) profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-11-12T10:00:00.000Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={['/maps/customs']}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
const floorButton = (name: string) => screen.getByRole('button', { name })
const pressPoint = (id: string) => fireEvent.click(document.querySelector(`[data-marker-id="${id}"]`)!)

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

describe('Maps page: the floor of a quest point', () => {
  it('a quest with its points on one floor opens that floor; a press on the map brings the main floor back', { timeout: 20_000 }, async () => {
    renderMaps()
    await waitFor(() => expect(document.querySelector('[data-marker-id="other-one"]')).not.toBeNull(), { timeout: 5000 })
    expect(floorButton('Основной')).toHaveClass('primary')
    pressPoint('other-one')
    await waitFor(() => expect(floorButton('2-й этаж')).toHaveClass('primary'))
    fireEvent.click(document.querySelector('.leaflet-container')!)
    await waitFor(() => expect(floorButton('Основной')).toHaveClass('primary'))
  })

  it('a quest with points on several floors opens the main floor, even from a point upstairs', { timeout: 20_000 }, async () => {
    renderMaps()
    await waitFor(() => expect(document.querySelector('[data-marker-id="gs-find"]')).not.toBeNull(), { timeout: 5000 })
    fireEvent.click(floorButton('2-й этаж'))
    pressPoint('gs-find')
    await waitFor(() => expect(floorButton('Основной')).toHaveClass('primary'))
  })
})
