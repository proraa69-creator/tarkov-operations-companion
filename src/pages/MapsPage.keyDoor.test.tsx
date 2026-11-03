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

  // Owner, 01.11.2026: the whole app window, menus hidden, locations on the left and quests on the right kept; Esc or «Назад».
  it('«Карта на весь экран» (PC): the map fills the window with both side panels, Esc or «Назад» brings the app back', async () => {
    renderMaps('/maps/customs')
    expect(document.documentElement).toHaveAttribute('data-map-page')
    const expand = await screen.findByRole('button', { name: 'Карта на весь экран' }, { timeout: 5000 })
    fireEvent.click(expand)
    expect(document.querySelector('.map-shell')).toHaveClass('is-map-fullscreen')
    expect(document.documentElement).toHaveAttribute('data-map-fullscreen-pc')
    expect(document.querySelector('.map-shell .map-sidebar')).not.toBeNull()
    expect(document.querySelector('.map-shell .map-detail')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.map-shell')).not.toHaveClass('is-map-fullscreen'))
    expect(document.documentElement).not.toHaveAttribute('data-map-fullscreen-pc')
    fireEvent.click(screen.getByRole('button', { name: 'Карта на весь экран' }))
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(document.querySelector('.map-shell')).not.toHaveClass('is-map-fullscreen')
  })

  it('phone: «Карта на весь экран» covers the screen, the same button or Escape brings the page back', async () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    try {
      const view = renderMaps('/maps/customs')
      const full = await screen.findByRole('button', { name: 'Карта на весь экран' }, { timeout: 5000 })
      const stage = document.querySelector('.map-stage')
      expect(stage).not.toHaveClass('is-fullscreen')
      expect(document.querySelector('.map-scroll-rail')).toHaveTextContent('Листать')
      fireEvent.click(full)
      expect(stage).toHaveClass('is-fullscreen')
      expect(document.documentElement).toHaveAttribute('data-map-fullscreen')
      expect(document.querySelector('.map-scroll-rail')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Свернуть карту' }))
      expect(stage).not.toHaveClass('is-fullscreen')
      expect(document.documentElement).not.toHaveAttribute('data-map-fullscreen')
      fireEvent.click(screen.getByRole('button', { name: 'Карта на весь экран' }))
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(stage).not.toHaveClass('is-fullscreen')
      // Leaving the page in full screen leaves no trace on the next page.
      fireEvent.click(screen.getByRole('button', { name: 'Карта на весь экран' }))
      view.unmount()
      expect(document.documentElement).not.toHaveAttribute('data-map-fullscreen')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    }
  })
})
