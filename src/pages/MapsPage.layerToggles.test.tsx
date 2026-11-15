import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { demoDataset } from '../data/demo'
import type { AppDataset, MapMarker } from '../domain/types'

// Owner, 15.11.2026: players say the buttons of «Точки на карте» do not work — «ненужные ключи на карте исчезают, но маркер
// сам, где ты нажимаешь, он не гаснет… Проверить, чтобы каждая кнопка выключалась, гасла и включалась».
const weapon = (id: string, itemId: string, position: [number, number]): MapMarker => ({
  id, mapId: 'customs', type: 'cache', layerId: 'loot.weapon', title: 'Стационарное оружие', description: 'Стационарное вооружение на локации.', position, itemId,
})
const dataset: AppDataset = {
  ...demoDataset,
  markers: [...demoDataset.markers, weapon('customs-stationary-weapon-0', '5cdeb229d7f00c000e7ce174', [500, 520]), weapon('customs-stationary-weapon-1', '5d52cc5ba4b9367408500062', [470, 690])],
}

function renderMaps() {
  localStorage.setItem('tarkov-operations-ui-v2', JSON.stringify({ selectedMapId: 'customs', hiddenMarkerLayers: ['spawn.pmc', 'spawn.scav'], hiddenMarkerTypes: [], hiddenContainerKinds: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], dataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={['/maps/customs']}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.map-side-layers button.layer-button')]
const row = (label: string) => rows().find((button) => button.querySelector('span')?.textContent === label)!
const card = () => document.querySelector('.map-marker-detail-card .map-quest-sheet-title')

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Maps page: «Точки на карте»', () => {
  it('every button goes out on a press and lights up again on the next, the list staying in place', async () => {
    renderMaps()
    await waitFor(() => expect(rows().length).toBeGreaterThan(5))
    const labels = rows().map((button) => button.querySelector('span')?.textContent)
    for (let index = 0; index < labels.length; index += 1) {
      const lit = rows()[index]!.classList.contains('active')
      fireEvent.click(rows()[index]!)
      expect(rows()[index]!.classList.contains('active'), `${labels[index]} after one press`).toBe(!lit)
      fireEvent.click(rows()[index]!)
      expect(rows()[index]!.classList.contains('active'), `${labels[index]} after two presses`).toBe(lit)
    }
    expect(rows().map((button) => button.querySelector('span')?.textContent)).toEqual(labels)
  })

  it('a point pressed on the map loses its card when its layer goes out, and its icon leaves the map', async () => {
    renderMaps()
    await waitFor(() => expect(document.querySelector('[data-marker-id="customs-stationary-weapon-1"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-marker-id="customs-stationary-weapon-1"]')!)
    await waitFor(() => expect(card()).toHaveTextContent('АГС-30'))
    fireEvent.click(row('Станковое оружие'))
    expect(row('Станковое оружие').classList.contains('active')).toBe(false)
    await waitFor(() => expect(card()).toBeNull())
    expect(document.querySelector('[data-marker-id="customs-stationary-weapon-1"]')).toBeNull()
    // back on: the points come back, the card does not open by itself
    fireEvent.click(row('Станковое оружие'))
    await waitFor(() => expect(document.querySelector('[data-marker-id="customs-stationary-weapon-1"]')).not.toBeNull())
    expect(card()).toBeNull()
  })

  it('another layer going out leaves the card open', async () => {
    renderMaps()
    await waitFor(() => expect(document.querySelector('[data-marker-id="customs-stationary-weapon-0"]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-marker-id="customs-stationary-weapon-0"]')!)
    await waitFor(() => expect(card()).toHaveTextContent('Утёс'))
    fireEvent.click(row('Выходы ЧВК'))
    expect(card()).toHaveTextContent('Утёс')
    expect(screen.queryAllByText('Утёс').length).toBeGreaterThan(0)
  })
})
