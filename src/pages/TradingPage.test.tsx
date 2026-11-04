import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Item, RaidMode } from '../domain/types'
import { askForNet, floorForAsk, type TradingRow, type TradingSnapshot } from '../domain/trading'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { readPositions, savePosition } from '../trading/tradingPositions'
import { readTradingSettings } from '../trading/tradingSettings'
import { TradingNotifier } from '../trading/TradingNotifier'
import { TradingPage } from './TradingPage'

const row = (id: string, level = 0, patch: Partial<TradingRow> = {}): TradingRow => ({
  id, base: 100_000, level, slots: 1, kind: 'barter',
  w7: { min: 50_000, max: 150_000, p10: 60_000, p50: 100_000, p90: 140_000, offers: 20, scans: 84 },
  w3: { min: 55_000, max: 120_000, p10: 60_000, p50: 90_000, p90: 110_000, offers: 18, scans: 36 },
  buyBelow: 60_000, sellAbove: 130_000,
  backtest: { signals: 10, wins: 9, avgProfit: 20_000, medianProfit: 21_000, medianHours: 10 },
  traderShare: 0, trend: 0, series: [100_000, 60_000, 130_000, 90_000], seriesFrom: Date.now() - 8 * 3_600_000, seriesAt: [0, 120, 240, 360], ...patch,
})
const item = (id: string, name: string, flea: number, mode: RaidMode = 'pvp', trader?: number): Item => ({
  id, name, shortName: name, category: 'Бартер', description: '', iconUrl: `https://assets.tarkov.dev/${id}-icon.webp`,
  prices: [{ source: 'Барахолка', kind: 'flea' as const, mode, price: flea, updatedAt: '' }, ...(trader ? [{ source: 'Терапевт', kind: 'trader' as const, mode, price: trader, updatedAt: '' }] : [])],
} as Item)

const state = vi.hoisted(() => ({
  mode: 'pvp' as RaidMode,
  level: 30,
  items: [] as unknown[],
  snapshot: null as unknown,
  raid: null as unknown,
  source: 'live' as string,
  notify: vi.fn(async () => true),
  statsEnabled: [] as boolean[],
}))
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ source: state.source, data: { items: state.items, hideout: [], metadata: { mode: state.mode } } }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: state.mode, activeProfile: { modes: { [state.mode]: { playerLevel: state.level, hideoutLevels: {} } } } }) }))
vi.mock('../data/livePrices', () => ({ useLivePrices: () => null, withLivePrice: (entry: unknown) => entry }))
vi.mock('../data/tradingApi', () => ({ useTradingStats: (_mode: string, enabled = true) => { state.statsEnabled.push(enabled); return { data: state.snapshot, isLoading: false } } }))
vi.mock('../app/useRaidState', () => ({ useRaidState: () => state.raid, raidRunning: (raid: { inRaid?: boolean } | null) => Boolean(raid?.inRaid) }))

const snapshot = (rows: TradingRow[], builtAt = new Date(Date.now() - 2 * 3_600_000).toISOString()): TradingSnapshot => ({ format: 1, mode: 'regular', builtAt, analyzed: 2000, eligible: 900, fee: { offerFeeRate: 0.05, requirementFeeRate: 0.05 }, rows })
const renderPage = () => render(<LocaleProvider><MemoryRouter initialEntries={['/economy/trading']}><TradingPage /></MemoryRouter></LocaleProvider>)
const renderNotifier = (path = '/') => render(<LocaleProvider><MemoryRouter initialEntries={[path]}><TradingNotifier /></MemoryRouter></LocaleProvider>)
const names = () => [...document.querySelectorAll('.trading-name')].map((entry) => entry.textContent?.trim())

beforeEach(() => {
  localStorage.clear()
  state.mode = 'pvp'
  state.level = 30
  state.raid = null
  state.source = 'live'
  state.statsEnabled = []
  state.notify.mockClear()
  state.items = [item('egg', 'Золотое яйцо', 55_000), item('key', 'Ключ', 135_000), item('middle', 'Яблоко', 100_000), item('closed', 'Закрытый предмет', 55_000)]
  state.snapshot = snapshot([row('egg'), row('key', 25), row('middle'), row('closed', 40)])
  ;(window as unknown as { tarkovDesktop?: unknown }).tarkovDesktop = { notify: state.notify }
})
afterEach(() => {
  setRenderLanguage('ru')
  delete (window as unknown as { tarkovDesktop?: unknown }).tarkovDesktop
})

describe('«Торговля»', () => {
  it('shows the items that swing, the signals on top, as an estimate', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Торговля' })).toBeInTheDocument()
    expect(screen.getByText(/Оценка по истории цен, не гарантия/)).toBeInTheDocument()
    expect(names()).toEqual(expect.arrayContaining(['Золотое яйцо', 'Ключ', 'Яблоко']))
    expect(within(screen.getByText('Цена упала: можно покупать').closest('section')!).getByText('Золотое яйцо')).toBeInTheDocument()
    expect(within(screen.getByText('Цена выросла: можно продавать').closest('section')!).getByText('Ключ')).toBeInTheDocument()
  })

  it('never shows what the market has not opened at the player’s level (owner, 05.11.2026)', () => {
    state.level = 15
    renderPage()
    expect(names()).toEqual(expect.arrayContaining(['Золотое яйцо', 'Яблоко']))
    expect(names()).not.toContain('Ключ')
    expect(names()).not.toContain('Закрытый предмет')
    expect(screen.queryByText('Закрытый предмет')).toBeNull()
    expect(screen.queryByText('Ключ')).toBeNull()
    expect(screen.getByText(/Открыто на вашем 15 уровне/)).toBeInTheDocument()
  })

  it('below the market’s own level there is nothing, and the page says when it opens', () => {
    state.level = 10
    renderPage()
    expect(names()).toEqual([])
    expect(screen.getByText(/Барахолка откроется на 15 уровне, сейчас у вас 10/)).toBeInTheDocument()
  })

  it('says so when the level is not known yet', () => {
    state.level = 1
    renderPage()
    expect(screen.getByText(/Уровень персонажа в этом режиме ещё не определён/)).toBeInTheDocument()
  })

  const openItem = (name: RegExp) => fireEvent.click(screen.getAllByRole('button', { name }).find((entry) => entry.classList.contains('trading-name'))!)
  const money = (value: number) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽'
  const fee = { offerFeeRate: 0.05, requirementFeeRate: 0.05 }

  it('the list: low, now and high of the period, the successful sales on the right (owner, 05.11.2026)', () => {
    renderPage()
    const heads = [...document.querySelectorAll('.trading-table th')].map((cell) => cell.textContent)
    expect(heads).toEqual(['Предмет', 'Минимум', 'Сейчас', 'Максимум', 'Успешные продажи'])
    const cells = [...document.querySelector('.trading-row')!.querySelectorAll('td')].map((cell) => cell.textContent!.replace(/\s/g, ''))
    expect(cells.slice(1)).toEqual(['50000₽', '55000₽', '150000₽', '9/10'])
  })

  it('a click opens a chart with prices, dates and a forecast, not a table', () => {
    renderPage()
    openItem(/Золотое яйцо/)
    const chart = document.querySelector('.trading-chart svg')!
    expect(chart).toBeInTheDocument()
    expect(chart.querySelector('.price-line')).toBeInTheDocument()
    expect(chart.querySelector('.forecast-line')).toBeInTheDocument()
    expect([...chart.querySelectorAll('.axis')].some((label) => /\d{2}\.\d{2}|\d{2}:\d{2}/.test(label.textContent!))).toBe(true)
    expect(screen.getByText('Прогноз, когда можно будет продавать')).toBeInTheDocument()
    expect(document.querySelector('.trading-detail table')).toBeNull()
  })

  it('what you paid gives the fee, the lowest price to come out ahead, and the price for the chosen sum', () => {
    renderPage()
    openItem(/Золотое яйцо/)
    fireEvent.change(screen.getByLabelText('За сколько купили'), { target: { value: '70000' } })
    const breakEven = askForNet(100_000, 70_000, fee)!
    expect(screen.getByText('Минимальная цена продажи, чтобы выйти в плюс').closest('div')!.textContent!.replace(/\s/g, '')).toContain(money(breakEven).replace(/\s/g, ''))
    expect(screen.getByText('Комиссия при этой цене')).toBeInTheDocument()
    const result = () => document.querySelector('.trading-result')!.textContent!.replace(/\s/g, '')
    expect(result()).toContain(money(breakEven).replace(/\s/g, ''))
    fireEvent.click(screen.getByRole('button', { name: /^25\s000$/ }))
    const ask = askForNet(100_000, 95_000, fee)!
    expect(result()).toContain(money(ask).replace(/\s/g, ''))
    expect(result()).toContain(money(floorForAsk(ask)).replace(/\s/g, ''))
  })

  it('every sum can be chosen, «more» opens a field of your own', () => {
    renderPage()
    openItem(/Золотое яйцо/)
    for (const name of [/^0$/, /^10\s000$/, /^25\s000$/, /^50\s000$/, /^100\s000$/]) expect(screen.getByRole('button', { name })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('За сколько купили'), { target: { value: '70000' } })
    fireEvent.click(screen.getByRole('button', { name: /^>\s100\s000$/ }))
    fireEvent.change(screen.getByLabelText('Своя сумма'), { target: { value: '200000' } })
    expect(document.querySelector('.trading-result')!.textContent!.replace(/\s/g, '')).toContain(money(askForNet(100_000, 270_000, fee)!).replace(/\s/g, ''))
  })

  it('a sum the fee does not allow says so', () => {
    state.snapshot = snapshot([row('egg', 0, { base: 2_000 })])
    renderPage()
    openItem(/Золотое яйцо/)
    fireEvent.change(screen.getByLabelText('За сколько купили'), { target: { value: '70000000' } })
    expect(document.querySelector('.trading-result.none')).toBeInTheDocument()
  })

  it('«Купил» keeps the purchase with the chosen sum and the message; «Продал» takes it away', () => {
    renderPage()
    openItem(/Золотое яйцо/)
    fireEvent.change(screen.getByLabelText('За сколько купили'), { target: { value: '70000' } })
    fireEvent.click(screen.getByRole('button', { name: /^25\s000$/ }))
    expect(screen.getByRole('checkbox', { name: 'Отправить уведомление о старте продажи' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Купил' }))
    expect(readPositions()).toMatchObject([{ mode: 'pvp', itemId: 'egg', paid: 70_000, plus: 25_000, notify: true, base: 100_000 }])
    expect(screen.getByText('Мои покупки')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Куплено' })).toBeDisabled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Продал' })[0]!)
    expect(readPositions()).toEqual([])
    expect(screen.queryByText('Мои покупки')).toBeNull()
  })

  it('«Мои покупки» says when it can be sold and at what price, per mode', () => {
    const ask = askForNet(100_000, 60_000, fee)!
    savePosition({ mode: 'pvp', itemId: 'key', paid: 40_000, plus: 20_000, notify: true, boughtAt: 1, base: 100_000 })
    savePosition({ mode: 'pve', itemId: 'egg', paid: 1000, plus: 0, notify: true, boughtAt: 1, base: 100_000 })
    renderPage()
    const list = document.querySelector('.trading-purchases')!
    expect(list.querySelectorAll('li').length).toBe(1)
    expect(list.querySelector('li')!.textContent).toContain('Можно продавать')
    expect(list.querySelector('li')!.textContent!.replace(/\s/g, '')).toContain(money(ask).replace(/\s/g, ''))
    act(() => savePosition({ mode: 'pvp', itemId: 'key', paid: 400_000, plus: 20_000, notify: true, boughtAt: 1, base: 100_000 }))
    expect(document.querySelector('.trading-purchases li')!.textContent).toContain('Ждём цену')
  })

  it('a signal opens its item even past the first rows or outside the search', () => {
    const many = Array.from({ length: 70 }, (_, index) => `flat${index}`)
    state.items = [...many.map((id) => item(id, id, 100_000)), item('egg', 'Золотое яйцо', 55_000)]
    // The item with the signal swings least, so it stands last.
    const narrow = { min: 50_000, max: 150_000, p10: 90_000, p50: 100_000, p90: 110_000, offers: 20, scans: 84 }
    state.snapshot = snapshot([...many.map((id) => row(id)), row('egg', 0, { w7: narrow })])
    renderPage()
    expect(names()).not.toContain('Золотое яйцо')
    fireEvent.click(document.querySelector('.trading-signal')!)
    expect(names()[0]).toBe('Золотое яйцо')
    expect(document.querySelector('.trading-chart')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Поиск предмета'), { target: { value: 'flat1' } })
    expect(names()).toContain('Золотое яйцо')
    expect(document.querySelector('.trading-chart')).toBeInTheDocument()
  })

  it('switching the period shows that period’s lows and highs', () => {
    renderPage()
    const text = () => document.querySelector('.trading-row')!.textContent!.replace(/\s/g, '')
    expect(text()).toContain('150000')
    fireEvent.click(screen.getByRole('button', { name: 'Цена за 3 дн.' }))
    expect(text()).toContain('120000')
  })

  it('reads in English too, with no Russian interface text left', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    setRenderLanguage('en')
    state.items = [item('egg', 'Golden egg', 55_000), item('key', 'Key', 135_000)]
    state.snapshot = snapshot([row('egg'), row('key')])
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: /Golden egg/ }).find((entry) => entry.classList.contains('trading-name'))!)
    expect(screen.getByRole('heading', { name: 'Trading' })).toBeInTheDocument()
    expect(screen.getByText(/An estimate from price history, not a guarantee/)).toBeInTheDocument()
    expect(document.querySelector('.trading-page')!.textContent).not.toMatch(/[а-яё]/i)
  })

  it('says the statistics are not ready rather than showing an empty table', () => {
    state.snapshot = null
    renderPage()
    expect(screen.getByText(/ещё собирается/)).toBeInTheDocument()
    expect(document.querySelector('.trading-table')).toBeNull()
  })

  it('does not read an empty catalog or demo prices as «nothing to trade»', () => {
    state.items = []
    const empty = renderPage()
    expect(screen.getByText('Жду актуальные цены…')).toBeInTheDocument()
    expect(document.querySelector('.trading-table')).toBeNull()
    empty.unmount()
    state.items = [item('egg', 'Золотое яйцо', 55_000)]
    state.source = 'demo'
    renderPage()
    expect(screen.getByText('Жду актуальные цены…')).toBeInTheDocument()
    expect(document.querySelectorAll('.trading-signal').length).toBe(0)
  })

  it('turns signals off on statistics gone stale', () => {
    state.snapshot = snapshot([row('egg')], new Date(Date.now() - 48 * 3_600_000).toISOString())
    renderPage()
    expect(screen.getByText(/Статистика устарела/)).toBeInTheDocument()
    expect(document.querySelectorAll('.trading-signal').length).toBe(0)
  })

  it('remembers the notification switch and threshold', () => {
    renderPage()
    fireEvent.click(screen.getByRole('checkbox', { name: /Уведомлять о сигналах/ }))
    expect(readTradingSettings().enabled).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: /Уведомлять о сигналах/ }))
    fireEvent.change(screen.getByLabelText('Уведомлять от такой выгоды'), { target: { value: '50000' } })
    expect(readTradingSettings().minProfit).toBe(50_000)
  })
})

describe('notifications of «Торговля»', () => {
  it('say what to do and what it should earn, as an estimate, once per dip', () => {
    state.snapshot = snapshot([row('egg')])
    const first = renderNotifier()
    expect(state.notify).toHaveBeenCalledTimes(1)
    const [title, text] = state.notify.mock.calls[0] as unknown as [string, string]
    expect(title).toBe('Цена упала: можно покупать')
    expect(text).toContain('Золотое яйцо')
    expect(text).toContain('Оценка по истории цен')
    expect(screen.getByText('Цена упала: можно покупать')).toBeInTheDocument()
    first.unmount()
    renderNotifier()
    expect(state.notify).toHaveBeenCalledTimes(1)
  })

  it('never for what is closed at the player’s level', () => {
    state.level = 15
    state.snapshot = snapshot([row('closed', 40), row('key', 25)])
    renderNotifier()
    expect(state.notify).not.toHaveBeenCalled()
  })

  it('never while the level is not known', () => {
    state.level = 1
    state.snapshot = snapshot([row('egg')])
    renderNotifier()
    expect(state.notify).not.toHaveBeenCalled()
  })

  it('nothing during a raid, and nothing while turned off', () => {
    state.snapshot = snapshot([row('egg')])
    state.raid = { inRaid: true }
    const during = renderNotifier()
    expect(state.notify).not.toHaveBeenCalled()
    during.unmount()
    state.raid = null
    localStorage.setItem('raidos-trading-notify-v1', JSON.stringify({ enabled: false, minProfit: 25_000 }))
    renderNotifier()
    expect(state.notify).not.toHaveBeenCalled()
    expect(state.statsEnabled.at(-1)).toBe(false)
  })

  it('at most three at once, below the threshold none', () => {
    const many = ['a', 'b', 'c', 'd', 'e']
    state.items = many.map((id) => item(id, id, 55_000))
    state.snapshot = snapshot(many.map((id) => row(id)))
    renderNotifier()
    expect(state.notify).toHaveBeenCalledTimes(3)
    // The rest count as told: they do not come out one by one at the next update.
    act(() => { window.dispatchEvent(new Event('raidos-trading-settings-changed')) })
    expect(state.notify).toHaveBeenCalledTimes(3)
    state.notify.mockClear()
    localStorage.clear()
    localStorage.setItem('raidos-trading-notify-v1', JSON.stringify({ enabled: true, minProfit: 100_000 }))
    renderNotifier()
    expect(state.notify).not.toHaveBeenCalled()
  })

  it('never on demo prices', () => {
    state.snapshot = snapshot([row('egg')])
    state.source = 'demo'
    renderNotifier()
    expect(state.notify).not.toHaveBeenCalled()
  })

  describe('what the player bought', () => {
    const fee = { offerFeeRate: 0.05, requirementFeeRate: 0.05 }
    const bought = (patch: object = {}) => savePosition({ mode: 'pvp', itemId: 'key', paid: 40_000, plus: 20_000, notify: true, boughtAt: 1, base: 100_000, ...patch })
    beforeEach(() => { state.snapshot = null })

    it('says when it can be sold, at what lowest price and what it brings, once', () => {
      bought()
      const first = renderNotifier()
      expect(state.notify).toHaveBeenCalledTimes(1)
      const [title, text] = state.notify.mock.calls[0] as unknown as [string, string]
      expect(title).toBe('Можно продавать купленное')
      expect(text.replace(/\s/g, '')).toContain(new Intl.NumberFormat('ru-RU').format(askForNet(100_000, 60_000, fee)!).replace(/\s/g, ''))
      expect(text).toContain('Ключ')
      first.unmount()
      renderNotifier()
      expect(state.notify).toHaveBeenCalledTimes(1)
    })

    it('stays quiet while the price is not there, for a lost item and with the message turned off', () => {
      bought({ paid: 400_000 })
      const low = renderNotifier()
      expect(state.notify).not.toHaveBeenCalled()
      low.unmount()
      bought({ notify: false })
      const off = renderNotifier()
      expect(state.notify).not.toHaveBeenCalled()
      off.unmount()
      bought({ itemId: 'gone' })
      renderNotifier()
      expect(state.notify).not.toHaveBeenCalled()
    })

    it('comes even with the signals turned off, never during a raid, not for another mode', () => {
      localStorage.setItem('raidos-trading-notify-v1', JSON.stringify({ enabled: false, minProfit: 25_000 }))
      bought({ mode: 'pve' })
      const other = renderNotifier()
      expect(state.notify).not.toHaveBeenCalled()
      other.unmount()
      state.raid = { inRaid: true }
      bought()
      const raid = renderNotifier()
      expect(state.notify).not.toHaveBeenCalled()
      raid.unmount()
      state.raid = null
      renderNotifier()
      expect(state.notify).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Можно продавать купленное')).toBeInTheDocument()
    })

    it('a new sum is a new message', () => {
      bought()
      const first = renderNotifier()
      expect(state.notify).toHaveBeenCalledTimes(1)
      first.unmount()
      bought({ plus: 10_000 })
      renderNotifier()
      expect(state.notify).toHaveBeenCalledTimes(2)
    })
  })

  it('no message over the page itself, which shows every signal', () => {
    state.snapshot = snapshot([row('egg')])
    renderNotifier('/economy/trading')
    expect(document.querySelector('.trading-toast')).toBeNull()
  })
})
