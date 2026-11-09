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
import type { AppDataset, MapMarker, Quest } from '../domain/types'

// Owner, 08.11.2026: «в актуальных квестах только те, которые имеют точку на карте… Все остальные идут в блок устранения».
const OUTPOSTS: Quest = {
  id: 'kill-outposts', name: 'Захват аванпоста', trader: 'Прапор', level: 22, kappa: false, description: '', rewards: [], mapIds: ['customs'],
  objectives: ['Устранить бойцов ЧВК на базах Диких на локации Таможня'], objectiveIds: ['kill-pmc'],
  objectiveDetails: [{
    id: 'kill-pmc', type: 'shoot', description: 'Устранить бойцов ЧВК на базах Диких на локации Таможня', count: 12, mapIds: ['customs'], zoneBound: true,
    zones: [{ mapId: 'customs', position: { x: 200, z: -120 } }], conditions: { targets: [{ key: 'AnyPmc', name: 'любых бойцов ЧВК' }] },
  }],
}
const SETUP: Quest = {
  id: 'kill-setup', name: 'Подстава', trader: 'Лыжник', level: 20, kappa: false, description: '', rewards: [], mapIds: ['customs'],
  objectives: ['Устранить бойцов ЧВК из оружия Диких'], objectiveIds: ['kill-setup'],
  objectiveDetails: [{ id: 'kill-setup', type: 'shoot', description: 'Устранить бойцов ЧВК из оружия Диких', count: 8, mapIds: ['customs'], conditions: { targets: [{ key: 'AnyPmc', name: 'любых бойцов ЧВК' }], wearing: [[{ id: 'ushanka', name: 'Шапка-ушанка' }]] } }],
}
const ZONE: MapMarker = {
  id: 'customs-quest-zone-kill-outposts-prapor_outposts', mapId: 'customs', type: 'quest', layerId: 'quest.zone', title: OUTPOSTS.name, description: '', position: [-120, 200],
  outline: [[-150, 180], [-150, 230], [-100, 230], [-100, 180]], questId: OUTPOSTS.id, objectiveId: 'kill-pmc', source: 'json.tarkov.dev/tasks',
}
const dataset: AppDataset = { ...demoDataset, quests: [...demoDataset.quests, OUTPOSTS, SETUP], markers: [...demoDataset.markers, ZONE] }
// «Проверка» of the demo catalog has points on Customs: it stays in «Актуальные квесты».
const ACTIVE = ['checking', OUTPOSTS.id, SETUP.id]

function renderCustoms() {
  let profile = createLocalProfile('TEST', 'kills')
  for (const taskId of ACTIVE) profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-11-08T10:00:00.000Z' })
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={['/maps/customs']}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Maps page: the right panel without «Устранения» (owner, 10.11.2026)', () => {
  it('lists the quests with points under «Актуальные квесты», the only tab', async () => {
    renderCustoms()
    const tabs = await screen.findByRole('tablist', { name: 'Квесты на карте' })
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: /^Актуальные квесты\s*1$/ })).toHaveAttribute('aria-selected', 'true'))
    expect(within(tabs).queryByRole('tab', { name: /^Устранения/ })).toBeNull()
    const detail = document.querySelector('aside.map-detail') as HTMLElement
    expect(within(detail).getByText('Проверка')).toBeInTheDocument()
  })

  it('«Места устранения» in «Точки на карте» still switches the zones', async () => {
    renderCustoms()
    const layer = await screen.findByRole('button', { name: /^Места устранения\s*1$/ })
    expect(layer).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(layer)
    expect(localStorage.getItem('raidos-map-kill-zones-v1')).toBe('off')
    expect(layer).toHaveAttribute('aria-pressed', 'false')
  })
})
