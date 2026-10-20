import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { demoDataset } from '../data/demo'
import { keyItems, keyMaps, keyMarkers } from '../data/__fixtures__/keyDoorsFixture'

const dataset = { ...demoDataset, maps: keyMaps, markers: [...demoDataset.markers, ...keyMarkers], items: [...demoDataset.items, ...keyItems] }

function Search() {
  return <p data-testid="search">{useLocation().search}</p>
}

function renderMaps(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={[path]}><Routes><Route path="/maps/:mapId" element={<><MapsPage /><Search /></>} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
const marker = (id: string) => document.querySelector(`[data-marker-id="${id}"]`)
const floorButton = (name: string) => screen.getByRole('button', { name })

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Maps page: a key\'s door from «Барахолка» (?lock=)', () => {
  it('opens on the door\'s floor with the door selected and named, though the «Двери» layer is off', async () => {
    renderMaps('/maps/factory?lock=factory-lock-office')
    await waitFor(() => expect(floorButton('2 этаж')).toHaveClass('primary'), { timeout: 5000 })
    await waitFor(() => expect(marker('factory-lock-office')).not.toBeNull())
    expect(marker('factory-lock-office')?.querySelector('.map-marker')).toHaveClass('is-focused')
    // Only the focused door: the layer stays off for the key's other doors.
    expect(marker('factory-lock-gate-3')).toBeNull()
    expect(document.querySelector('.map-marker-detail-card .map-quest-sheet-title')).toHaveTextContent('Дверь · открывает: Ключ от аварийного выхода с завода')
  })

  it('keeps the main level for a door on it; its card closes like any marker card', async () => {
    renderMaps('/maps/customs?lock=customs-lock-dorm-206')
    await waitFor(() => expect(marker('customs-lock-dorm-206')).not.toBeNull(), { timeout: 5000 })
    expect(floorButton('Основной')).toHaveClass('primary')
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть карточку' }))
    expect(document.querySelector('.map-marker-detail-card')).toBeNull()
  })

  it('lets another marker be picked: the door focus moves to it', async () => {
    renderMaps('/maps/customs?lock=customs-lock-dorm-206')
    await waitFor(() => expect(marker('customs-lock-dorm-206')).not.toBeNull(), { timeout: 5000 })
    expect(screen.getByTestId('search')).toHaveTextContent('lock=customs-lock-dorm-206')
    const other = [...document.querySelectorAll<HTMLElement>('[data-marker-id]')].find((node) => !node.dataset.markerId?.includes('lock'))!
    fireEvent.click(other)
    await waitFor(() => expect(screen.getByTestId('search').textContent).not.toContain('lock='))
    expect(document.querySelector('.map-marker-detail-card .map-quest-sheet-title')?.textContent).not.toContain('206')
  })

  it('«Развернуть карту» (PC): the map takes the room of «Квесты на карте» and the same button brings it back, remembered', async () => {
    renderMaps('/maps/customs')
    const expand = await screen.findByRole('button', { name: 'Развернуть карту' }, { timeout: 5000 })
    expect(document.querySelector('.map-shell')).not.toHaveClass('is-map-expanded')
    fireEvent.click(expand)
    expect(document.querySelector('.map-shell')).toHaveClass('is-map-expanded')
    expect(localStorage.getItem('raidos-map-expanded')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть карту' }))
    expect(document.querySelector('.map-shell')).not.toHaveClass('is-map-expanded')
    expect(localStorage.getItem('raidos-map-expanded')).toBe('0')
  })
})
