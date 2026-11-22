import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Map as LeafletMap } from 'leaflet'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { demoDataset } from '../data/demo'
import type { GameMap } from '../domain/types'
import type { PlayerPosition } from '../overlay/screenshotPosition'
import { reloadRemoteFeaturesForTests, setRemoteFeatures } from '../announcement/features'
import { isPlayerFollowOn, setPlayerFollowOn } from '../maps/playerFollow'

/** Factory with two floors, so a screenshot from the tunnels shows its floor (data/useAutoFloor.ts). */
const factory: GameMap = {
  ...demoDataset.maps.find((map) => map.id === 'factory')!,
  floors: ['Основной', 'Тоннели'],
  layers: [
    { id: 'main', name: 'Основной', svgLayer: 'Ground_Floor', heightRange: [-1, 3], ownTiles: true },
    { id: 'layer-2', name: 'Тоннели', svgLayer: 'Basement', extents: [{ height: [-10000, -1] }] },
  ],
}
const dataset = { ...demoDataset, maps: demoDataset.maps.map((map) => (map.id === 'factory' ? factory : map)) }

let screenshot: (position: PlayerPosition) => void = () => {}
const shot = (y: number, at: number, x = 10, z = 10): PlayerPosition => ({ x, y, z, yaw: 0, at })

function renderMaps() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={['/maps/factory']}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
const floorButton = (name: string) => screen.getByRole('button', { name })
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  // The PC app in a Factory raid since t=1; no screenshot yet.
  window.tarkovDesktop = {
    getRaidState: async () => ({ inRaid: true, location: 'factory4', since: 1 }),
    onRaidStateChanged: () => () => {},
    serviceRequest: async () => null,
    experimental: {
      getStatus: async () => ({ lastPosition: null }),
      getSettings: async () => ({ playerMarker: 'dot' }),
      onPosition: (callback: (position: PlayerPosition) => void) => { screenshot = callback; return () => {} },
    },
  } as unknown as NonNullable<Window['tarkovDesktop']>
  setRemoteFeatures({ minimap: true, minimapChangedAt: '' })
})
afterEach(() => { delete window.tarkovDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); reloadRemoteFeaturesForTests() })

describe('«Настройки карты» → «Приближать карту к точке» (owner, 20.11.2026)', () => {
  it('the PC app: the gear shows the switch, on by default, and turns it off', async () => {
    renderMaps()
    fireEvent.click(await screen.findByRole('button', { name: 'Настройки карты' }, { timeout: 5000 }))
    const toggle = screen.getByRole('switch', { name: 'Приближать карту к точке' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(isPlayerFollowOn()).toBe(false)
  })

  it('on: a screenshot brings the map to the dot', async () => {
    renderMaps()
    await waitFor(() => expect(floorButton('Основной')).toHaveClass('primary'), { timeout: 5000 })
    await settle()
    const setView = vi.spyOn(LeafletMap.prototype, 'setView')
    act(() => screenshot(shot(-2, 2000, 40, 30)))
    await waitFor(() => expect(floorButton('Тоннели')).toHaveClass('primary'), { timeout: 5000 })
    expect(document.querySelector('.live-player')).not.toBeNull()
    expect(setView.mock.calls.some(([center]) => center && typeof center === 'object' && 'lat' in center && center.lat === 30 && center.lng === 40)).toBe(true)
  })

  it('off: a screenshot draws the dot and shows its floor, the map keeps its zoom and place', async () => {
    setPlayerFollowOn(false)
    renderMaps()
    await waitFor(() => expect(floorButton('Основной')).toHaveClass('primary'), { timeout: 5000 })
    await settle()
    const setView = vi.spyOn(LeafletMap.prototype, 'setView')
    const panTo = vi.spyOn(LeafletMap.prototype, 'panTo')
    const flyTo = vi.spyOn(LeafletMap.prototype, 'flyTo')
    act(() => screenshot(shot(-2, 2000, 40, 30)))
    await waitFor(() => expect(floorButton('Тоннели')).toHaveClass('primary'), { timeout: 5000 })
    expect(document.querySelector('.live-player')).not.toBeNull()
    act(() => screenshot(shot(-2, 3000, 90, 80)))
    await settle()
    expect(setView).not.toHaveBeenCalled()
    expect(panTo).not.toHaveBeenCalled()
    expect(flyTo).not.toHaveBeenCalled()
  })
})
