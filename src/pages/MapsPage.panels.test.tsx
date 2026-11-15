import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapsPage } from './MapsPage'
import { AppStateProvider } from '../state/AppState'
import { DataProvider } from '../data/DataProvider'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { demoDataset } from '../data/demo'

function renderMaps() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], demoDataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter initialEntries={['/maps/customs']}><Routes><Route path="/maps/:mapId" element={<MapsPage />} /></Routes></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
const shell = () => document.querySelector('.map-shell')!
const eye = (side: 'left' | 'right') => document.querySelector<HTMLButtonElement>(`.map-panel-eye[data-side="${side}"]`)!

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

// Report 158 (owner, 14.11.2026): a gear over the locations for the panels' places, an eye on each panel that hides it and
// stays in place, faint and crossed out, to bring it back.
describe('Maps page: the panels around the map (report 158)', () => {
  it('each eye hides its own panel and stays in place to bring it back; kept on the device', async () => {
    renderMaps()
    await waitFor(() => expect(document.querySelector('.map-panel-eye[data-side="left"]')).not.toBeNull(), { timeout: 5000 })
    expect(eye('left')).toHaveAccessibleName('Скрыть панель')
    fireEvent.click(eye('left'))
    expect(shell()).toHaveClass('left-hidden')
    expect(document.querySelector('.map-sidebar')).toHaveClass('is-hidden')
    expect(eye('left')).toHaveClass('is-off')
    expect(eye('left')).toHaveAccessibleName('Показать панель')
    expect(document.querySelector('.map-detail')).not.toHaveClass('is-hidden')

    fireEvent.click(eye('right'))
    expect(shell()).toHaveClass('right-hidden')
    expect(document.querySelector('.map-detail')).toHaveClass('is-hidden')
    expect(JSON.parse(localStorage.getItem('raidos-map-panels-v1')!)).toEqual({ hidden: ['left', 'right'] })

    fireEvent.click(eye('left'))
    expect(shell()).not.toHaveClass('left-hidden')
    expect(eye('left')).not.toHaveClass('is-off')
    expect(shell()).toHaveClass('right-hidden')
  })

  it('the gear puts the panels above and below the map and back; Esc closes only its menu', async () => {
    renderMaps()
    const gear = await screen.findByRole('button', { name: 'Расположение панелей' }, { timeout: 5000 })
    expect(shell()).not.toHaveClass('is-stacked')
    fireEvent.click(gear)
    expect(screen.getByRole('menuitemradio', { name: 'Слева и справа' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Сверху и снизу' }))
    expect(shell()).toHaveClass('is-stacked')
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Карта на весь экран' }))
    expect(shell()).toHaveClass('is-map-fullscreen')
    fireEvent.click(gear)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(shell()).toHaveClass('is-map-fullscreen')

    fireEvent.click(gear)
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Слева и справа' }))
    expect(shell()).not.toHaveClass('is-stacked')
    expect(JSON.parse(localStorage.getItem('raidos-map-panels-v1')!)).toEqual({ layout: 'side', hidden: [] })
  })

  it('a window taller than wide gets the panels above and below until a layout is chosen', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('portrait'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    renderMaps()
    await screen.findByRole('button', { name: 'Расположение панелей' }, { timeout: 5000 })
    expect(shell()).toHaveClass('is-stacked')
    fireEvent.click(screen.getByRole('button', { name: 'Расположение панелей' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Слева и справа' }))
    expect(shell()).not.toHaveClass('is-stacked')
  })
})
