import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { demoDataset } from '../data/demo'
import { PLAYER_FLOOR_HINT } from '../data/useAutoFloor'
import type { GameMap } from '../domain/types'
import type { PlayerPosition } from '../overlay/screenshotPosition'

/** Factory with the floors and heights of the live catalog (tarkov.dev maps.json). */
const factory: GameMap = {
  ...demoDataset.maps.find((map) => map.id === 'factory')!,
  floors: ['Основной', '2 этаж', '3 этаж', 'Тоннели'],
  layers: [
    { id: 'main', name: 'Основной', svgLayer: 'Ground_Floor', heightRange: [-1, 3], ownTiles: true },
    { id: 'layer-0', name: '2 этаж', svgLayer: 'Second_Floor', extents: [{ height: [3, 6] }] },
    { id: 'layer-1', name: '3 этаж', svgLayer: 'Third_Floor', extents: [{ height: [6, 10000] }] },
    { id: 'layer-2', name: 'Тоннели', svgLayer: 'Basement', extents: [{ height: [-10000, -1] }] },
  ],
}
const dataset = { ...demoDataset, maps: demoDataset.maps.map((map) => (map.id === 'factory' ? factory : map)) }

let screenshot: (position: PlayerPosition) => void = () => {}
const shot = (y: number, at: number): PlayerPosition => ({ x: 10, y, z: 10, yaw: 0, at })

function renderMaps(mapId = 'factory') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={[`/maps/${mapId}`]}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
const floorButton = (name: string) => screen.getByRole('button', { name })

beforeEach(() => {
  localStorage.clear()
  // No network in tests: the map scheme (and anything else) fails to load and the page keeps going.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  // In a raid on Factory since t=1; the app remembers the last screenshot (2nd floor).
  window.tarkovDesktop = {
    getRaidState: async () => ({ inRaid: true, location: 'factory4', since: 1 }),
    onRaidStateChanged: () => () => {},
    serviceRequest: async () => null,
    experimental: {
      getStatus: async () => ({ lastPosition: shot(4, 1000) }),
      getSettings: async () => ({ playerMarker: 'arrow' }),
      onPosition: (callback: (position: PlayerPosition) => void) => { screenshot = callback; return () => {} },
    },
  } as unknown as NonNullable<Window['tarkovDesktop']>
})
afterEach(() => { delete window.tarkovDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Maps page: the floor from the screenshot', () => {
  it('opens on the player\'s floor and keeps a floor picked by hand until the next screenshot', async () => {
    renderMaps()
    await waitFor(() => expect(floorButton('2 этаж')).toHaveClass('primary'))
    expect(floorButton('2 этаж')).toHaveAttribute('title', PLAYER_FLOOR_HINT)
    fireEvent.click(floorButton('3 этаж'))
    expect(floorButton('3 этаж')).toHaveClass('primary')
    // The same screenshot reported again changes nothing.
    act(() => screenshot(shot(4, 1000)))
    expect(floorButton('3 этаж')).toHaveClass('primary')
    // A new screenshot from the tunnels switches the floor.
    act(() => screenshot(shot(-2, 2000)))
    expect(floorButton('Тоннели')).toHaveClass('primary')
    expect(floorButton('Тоннели')).toHaveAttribute('title', PLAYER_FLOOR_HINT)
  })

  it('shows the player\'s floor when the raid map is opened from another map', async () => {
    renderMaps('customs')
    // Customs is not the raid map: its floors are left alone (the position is known by now).
    await waitFor(() => expect(floorButton('Основной')).toHaveClass('primary'))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(floorButton('Основной')).toHaveClass('primary')
    // Opening Factory resets the floor to the main level and, in the same update, applies the player's floor.
    fireEvent.click(screen.getByRole('button', { name: factory.name }))
    await waitFor(() => expect(floorButton('2 этаж')).toHaveClass('primary'))
  })
})
