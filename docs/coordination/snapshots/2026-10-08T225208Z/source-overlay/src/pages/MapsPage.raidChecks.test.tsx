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
