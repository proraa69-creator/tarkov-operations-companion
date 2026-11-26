import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataProvider } from '../data/DataProvider'
import { demoDataset } from '../data/demo'
import { LocaleProvider } from '../i18n/LocaleProvider'
import type { RaidState } from '../import/raidState'
import { AppStateProvider } from '../state/AppState'
import { InfoStatCard } from './InfoStatCard'
import { formatClock, raidTimer, readInfoCardDocuments, readInfoCardView, rememberLastRaid, setInfoCardDocuments, setInfoCardView, tarkovClocks } from './infoCardClock'

const HOUR = 60 * 60 * 1000
const listeners = new Set<(state: RaidState) => void>()

function renderCard(phone = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], demoDataset)
  return render(
    <LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider>
      <MemoryRouter><InfoStatCard phone={phone} /></MemoryRouter>
    </DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>,
  )
}
const gear = () => screen.getByRole('button', { name: 'Что показывать' })

beforeEach(() => {
  localStorage.clear()
  listeners.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})
afterEach(() => { delete window.tarkovDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

// Owner, 15.11.2026: «кнопка маленькая, квадратная, настроек. И там можно выбрать время в Таркове, сбросов торговцев, таймер рейда…
// А пресеты оттуда убери… на телефоне оставь еще на выбор пресетов».
describe('the Overview\'s first block', () => {
  it('time in Tarkov: seven times as fast, the second clock twelve hours on, night from 22:00 to 5:00', () => {
    const [left, right] = tarkovClocks(0)
    expect(formatClock(left)).toBe('03:00')
    expect(formatClock(right)).toBe('15:00')
    expect(left.night).toBe(true)
    expect(right.night).toBe(false)
    // 2 tarkov hours to 05:00 = 2/7 of a real hour
    expect(left.untilChange).toBe(Math.ceil(2 * HOUR / 7))
    expect(formatClock(tarkovClocks(HOUR)[0])).toBe('10:00')
  })

  it('the raid timer: since it began and what is left of the map time', () => {
    expect(raidTimer(1000, 40, 1000 + 10 * 60_000)).toEqual({ elapsed: 10 * 60_000, left: 30 * 60_000 })
    expect(raidTimer(1000, undefined, 61_000)).toEqual({ elapsed: 60_000 })
  })

  it('the PC shows the time in Tarkov first and offers no presets; the phone keeps its presets', () => {
    expect(readInfoCardView(false)).toBe('tarkov-time')
    expect(readInfoCardView(true)).toBe('screen')
    setInfoCardView('screen')
    expect(readInfoCardView(false)).toBe('tarkov-time')
    renderCard()
    expect(screen.getByText('Время в Таркове')).toBeInTheDocument()
    fireEvent.click(gear())
    const items = screen.getAllByRole('menuitemradio').map((item) => item.textContent)
    expect(items).toEqual(['Время в Таркове', 'Сброс торговцев', 'Таймер рейда'])
  })

  it('the gear switches the block, and the choice stays', () => {
    renderCard()
    fireEvent.click(gear())
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Таймер рейда' }))
    expect(screen.getByText('Рейд не идёт')).toBeInTheDocument()
    expect(readInfoCardView(false)).toBe('raid-timer')
  })

  it('the raid timer on the PC: the raid running on its map, else the raid before', async () => {
    setInfoCardView('raid-timer')
    rememberLastRaid({ location: 'bigmap', began: Date.now() - 2 * HOUR, ended: Date.now() - 2 * HOUR + 34 * 60_000 })
    window.tarkovDesktop = {
      getRaidState: async () => ({ inRaid: false, tracked: true }),
      onRaidStateChanged: (callback: (state: RaidState) => void) => { listeners.add(callback); return () => { listeners.delete(callback) } },
    } as unknown as NonNullable<Window['tarkovDesktop']>
    renderCard()
    expect(await screen.findByText(/Прошлый рейд/)).toHaveTextContent('Таможня · 34 мин')
    await waitFor(() => expect(listeners.size).toBeGreaterThan(0))
    await act(async () => { for (const listener of listeners) listener({ inRaid: true, since: Date.now() - 3 * 60_000, begun: Date.now() - 2 * 60_000, location: 'bigmap', tracked: true }) })
    expect(document.querySelector('.info-raid-map')).toHaveTextContent('Таможня')
    // about two minutes (the card's clock ticks once a second)
    expect(document.querySelector('.info-raid-elapsed')?.textContent).toMatch(/^(1:5\d|2:0\d)$/)
  })

  // Owner, 25.11.2026: «если рейд начался, прошлый рейд, надпись с картой и временем перемещается ниже, а между временем в Таркове
  // и прошлым рейдом появляется надпись „Сколько осталось времени до конца текущего рейда“».
  it('time in Tarkov in a raid: what is left of it, and the raid before a line below', async () => {
    setInfoCardView('tarkov-time')
    rememberLastRaid({ location: 'bigmap', began: Date.now() - 2 * HOUR, ended: Date.now() - 2 * HOUR + 34 * 60_000 })
    window.tarkovDesktop = {
      getRaidState: async () => ({ inRaid: false, tracked: true }),
      onRaidStateChanged: (callback: (state: RaidState) => void) => { listeners.add(callback); return () => { listeners.delete(callback) } },
    } as unknown as NonNullable<Window['tarkovDesktop']>
    renderCard()
    const lines = () => [...document.querySelectorAll('.info-tarkov-time .info-line')]
    expect(await screen.findByText(/Прошлый рейд/)).toHaveTextContent('Прошлый рейд · Таможня')
    expect(lines().map((line) => line.className)).toEqual(['info-line is-last'])
    await waitFor(() => expect(listeners.size).toBeGreaterThan(0))
    await act(async () => { for (const listener of listeners) listener({ inRaid: true, since: Date.now() - 3 * 60_000, begun: Date.now() - 2 * 60_000, location: 'bigmap', tracked: true }) })
    expect(lines().map((line) => line.className)).toEqual(['info-line is-raid', 'info-line is-last'])
    const [raid, before] = lines()
    expect(raid).toHaveTextContent('До конца рейда')
    expect(raid).toHaveAttribute('title', 'Сколько осталось времени до конца текущего рейда · Таможня')
    // Customs is 35 minutes: about 33 left (the card's clock ticks once a second)
    expect(raid!.querySelector('strong')?.textContent).toMatch(/^(32:5\d|33:0\d)$/)
    expect(before).toHaveTextContent('Прошлый рейд · Таможня')
    expect(before).toHaveTextContent('34 мин')
    // Still loading: the time since it began, not a countdown
    await act(async () => { for (const listener of listeners) listener({ inRaid: true, since: Date.now() - 60_000, location: 'bigmap', tracked: true }) })
    expect(lines()[0]).toHaveTextContent('Загрузка рейда')
  })

  it('the phone offers its presets too', () => {
    setInfoCardView('tarkov-time')
    renderCard(true)
    fireEvent.click(gear())
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toContain('Пресеты экрана')
  })
})

// Owner, 27.11.2026: «сделай нам такой счетчик в блоке «Время в Таркове». У нас будет время в Таркове, потом счетчик. Вернее, это будет
// добавляться в настройках, что показывать. И можно ставить несколько предметов… Нажимаешь боевой пропуск, и вылезает собранные
// документы, и ставишь плюсик или минус, и добавляешь, сколько собрано. Там 1 из 40, 10 из 40».
describe('«Боевой пропуск» in the first block of the Overview', () => {
  const line = () => document.querySelector('.info-line.is-documents') as HTMLElement | null
  const shown = () => line()?.querySelector('strong')?.textContent
  const less = () => screen.getByRole('button', { name: 'Документом меньше' })
  const more = () => screen.getByRole('button', { name: 'Документом больше' })

  it('ticked in the gear, the documents of today come right under the time, «+» and «−» counting them', () => {
    renderCard()
    expect(line()).toBeNull()
    fireEvent.click(gear())
    const item = screen.getByRole('menuitemcheckbox', { name: 'Боевой пропуск' })
    expect(item).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(item)
    expect(readInfoCardDocuments()).toBe(true)
    expect(document.querySelector('.info-tarkov-time .info-lines')?.firstElementChild).toBe(line())
    expect(line()).toHaveTextContent('Документы')
    // PvP: 25 a day (Season 40, PvE 15)
    expect(shown()).toBe('0 из 25')
    expect(less()).toBeDisabled()
    fireEvent.click(more())
    fireEvent.click(more())
    expect(shown()).toBe('2 из 25')
    expect(line()?.getAttribute('title')).toMatch(/^Документы боевого пропуска · Лимит обновится через (23|24) ч/)
    fireEvent.click(less())
    expect(shown()).toBe('1 из 25')
    // the raid timer shown instead: the documents stay, under it
    fireEvent.click(gear())
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Таймер рейда' }))
    expect(document.querySelector('.info-raid .info-line.is-documents strong')?.textContent).toBe('1 из 25')
    fireEvent.click(gear())
    expect(screen.getByRole('menuitemcheckbox', { name: 'Боевой пропуск' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Боевой пропуск' }))
    expect(line()).toBeNull()
  })

  it('at the limit of the mode «+» stops and the count turns red', () => {
    setInfoCardDocuments(true)
    renderCard()
    for (let index = 0; index < 25; index++) fireEvent.click(more())
    expect(shown()).toBe('25 из 25')
    expect(more()).toBeDisabled()
    expect(line()).toHaveClass('is-full')
    expect(line()?.getAttribute('title')).toMatch(/^Дневной лимит документов исчерпан · /)
  })
})
