import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDataset } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { AppStateProvider } from '../state/AppState'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { KEY_DOORS_CLOSE_DELAY_MS } from '../components/KeyDoorsButton'
import { DORM_KEY_ID, keyItems, keyMaps, keyMarkers, NO_DOOR_KEY_ID } from '../data/__fixtures__/keyDoorsFixture'
import { FleaMarketPage } from './FleaMarketPage'

const dataset: AppDataset = {
  ...demoDataset,
  maps: keyMaps,
  markers: keyMarkers,
  items: keyItems,
  metadata: { source: 'json.tarkov.dev', mode: 'pvp', loadedAt: '2026-10-15T00:00:00.000Z', counts: {} },
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname}{location.search}</p>
}

function renderFlea(path = '/flea?tab=keys', data: AppDataset = dataset) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], data)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/flea" element={<FleaMarketPage />} />
    <Route path="/maps/:mapId" element={<Where />} />
  </Routes></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!
const popup = () => document.querySelector('.key-doors-popup')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('«Барахолка»: the door of a key on the map', () => {
  it('gives a key with one door a geolocation link to the map focused on it', async () => {
    renderFlea()
    const link = rowOf('Ключ от комнаты 206 общежития').querySelector<HTMLAnchorElement>('a.key-doors-button')!
    expect(link).toHaveAttribute('href', '/maps/customs?lock=customs-lock-dorm-206')
    expect(link).toHaveAttribute('aria-label', 'Показать дверь на карте · Таможня · Ключ от комнаты 206 общежития')
    fireEvent.mouseEnter(link)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Показать дверь на карте · Таможня')
    fireEvent.click(link)
    expect(screen.getByTestId('where')).toHaveTextContent('/maps/customs?lock=customs-lock-dorm-206')
  })

  it('gives a key without a known door a disabled button that says so', async () => {
    renderFlea()
    const button = rowOf('Ключ от комнаты 314 (Тестовый)').querySelector('button.key-doors-button')!
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-label', 'Дверь не отмечена на карте')
    expect(rowOf('Ключ от комнаты 314 (Тестовый)').querySelector('a.key-doors-button')).toBeNull()
    fireEvent.mouseEnter(button.parentElement!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Дверь не отмечена на карте')
  })

  it('shows «Несколько дверей · N» that opens its list on hover, stays open while the pointer moves into it, and opens the door picked', () => {
    vi.useFakeTimers()
    renderFlea()
    const button = rowOf('Ключ от аварийного выхода с завода').querySelector<HTMLButtonElement>('button.key-doors-button')!
    expect(button).toHaveTextContent('Несколько дверей · 4')
    // The button itself goes nowhere.
    expect(button.tagName).toBe('BUTTON')
    expect(popup()).toBeNull()
    fireEvent.mouseEnter(button)
    expect(popup()).not.toBeNull()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    // Leaving the button for the list: the list stays.
    fireEvent.mouseLeave(button)
    act(() => { vi.advanceTimersByTime(KEY_DOORS_CLOSE_DELAY_MS / 2) })
    fireEvent.mouseEnter(popup()!)
    act(() => { vi.advanceTimersByTime(KEY_DOORS_CLOSE_DELAY_MS * 3) })
    expect(popup()).not.toBeNull()
    const rows = [...popup()!.querySelectorAll('a.key-doors-row')]
    expect(rows.map((row) => row.textContent)).toEqual(['ЗаводДверь 1', 'ЗаводДверь 2', 'ЗаводДверь 3 · 2 этаж', 'МаякДверь машины'])
    expect(rows[2]).toHaveAttribute('href', '/maps/factory?lock=factory-lock-office')
    // Leaving the list closes it after the delay.
    fireEvent.mouseLeave(popup()!)
    act(() => { vi.advanceTimersByTime(KEY_DOORS_CLOSE_DELAY_MS + 10) })
    expect(popup()).toBeNull()
    // Picking a door opens the map on it.
    fireEvent.mouseEnter(button)
    fireEvent.click(popup()!.querySelectorAll('a.key-doors-row')[2]!)
    expect(screen.getByTestId('where')).toHaveTextContent('/maps/factory?lock=factory-lock-office')
  })

  it('toggles the list with a tap on a touch screen and closes it on an outside tap and on Escape', () => {
    renderFlea()
    const button = rowOf('Ключ от аварийного выхода с завода').querySelector<HTMLButtonElement>('button.key-doors-button')!
    const tap = () => { fireEvent.touchStart(button); fireEvent.mouseEnter(button); fireEvent.click(button, { detail: 1 }) }
    tap()
    expect(popup()).not.toBeNull()
    tap()
    expect(popup()).toBeNull()
    tap()
    expect(popup()).not.toBeNull()
    fireEvent.mouseDown(document.body)
    expect(popup()).toBeNull()
    tap()
    expect(popup()).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(popup()).toBeNull()
  })

  it('covers keycards: a card with doors on two maps lists both', () => {
    renderFlea()
    const button = rowOf('Ключ-карта склада TerraGroup').querySelector<HTMLButtonElement>('button.key-doors-button')!
    expect(button).toHaveTextContent('Несколько дверей · 2')
    fireEvent.mouseEnter(button)
    expect([...popup()!.querySelectorAll('a.key-doors-row')].map((row) => row.textContent)).toEqual(['ТаможняДверь машины', 'ЗаводДверь · Тоннели'])
    const red = rowOf('Ключ-карта TerraGroup Labs (Красная)').querySelector('a.key-doors-button')!
    expect(red).toHaveAttribute('href', '/maps/the-lab?lock=the-lab-lock-red')
  })

  it('shows the same buttons in the item card', () => {
    renderFlea(`/flea?tab=keys&selected=${DORM_KEY_ID}`)
    const detail = document.querySelector('.flea-detail')!
    expect(detail.querySelector('a.key-doors-button')).toHaveAttribute('href', '/maps/customs?lock=customs-lock-dorm-206')
    expect(detail.querySelector('a.key-doors-button')).toHaveTextContent('Показать дверь на карте')
  })

  it('shows «N doors» and the other texts in English', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    renderFlea(`/flea?tab=keys&selected=${NO_DOOR_KEY_ID}`)
    // Item names are translated in English; the buttons name their key in aria-label.
    const forKey = (name: string) => document.querySelector<HTMLElement>(`.price-table [aria-label$="· ${name}"]`)!
    expect(forKey('Ключ от аварийного выхода с завода')).toHaveTextContent('4 doors')
    expect(forKey('Ключ от комнаты 206 общежития')).toHaveAttribute('aria-label', expect.stringMatching(/^Show the door on the map · /))
    expect(document.querySelector('.flea-detail button.key-doors-button')).toHaveTextContent('Door is not marked on the map')
    expect(document.querySelector('.flea-detail .key-doors-detail h4')).toHaveTextContent('Door on the map')
    fireEvent.mouseEnter(forKey('Ключ-карта склада TerraGroup'))
    expect(popup()).toHaveTextContent('Opens')
    expect(popup()).toHaveTextContent('Car door')
  })

  it('gives keys and keycards a door button and other items none', () => {
    renderFlea('/flea')
    expect(document.querySelectorAll('.price-table .key-doors-button').length).toBe(keyItems.length)
    expect(rowOf('Ключ-карта TerraGroup Labs (Красная)').querySelector('.key-doors-button')).not.toBeNull()
  })

  it('gives non-key items no door button', () => {
    const barter = { id: 'intel', name: 'Папка с разведданными', shortName: 'Intel', category: 'Бартер' as const, description: '', prices: [] }
    renderFlea('/flea', { ...dataset, items: [barter] })
    expect(rowOf('Папка с разведданными').querySelector('.key-doors-button')).toBeNull()
  })
})
