import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Item, RaidMode } from '../domain/types'
import { fleaMarketFee } from '../domain/fleaFee'
import { formatPrice } from '../shared/format'
import { askForNet, floorForAsk, type TradingModule, type TradingRow, type TradingSnapshot } from '../domain/trading'
import { createLocalProfile } from '../domain/progress'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { readPositions, savePosition } from '../trading/tradingPositions'
import { readTradingSettings } from '../trading/tradingSettings'
import { TradingNotifier } from '../trading/TradingNotifier'
import { TradingPage } from './TradingPage'

const actualProfile = createLocalProfile('TEST', 'trading')
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
  statsFailed: false,
  raid: null as unknown,
  source: 'live' as string,
  notify: vi.fn(async () => true),
  statsEnabled: [] as boolean[],
  traders: [] as unknown[],
  live: null as unknown,
  refresh: vi.fn(),
}))
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ source: state.source, data: { items: state.items, hideout: [], traders: state.traders, quests: [], metadata: { mode: state.mode } } }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: state.mode, activeProfile: { modes: { [state.mode]: { ...actualProfile.modes.pvp, playerLevel: state.level, hideoutLevels: {} } } } }) }))
vi.mock('../data/livePrices', () => ({ useLivePrices: () => state.live, useLivePricesRefresh: () => ({ fetching: false, refresh: state.refresh }), withLivePrice: (entry: unknown) => entry }))
vi.mock('../data/tradingApi', () => ({ useTradingStats: (_mode: string, enabled = true) => { state.statsEnabled.push(enabled); return { data: state.statsFailed ? undefined : state.snapshot, isLoading: false, isError: state.statsFailed } } }))
vi.mock('../app/useRaidState', () => ({ useRaidState: () => state.raid, raidRunning: (raid: { inRaid?: boolean } | null) => Boolean(raid?.inRaid) }))

const snapshot = (rows: TradingRow[], builtAt = new Date(Date.now() - 2 * 3_600_000).toISOString()): TradingSnapshot => ({ format: 1, mode: 'regular', builtAt, analyzed: 2000, eligible: 900, fee: { offerFeeRate: 0.05, requirementFeeRate: 0.05 }, rows })
const renderPage = () => render(<LocaleProvider><MemoryRouter initialEntries={['/economy/trading']}><TradingPage /></MemoryRouter></LocaleProvider>)
const renderNotifier = (path = '/') => render(<LocaleProvider><MemoryRouter initialEntries={[path]}><TradingNotifier /></MemoryRouter></LocaleProvider>)
const names = () => [...document.querySelectorAll('.trading-name')].map((entry) => entry.textContent?.trim())
const setPlus = (value: number) => fireEvent.change(screen.getByRole('slider'), { target: { value: String(value) } })

beforeEach(() => {
  localStorage.clear()
  state.mode = 'pvp'
  state.level = 30
  state.raid = null
  state.source = 'live'
  state.statsEnabled = []
  state.statsFailed = false
  state.live = null
  state.refresh.mockClear()
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
    expect(screen.getByText('Это не гарантия заработка, а просто статистика. Из-за скачков цен на барахолке цена может отличаться.')).toBeInTheDocument()
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
    setPlus(25_000)
    const ask = askForNet(100_000, 95_000, fee)!
    expect(result()).toContain(money(ask).replace(/\s/g, ''))
    expect(result()).toContain(money(floorForAsk(ask)).replace(/\s/g, ''))
  })

  it('the sum is a slider up to 100 000 at least, and a field for any sum (owner, 05.11.2026: «сделай ползунок»)', () => {
    renderPage()
    openItem(/Золотое яйцо/)
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(Number(slider.max)).toBeGreaterThanOrEqual(100_000)
    fireEvent.change(screen.getByLabelText('За сколько купили'), { target: { value: '70000' } })
    setPlus(37_000)
    expect(document.querySelector('.trading-result')!.textContent!.replace(/\s/g, '')).toContain(money(askForNet(100_000, 107_000, fee)!).replace(/\s/g, ''))
    fireEvent.change(screen.getByLabelText('Своя сумма'), { target: { value: '200000' } })
    expect(document.querySelector('.trading-result')!.textContent!.replace(/\s/g, '')).toContain(money(askForNet(100_000, 270_000, fee)!).replace(/\s/g, ''))
    expect(Number((screen.getByRole('slider') as HTMLInputElement).max)).toBeGreaterThanOrEqual(200_000)
  })

  it('green up to what the price has reached, red and «дорого» above it, and the real plus in a green frame', () => {
    renderPage()
    openItem(/Золотое яйцо/)
    fireEvent.change(screen.getByLabelText('За сколько купили'), { target: { value: '70000' } })
    const ask = Math.round(150_000 * 0.99)
    const best = ask - fleaMarketFee(100_000, ask, fee) - 70_000
    const flat = (text: string | null | undefined) => (text ?? '').replace(/\s/g, '')
    expect(flat(document.querySelector('.trading-real')!.textContent)).toContain(flat(formatPrice(best)))
    expect(document.querySelector('.trading-real')!.textContent).toContain('Реально можно заработать')
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(parseFloat(slider.style.getPropertyValue('--green'))).toBeCloseTo((best / Number(slider.max)) * 100, 1)
    setPlus(Math.floor(best / 1000) * 1000)
    expect(document.querySelector('.trading-dear')).toBeNull()
    expect(document.querySelector('.trading-result.dear')).toBeNull()
    setPlus(Math.ceil(best / 1000) * 1000 + 1000)
    expect(flat(document.querySelector('.trading-dear')!.textContent)).toContain(flat(`Дорого для этого предмета: за неделю цена не поднималась выше ${formatPrice(150_000)}`))
    expect(document.querySelector('.trading-result.dear')).toBeInTheDocument()
    expect(flat(document.querySelector('.trading-real')!.textContent)).toContain(flat(formatPrice(best)))
    // Bought above what the highest price leaves: no plus at all, and it says so.
    fireEvent.change(screen.getByLabelText('За сколько купили'), { target: { value: '500000' } })
    expect(document.querySelector('.trading-real.none')!.textContent).toContain('По истории в плюс не выйти')
  })

  it('the limit follows the period on screen', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Цена за 3 дн.' }))
    openItem(/Золотое яйцо/)
    expect(document.querySelector('.trading-real')!.textContent!.replace(/\s/g, '')).toContain(`${formatPrice(120_000)},самойвысокойза3дня`.replace(/\s/g, ''))
  })

  it('prices: the time of the last ones at the top, a button for them now, and it does not take a second press at once', () => {
    state.live = { updatedAt: Date.parse('2026-11-05T07:08:09Z'), items: new Map() }
    renderPage()
    expect(screen.getByText(new RegExp(`^цены: ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(Date.parse('2026-11-05T07:08:09Z'))}$`))).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Обновить цены' })
    fireEvent.click(button)
    expect(state.refresh).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
  })

  it('the modules say what they are in the owner’s words', () => {
    state.snapshot = { ...snapshot([row('egg')]), modules: [{ id: 'brake', base: 20_000, level: 0, offers: [{ traderId: 'mechanic', price: 10_000, level: 4 }], questIds: [], series: [], seriesFrom: 0, seriesAt: [] }] }
    state.items = [item('egg', 'Золотое яйцо', 55_000), item('brake', 'Дульный тормоз', 95_000)]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Продажа модулей' }))
    expect(screen.getByText('Модули, которые требуются для квестов «Оружейник».')).toBeInTheDocument()
  })

  it('tells once what the buttons of the mouse do, until it is closed; and what the numbers are not', () => {
    const first = renderPage()
    expect(screen.getByText('Левая кнопка')).toBeInTheDocument()
    expect(screen.getByText('Правая кнопка')).toBeInTheDocument()
    expect(screen.getByText(/Из-за скачков цен на барахолке цена может отличаться/)).toBeInTheDocument()
    expect(screen.queryByText(/с задержкой/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть подсказку' }))
    expect(screen.queryByText('Левая кнопка')).toBeNull()
    first.unmount()
    renderPage()
    expect(screen.queryByText('Левая кнопка')).toBeNull()
  })

  it('«Куплено»: when the price may peak, on the player’s clock, in the column and the detail', () => {
    const hour = 3_600_000
    const from = Math.floor(Date.now() / (2 * hour)) * (2 * hour) - 7 * 24 * hour
    const count = 7 * 12
    const series = Array.from({ length: count }, (_, index) => new Date(from + index * 2 * hour).getUTCHours() === 12 ? 140_000 : 100_000)
    state.snapshot = snapshot([row('key', 0, { series, seriesFrom: from, seriesAt: series.map((_, index) => index * 120) })])
    savePosition({ mode: 'pvp', itemId: 'key', paid: 40_000, plus: 0, notify: true, boughtAt: 1, base: 100_000 })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Куплено (1)' }))
    expect(screen.getByRole('columnheader', { name: 'Через сколько продать' })).toBeInTheDocument()
    const cell = document.querySelector('.trading-peak-cell')!
    expect(cell.textContent).toMatch(/^через \d+ ч/)
    fireEvent.click(document.querySelector('.trading-bought .trading-name')!)
    expect(document.querySelector('.trading-peak')!.textContent).toContain('Предположительно высокая цена')
    expect(document.querySelector('.trading-peak')!.textContent).toContain('ваше время')
  })

  it('a purchase with no history says nothing about a peak', () => {
    savePosition({ mode: 'pvp', itemId: 'key', paid: 40_000, plus: 0, notify: true, boughtAt: 1, base: 100_000 })
    state.snapshot = snapshot([row('egg')])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Куплено (1)' }))
    expect(document.querySelector('.trading-peak-cell')!.textContent).toBe('—')
  })

  it('a sum the fee does not allow says so', () => {
    renderPage()
    openItem(/Золотое яйцо/)
    fireEvent.change(screen.getByLabelText('За сколько купили'), { target: { value: '70000000' } })
    expect(document.querySelector('.trading-result.none')).toBeInTheDocument()
  })

  it('«Купил» keeps the purchase with the chosen sum and the message, and shows it in «Куплено»', () => {
    renderPage()
    openItem(/Золотое яйцо/)
    fireEvent.change(screen.getByLabelText('За сколько купили'), { target: { value: '70000' } })
    setPlus(25_000)
    // Always on after a purchase (owner, 05.11.2026): the bell in «Куплено» turns it off.
    expect(screen.queryByRole('checkbox', { name: 'Отправить уведомление о старте продажи' })).toBeNull()
    expect(screen.getByText('Уведомление о старте продажи включится само.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Купил' }))
    expect(readPositions()).toMatchObject([{ mode: 'pvp', itemId: 'egg', paid: 70_000, plus: 25_000, notify: true, base: 100_000 }])
    expect(screen.getByRole('button', { name: 'Куплено (1)' })).toHaveClass('active')
    expect(document.querySelector('.trading-bought')).toBeInTheDocument()
  })

  it('a right click offers «Купил», a window asks for the price, and it goes to «Куплено»', () => {
    renderPage()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(document.querySelector('.trading-row')!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Купил' }))
    const field = screen.getByRole('dialog').querySelector('input')!
    expect(field.value).toBe('55000')
    fireEvent.change(field, { target: { value: '50000' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Купил' }))
    expect(readPositions()).toMatchObject([{ itemId: 'egg', paid: 50_000, plus: 0, notify: true }])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Куплено (1)' })).toBeInTheDocument()
  })

  it('«Куплено»: what was paid, the price to break even, the price for the chosen plus, the price now and what selling now brings', () => {
    savePosition({ mode: 'pvp', itemId: 'key', paid: 40_000, plus: 25_000, notify: true, boughtAt: 1, base: 100_000 })
    savePosition({ mode: 'pve', itemId: 'egg', paid: 1000, plus: 0, notify: true, boughtAt: 1, base: 100_000 })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Куплено (1)' }))
    const heads = [...document.querySelectorAll('.trading-bought th')].map((cell) => cell.textContent)
    expect(heads).toEqual(['Предмет', 'Куплено за', 'В ноль', 'Под ваш плюс', 'Сейчас', 'Если продать сейчас', 'Через сколько продать'])
    const cells = [...document.querySelector('.trading-bought .trading-row')!.querySelectorAll('td')].map((cell) => cell.textContent!.replace(/\s/g, ''))
    expect(cells[1]).toBe('40000₽')
    expect(cells[2]).toBe(money(askForNet(100_000, 40_000, fee)!).replace(/\s/g, ''))
    expect(cells[3]).toContain(money(askForNet(100_000, 65_000, fee)!).replace(/\s/g, ''))
    expect(cells[4]).toBe('135000₽')
    expect(cells[5].startsWith('+')).toBe(true)
    expect(cells[5]).not.toContain('торговцу')
    expect(document.querySelector('.trading-bought .trading-row')!.textContent).toContain('можно продавать')
    expect(document.querySelector('.trading-bought')!.textContent).not.toContain('Золотое яйцо')
  })

  it('«если продать сейчас» takes whichever brings more: a trader paying over what a listing leaves says so', () => {
    state.items = [item('key', 'Ключ', 60_000, 'pvp', 90_000)]
    state.snapshot = snapshot([row('key')])
    savePosition({ mode: 'pvp', itemId: 'key', paid: 40_000, plus: 0, notify: true, boughtAt: 1, base: 100_000 })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Куплено (1)' }))
    const last = [...document.querySelector('.trading-bought .trading-row')!.querySelectorAll('td')].at(-2)!.textContent!.replace(/\s/g, '')
    expect(last).toContain('+50000₽')
    expect(last).toContain('торговцу')
  })

  it('a click on a purchase sets everything: the sum, the message, the price to be told about; «Продал» takes it away', () => {
    savePosition({ mode: 'pvp', itemId: 'key', paid: 40_000, plus: 0, notify: true, boughtAt: 1, base: 100_000 })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Куплено (1)' }))
    fireEvent.click(document.querySelector('.trading-bought .trading-name')!)
    expect(document.querySelector('.trading-chart')).toBeInTheDocument()
    setPlus(50_000)
    expect(readPositions()[0]!.plus).toBe(50_000)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Уведомлять, когда можно продавать с этим плюсом' }))
    expect(readPositions()[0]!.notify).toBe(false)
    fireEvent.change(screen.getByLabelText('Ещё уведомить, когда цена дойдёт до'), { target: { value: '500000' } })
    expect(readPositions()[0]!.alertPrice).toBe(500_000)
    fireEvent.click(screen.getByRole('button', { name: /Обычный верх/ }))
    expect(readPositions()[0]!.alertPrice).toBe(140_000)
    fireEvent.click(screen.getByRole('button', { name: 'Убрать' }))
    expect(readPositions()[0]!.alertPrice).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Продал' }))
    expect(readPositions()).toEqual([])
    expect(screen.getByText(/Пока ничего не куплено/)).toBeInTheDocument()
  })

  it('a click on a heading sorts by it: «Минимум» those closest to their low, «Максимум» to their high, «Сейчас» by price', () => {
    const narrow = (min: number, max: number) => ({ w7: { min, max, p10: 60_000, p50: 100_000, p90: 140_000, offers: 20, scans: 84 } })
    state.items = [item('atLow', 'У минимума', 51_000), item('atHigh', 'У максимума', 149_000), item('middle', 'Посередине', 100_000)]
    state.snapshot = snapshot([row('atHigh', 0, narrow(50_000, 150_000)), row('middle', 0, narrow(50_000, 150_000)), row('atLow', 0, narrow(50_000, 150_000))])
    renderPage()
    const first = () => names()[0]
    fireEvent.click(screen.getByRole('button', { name: 'Минимум' }))
    expect(first()).toBe('У минимума')
    expect(screen.getByRole('button', { name: 'Минимум' }).closest('th')).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(screen.getByRole('button', { name: 'Минимум' }))
    expect(first()).toBe('У максимума')
    fireEvent.click(screen.getByRole('button', { name: 'Максимум' }))
    expect(first()).toBe('У максимума')
    fireEvent.click(screen.getByRole('button', { name: 'Сейчас' }))
    expect(first()).toBe('У минимума')
    fireEvent.click(screen.getByRole('button', { name: 'Сейчас' }))
    expect(first()).toBe('У максимума')
  })

  describe('«Продажа модулей»', () => {
    const MECHANIC = { id: 'mechanic', name: 'Механик', normalizedName: 'mechanic', role: '', loyalty: 1, accent: '', levelPlayerLevels: [1, 15, 26, 36] }
    const module = (patch: Partial<TradingModule> = {}): TradingModule => ({ id: 'brake', base: 20_000, level: 20, offers: [{ traderId: 'mechanic', price: 10_573, level: 4, limit: 1 }], questIds: [], series: [90_000, 95_000], seriesFrom: Date.now() - 2 * 3_600_000, seriesAt: [0, 120], ...patch })
    beforeEach(() => {
      state.traders = [MECHANIC]
      state.items = [...state.items as Item[], item('brake', 'Дульный тормоз', 95_554)]
      state.level = 40
      state.snapshot = { ...snapshot([row('egg')]), modules: [module()] }
    })
    afterEach(() => { state.traders = [] })
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Продажа модулей' }))

    it('stands to the right of the period, and lists what to buy from whom and what it brings after the fee', () => {
      renderPage()
      open()
      const cells = [...document.querySelector('.trading-modules .trading-row')!.querySelectorAll('td')].map((cell) => cell.textContent!.replace(/\s/g, ''))
      const ask = Math.round(95_554 * 0.99)
      const listingFee = fleaMarketFee(20_000, ask, fee)
      expect(cells[0]).toContain('Дульныйтормоз')
      expect(cells[1]).toContain('Механик')
      expect(cells[2]).toBe('10573₽')
      expect(cells[3]).toBe('95554₽')
      expect(cells[4]).toBe(money(listingFee).replace(/\s/g, '').replace(/^/, '−'))
      expect(cells[5]).toBe(('+' + money(ask - listingFee - 10_573)).replace(/\s/g, ''))
    })

    it('hides what the trader or the market has not opened at the player’s level', () => {
      state.level = 30
      renderPage()
      open()
      expect(document.querySelector('.trading-modules')).toBeNull()
      expect(screen.getByText(/выгодных модулей на вашем уровне нет/)).toBeInTheDocument()
    })

    it('hides what a quest not done yet opens at the trader', () => {
      state.snapshot = { ...snapshot([row('egg')]), modules: [module({ offers: [{ traderId: 'mechanic', price: 10_573, level: 1, questId: 'not-done' }] })] }
      renderPage()
      open()
      expect(document.querySelector('.trading-modules')).toBeNull()
    })

    it('leaves out a copper of difference', () => {
      state.items = [item('egg', 'Золотое яйцо', 55_000), item('brake', 'Дульный тормоз', 12_000)]
      renderPage()
      open()
      expect(document.querySelector('.trading-modules')).toBeNull()
    })

    it('opens its chart and the sums with the trader’s price, and can be bought', () => {
      renderPage()
      open()
      fireEvent.click(document.querySelector('.trading-modules .trading-name')!)
      expect(document.querySelector('.trading-chart')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Купил' }))
      expect(readPositions()).toMatchObject([{ itemId: 'brake', paid: 10_573 }])
      expect(document.querySelector('.trading-bought')).toBeInTheDocument()
    })

    it('says so when the server has not sent the list yet', () => {
      state.snapshot = snapshot([row('egg')])
      renderPage()
      open()
      expect(screen.getByText(/Список модулей появится/)).toBeInTheDocument()
    })
  })

  it('a signal opens its item even past the first rows or outside the search', () => {
    const many = Array.from({ length: 70 }, (_, index) => `flat${index}`)
    state.items = [...many.map((id) => item(id, id, 100_000)), item('egg', 'Золотое яйцо', 55_000)]
    // The item with the signal swings least, so it stands last.
    const narrow = { min: 50_000, max: 150_000, p10: 85_000, p50: 100_000, p90: 115_000, offers: 20, scans: 84 }
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
    expect(screen.getByText(/This is no guarantee of earnings, only statistics/)).toBeInTheDocument()
    expect(document.querySelector('.trading-page')!.textContent).not.toMatch(/[а-яё]/i)
  })

  it('says the statistics are not ready rather than showing an empty table', () => {
    state.snapshot = null
    renderPage()
    expect(screen.getByText(/ещё собирается/)).toBeInTheDocument()
    expect(document.querySelector('.trading-table')).toBeNull()
  })

  it('a failed request is not «still being gathered»: the server may have had the file for days', () => {
    state.statsFailed = true
    renderPage()
    expect(screen.getByText(/Не удалось получить статистику/)).toBeInTheDocument()
    expect(screen.queryByText(/ещё собирается/)).toBeNull()
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
  it('say what happened and what it should earn, shortly, as an estimate, with the picture, once per dip', () => {
    state.snapshot = snapshot([row('egg')])
    const first = renderNotifier()
    const toast = document.querySelector('.trading-toast')!
    expect(toast.textContent).toContain('Золотое яйцо: цена упала')
    expect(toast.textContent).toContain('Оценка')
    expect(toast.querySelector('img')).toHaveAttribute('src', 'https://assets.tarkov.dev/egg-icon.webp')
    first.unmount()
    renderNotifier()
    expect(document.querySelector('.trading-toast')).toBeNull()
  })

  it('never for what is closed at the player’s level', () => {
    state.level = 15
    state.snapshot = snapshot([row('closed', 40), row('key', 25)])
    renderNotifier()
    expect(document.querySelector('.trading-toast')).toBeNull()
  })

  it('never while the level is not known', () => {
    state.level = 1
    state.snapshot = snapshot([row('egg')])
    renderNotifier()
    expect(document.querySelector('.trading-toast')).toBeNull()
  })

  it('nothing during a raid, and nothing while turned off', () => {
    state.snapshot = snapshot([row('egg')])
    state.raid = { inRaid: true }
    const during = renderNotifier()
    expect(document.querySelector('.trading-toast')).toBeNull()
    during.unmount()
    state.raid = null
    localStorage.setItem('raidos-trading-notify-v1', JSON.stringify({ enabled: false, minProfit: 25_000 }))
    renderNotifier()
    expect(document.querySelector('.trading-toast')).toBeNull()
    expect(state.statsEnabled.at(-1)).toBe(false)
  })

  it('at most three at once, below the threshold none', () => {
    const many = ['a', 'b', 'c', 'd', 'e']
    state.items = many.map((id) => item(id, id, 55_000))
    state.snapshot = snapshot(many.map((id) => row(id)))
    const shown = renderNotifier()
    expect(document.querySelectorAll('.trading-toast').length).toBe(3)
    // The rest count as told: they do not come out one by one at the next update.
    act(() => { window.dispatchEvent(new Event('raidos-trading-settings-changed')) })
    expect(document.querySelectorAll('.trading-toast').length).toBe(3)
    shown.unmount()
    localStorage.clear()
    localStorage.setItem('raidos-trading-notify-v1', JSON.stringify({ enabled: true, minProfit: 100_000 }))
    renderNotifier()
    expect(document.querySelector('.trading-toast')).toBeNull()
  })

  it('never on demo prices', () => {
    state.snapshot = snapshot([row('egg')])
    state.source = 'demo'
    renderNotifier()
    expect(document.querySelector('.trading-toast')).toBeNull()
  })

  describe('what the player bought', () => {
    const fee = { offerFeeRate: 0.05, requirementFeeRate: 0.05 }
    const bought = (patch: object = {}) => savePosition({ mode: 'pvp', itemId: 'key', paid: 40_000, plus: 20_000, notify: true, boughtAt: 1, base: 100_000, ...patch })
    beforeEach(() => { state.snapshot = null })

    it('says when it can be sold, at what lowest price and what it brings, shortly, with the item’s picture, once', () => {
      bought()
      const first = renderNotifier()
      expect(document.querySelector('.trading-toast img')).toHaveAttribute('src', 'https://assets.tarkov.dev/key-icon.webp')
      const toast = document.querySelector('.trading-toast')!.textContent!
      expect(toast).toContain('Ключ: можно продавать')
      expect(toast.replace(/\s/g, '')).toContain(new Intl.NumberFormat('ru-RU').format(askForNet(100_000, 60_000, fee)!).replace(/\s/g, ''))
      expect(toast).toContain('Оценка')
      first.unmount()
      const again = renderNotifier()
      expect(document.querySelector('.trading-toast')).toBeNull()
      again.unmount()
    })

    it('a second message when the price reaches the player’s own threshold', () => {
      bought({ plus: 900_000, alertPrice: 130_000 })
      renderNotifier()
      const toast = document.querySelector('.trading-toast')!.textContent!
      expect(toast).toContain('цена дошла до')
      expect(toast).toContain('если продать')
    })

    it('not while it is under that price', () => {
      bought({ plus: 900_000, alertPrice: 500_000 })
      renderNotifier()
      expect(document.querySelector('.trading-toast')).toBeNull()
    })

    it('comes over the page itself too, and leads to «Куплено»', () => {
      bought()
      renderNotifier('/economy/trading')
      expect(document.querySelector('.trading-toast')).toBeInTheDocument()
    })

    it('stays quiet while the price is not there, for a lost item and with the message turned off', () => {
      bought({ paid: 400_000 })
      const low = renderNotifier()
      expect(document.querySelector('.trading-toast')).toBeNull()
      low.unmount()
      bought({ notify: false })
      const off = renderNotifier()
      expect(document.querySelector('.trading-toast')).toBeNull()
      off.unmount()
      bought({ itemId: 'gone' })
      renderNotifier()
      expect(document.querySelector('.trading-toast')).toBeNull()
    })

    it('comes even with the signals turned off, never during a raid, not for another mode', () => {
      localStorage.setItem('raidos-trading-notify-v1', JSON.stringify({ enabled: false, minProfit: 25_000 }))
      bought({ mode: 'pve' })
      const other = renderNotifier()
      expect(document.querySelector('.trading-toast')).toBeNull()
      other.unmount()
      state.raid = { inRaid: true }
      bought()
      const raid = renderNotifier()
      expect(document.querySelector('.trading-toast')).toBeNull()
      raid.unmount()
      state.raid = null
      renderNotifier()
      expect(document.querySelector('.trading-toast')!.textContent).toContain('можно продавать')
    })

    it('a new sum is a new message', () => {
      bought()
      const first = renderNotifier()
      expect(document.querySelector('.trading-toast')).toBeInTheDocument()
      first.unmount()
      const same = renderNotifier()
      expect(document.querySelector('.trading-toast')).toBeNull()
      same.unmount()
      bought({ plus: 10_000 })
      renderNotifier()
      expect(document.querySelector('.trading-toast')).toBeInTheDocument()
    })
  })

  it('never on demo prices', () => {
    state.snapshot = snapshot([row('egg')])
    state.source = 'demo'
    renderNotifier()
    expect(document.querySelector('.trading-toast')).toBeNull()
  })

  it('no message over the page itself, which shows every signal', () => {
    state.snapshot = snapshot([row('egg')])
    renderNotifier('/economy/trading')
    expect(document.querySelector('.trading-toast')).toBeNull()
  })
})

// Owner, 05.11.2026: «справа еще кнопку добавь… кнопку продажа торговцам… Ищи такие предметы и показывай списки».
describe('«Продажа торговцам»', () => {
  const list = (ids: string[], level: Record<string, number> = {}) => ({ ...snapshot([row('egg')]), traderItems: ids.map((id) => ({ id, level: level[id] ?? 0 })) })
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Продажа торговцам' }))
  const rows = () => [...document.querySelectorAll('.trading-trader-sales tbody tr')].map((entry) => [...entry.querySelectorAll('td')].map((cell, index) => (index === 0 ? cell.querySelector('.trading-sale-name')! : cell).textContent!.replace(/\s/g, '')))

  beforeEach(() => {
    state.items = [item('egg', 'Золотое яйцо', 20_000, 'pvp', 30_000), item('small', 'Часы', 50_000, 'pvp', 51_000), item('big', 'Статуэтка', 20_000, 'pvp', 45_000), item('dear', 'Дорогой', 30_000, 'pvp', 20_000), item('armor', 'Бронежилет', 10_000, 'pvp', 40_000)]
    state.snapshot = list(['egg', 'small', 'big', 'dear'])
  })

  it('stands to the right of «Продажа модулей»', () => {
    renderPage()
    expect([...document.querySelectorAll('.trading-views button')].map((entry) => entry.textContent)).toEqual(['Куплено', 'Продажа модулей', 'Продажа торговцам'])
  })

  it('lists what is cheaper than a trader pays, the most profit first, with the trader and both prices', () => {
    renderPage()
    open()
    expect(screen.getByRole('button', { name: 'Продажа торговцам' })).toHaveClass('active')
    expect(rows()).toEqual([
      ['Статуэтка', '20000₽', 'Терапевт', '45000₽', '+25000₽'],
      ['Золотоеяйцо', '20000₽', 'Терапевт', '30000₽', '+10000₽'],
      ['Часы', '50000₽', 'Терапевт', '51000₽', '+1000₽'],
    ])
    expect(screen.getByText(/Без предметов с прочностью и ресурсом/)).toBeInTheDocument()
    expect(screen.getByText(/Открыто на вашем 30 уровне: 3\./)).toBeInTheDocument()
    expect(screen.getByText(/Покупка и продажа торговцу без комиссии/)).toBeInTheDocument()
  })

  it('its rows open nothing, so the hint does not promise a chart here', () => {
    renderPage()
    expect(screen.getByText('Левая кнопка')).toBeInTheDocument()
    open()
    expect(screen.queryByText('Левая кнопка')).toBeNull()
    expect(screen.getByText('Правая кнопка')).toBeInTheDocument()
  })

  it('what the server left out, an item with wear, never shows however cheap', () => {
    renderPage()
    open()
    expect(screen.queryByText('Бронежилет')).toBeNull()
  })

  it('never shows what the market has not opened at the player’s level', () => {
    state.level = 20
    state.snapshot = list(['egg', 'big'], { big: 30 })
    renderPage()
    open()
    expect(rows().map((cells) => cells[0])).toEqual(['Золотоеяйцо'])
  })

  it('says when nothing pays right now, and when the server has not sent the list yet', () => {
    state.snapshot = list(['dear'])
    const none = renderPage()
    open()
    expect(screen.getByText('Сейчас таких предметов нет.')).toBeInTheDocument()
    expect(document.querySelector('.trading-trader-sales')).toBeNull()
    none.unmount()
    state.snapshot = snapshot([row('egg')])
    renderPage()
    open()
    expect(screen.getByText('Список появится со следующим обновлением статистики на сервере.')).toBeInTheDocument()
  })

  it('a long list opens by a button', () => {
    state.items = Array.from({ length: 20 }, (_, index) => item(`i${index}`, `Предмет ${index}`, 10_000, 'pvp', 11_000 + index * 100))
    state.snapshot = list(state.items.map((entry) => (entry as Item).id))
    renderPage()
    open()
    expect(rows()).toHaveLength(15)
    fireEvent.click(screen.getByRole('button', { name: 'Показать все: 20' }))
    expect(rows()).toHaveLength(20)
  })

  it('a right click offers «Купил», and the row says so afterwards', () => {
    state.items = [{ ...item('big', 'Статуэтка', 20_000, 'pvp', 45_000), basePrice: 15_000 }]
    state.snapshot = list(['big'])
    renderPage()
    open()
    fireEvent.contextMenu(document.querySelector('.trading-sale-row')!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Купил' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Купил' }))
    expect(readPositions().map((entry) => entry.itemId)).toEqual(['big'])
    expect(within(document.querySelector('.trading-sale-row')!).getByText('куплено')).toBeInTheDocument()
  })

  it('reads in English too, with no Russian interface text left', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    setRenderLanguage('en')
    state.items = [item('egg', 'Golden egg', 20_000, 'pvp', 30_000)]
    state.snapshot = list(['egg'])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Selling to traders' }))
    expect(screen.getByRole('columnheader', { name: 'Pays' })).toBeInTheDocument()
    expect(screen.getByText(/No items with durability or a resource/)).toBeInTheDocument()
    expect(document.querySelector('.trading-trader-sales')!.textContent).toContain('Golden egg')
  })
})
