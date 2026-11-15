import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { demoDataset } from '../data/demo'

let path = ''
function Where() {
  path = useLocation().pathname
  return null
}

function renderMaps(at: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], demoDataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={[at]}><Routes><Route path="/maps/:mapId" element={<><MapsPage /><Where /></>} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
const option = (name: string) => screen.getAllByRole('button', { name }).find((button) => button.classList.contains('map-option'))!

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear() })

// Owner, 15.11.2026: «общая карта должна называться все локации… просто в этом же окне, ничего не меняя, должна включиться вся
// локация Таркова»; «нажимаю, например, резерв, и у меня включается карта резерва».
describe('«Все локации» on «Карты»', () => {
  it('stands under the locations and opens the whole region in the same page, the locations list staying', async () => {
    renderMaps('/maps/customs')
    expect(option('Таможня')).toHaveClass('active')
    expect(screen.queryByRole('button', { name: 'Общая карта' })).toBeNull()
    await act(async () => { fireEvent.click(option('Все локации')) })
    expect(path).toBe('/maps/world')
    expect(option('Все локации')).toHaveClass('active')
    expect(option('Таможня')).not.toHaveClass('active')
    expect(document.querySelector('.world-map-view')).not.toBeNull()
    expect(document.querySelector('.map-hud')).toHaveTextContent('ВСЕ ЛОКАЦИИ')
    // the same page: «Точки на карте» are still there
    expect(screen.getByText('ТОЧКИ НА КАРТЕ')).toBeInTheDocument()
  })

  it('a location picked there is flown to, then its own map opens', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderMaps('/maps/world')
    // (jsdom has no animation: the flight ends at once)
    await act(async () => { fireEvent.click(option('Резерв')) })
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(path).toBe('/maps/reserve')
    expect(option('Резерв')).toHaveClass('active')
    expect(document.querySelector('.world-map-view')).toBeNull()
  })
})
