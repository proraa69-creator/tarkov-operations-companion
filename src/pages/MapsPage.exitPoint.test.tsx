import { render, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDataset, Quest } from '../domain/types'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { demoDataset } from '../data/demo'
import { createLocalProfile, setTaskProgress } from '../domain/progress'

// Owner, 20.11.2026: «При нажатии на него должен подсвечиваться выход на карте» — the flare row of «Требования рейда» opens the
// map with the exit it opens lit (?point=<marker id>), as a key's door is (?lock=).
const EXIT = 'customs-extract-rail'
const ceasefire: Quest = {
  id: 'ceasefire', name: 'Прекратить огонь!', trader: 'Егерь', mapId: 'customs', mapIds: ['customs'], level: 10, kappa: false, description: '', objectives: [], rewards: [],
  objectiveDetails: [{ id: 'cf-exit', type: 'extract', description: 'Выйти через ЖД проход', count: 1, mapIds: ['customs'] }],
}
const dataset: AppDataset = {
  ...demoDataset,
  quests: [...demoDataset.quests, ceasefire],
  markers: [...demoDataset.markers, { id: EXIT, mapId: 'customs', type: 'extract', layerId: 'extract.pmc', extractFaction: 'pmc', extractId: 'rail', title: 'Проход через ЖД пути (Сигнал)', description: '', position: [300, 300] }],
}

function renderMaps(path: string) {
  let profile = createLocalProfile('TEST', 'maps')
  profile = setTaskProgress(profile, 'pvp', { taskId: 'ceasefire', status: 'active', source: 'eft-log', updatedAt: '2026-11-20T10:00:00.000Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={[path]}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
const marker = (id: string) => document.querySelector(`[data-marker-id="${id}"]`)
const cardTitle = () => document.querySelector('.map-marker-detail-card .map-quest-sheet-title')

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Maps page: the exit of a flare from «Требования рейда» (?point=)', () => {
  it('lights the exit and opens its card', async () => {
    renderMaps(`/maps/customs?point=${EXIT}`)
    await waitFor(() => expect(marker(EXIT)).not.toBeNull(), { timeout: 5000 })
    expect(marker(EXIT)?.querySelector('.map-marker')).toHaveClass('is-focused')
    await waitFor(() => expect(cardTitle()).toHaveTextContent('Проход через ЖД пути (Сигнал)'))
  })

  it('«Прекратить огонь!» with no point of its own: the quest opens and the exit is the one lit', async () => {
    renderMaps(`/maps/customs?quest=ceasefire&point=${EXIT}`)
    await waitFor(() => expect(marker(EXIT)).not.toBeNull(), { timeout: 5000 })
    expect(marker(EXIT)?.querySelector('.map-marker')).toHaveClass('is-focused')
    await waitFor(() => expect(cardTitle()).toHaveTextContent('Проход через ЖД пути (Сигнал)'))
  })
})
