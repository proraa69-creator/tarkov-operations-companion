import { fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { demoDataset } from '../data/demo'
import type { AppDataset, MapMarker } from '../domain/types'

// Report №89; owner, 07.11.2026: «Радиус охвата стрельбы должен быть по нажатию кнопки. То есть нажал на какой-либо станочное
// оружие, там показывается радиус».
const weapon = (id: string, itemId: string, position: [number, number]): MapMarker => ({
  id, mapId: 'customs', type: 'cache', layerId: 'loot.weapon', title: 'Стационарное оружие', description: 'Стационарное вооружение на локации.', position, itemId,
})
const dataset: AppDataset = {
  ...demoDataset,
  markers: [...demoDataset.markers, weapon('customs-stationary-weapon-0', '5cdeb229d7f00c000e7ce174', [500, 520]), weapon('customs-stationary-weapon-1', '5d52cc5ba4b9367408500062', [470, 690])],
}

function renderMaps() {
  // the layer on, as the player turns it on in the map's layers
  localStorage.setItem('tarkov-operations-ui-v2', JSON.stringify({ selectedMapId: 'customs', hiddenMarkerLayers: ['spawn.pmc', 'spawn.scav'], hiddenMarkerTypes: [], hiddenContainerKinds: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={['/maps/customs']}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
// the rings' distances (markers); jsdom draws no SVG circles for Leaflet, the browser check covers those
const zones = () => document.querySelectorAll('.stationary-weapon-label span')

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Maps page: stationary weapons (report №89)', () => {
  it('draws each weapon with its own silhouette and name, and no zone until one is pressed', async () => {
    renderMaps()
    await waitFor(() => expect(document.querySelectorAll('.map-marker.is-stationary-weapon')).toHaveLength(2))
    expect([...document.querySelectorAll('.map-marker.is-stationary-weapon .map-marker-name')].map((node) => node.textContent)).toEqual(['Утёс', 'АГС-30'])
    expect(zones()).toHaveLength(0)
  })

  it('shows the zone of the weapon pressed, 100, 200 and 300 m, and hides it with its card', async () => {
    renderMaps()
    await waitFor(() => expect(document.querySelector('[data-marker-id="customs-stationary-weapon-1"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-marker-id="customs-stationary-weapon-1"]')!)
    await waitFor(() => expect(zones()).toHaveLength(3))
    expect([...zones()].map((node) => node.textContent)).toEqual(['100 м', '200 м', '300 м'])
    expect(document.querySelector('.map-marker-detail-card .map-quest-sheet-title')).toHaveTextContent('АГС-30')
    fireEvent.click(document.querySelector('.map-marker-detail-close')!)
    await waitFor(() => expect(zones()).toHaveLength(0))
  })
})
