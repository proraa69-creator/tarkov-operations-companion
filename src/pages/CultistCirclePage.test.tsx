import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HideoutStation, Item, LocalProfile, Quest, RaidMode } from '../domain/types'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { exactUiText } from '../i18n/uiEnglish'
import { CultistCirclePage } from './CultistCirclePage'
import { HideoutHubPage } from './HideoutHubPage'

const FIGURINE = '655c669103999d3c810c025b'
const MASK = '635267ab3c89e2112001f826'
const KNIFE = '5fc64ea372b0dd78d51159dc'
const KERMAN = '6638a5474e92f038531e210e'
const KEYCARD = '5c94bbff86f7747ee735c08f'
const ORNAMENT = '5df8a6a186f77412640e2e80'
const SILVER = '5df8a72c86f77412640e2e83'
const LEFT_HALF = '68f11adfcd0babab2c0fb003'
const RIGHT_HALF = '68f119c6121d878a2303eee3'
const BITCOIN = '59faff1d86f7746c51718c9c'
const TAGILLA = '66572cbdad599021091c611a'
const GORILLA = '60a7ad3a0c5cb24b0134664a'
const UBEY = '60a7ad2a2198820d95707a2e'

const item = (id: string, name: string, flea: Partial<Record<RaidMode, number>> = {}): Item => ({
  id, name, shortName: name, category: 'Бартер', description: '', iconUrl: `https://assets.tarkov.dev/${id}-icon.webp`, types: ['barter'],
  prices: Object.entries(flea).map(([mode, price]) => ({ source: 'Барахолка', kind: 'flea' as const, mode: mode as RaidMode, price: price!, updatedAt: '' })),
})
const quest: Quest = {
  id: 'mask-quest', name: 'Маскарад', trader: 'Прапор', level: 10, kappa: false, description: '', objectives: [], rewards: [], requiredItems: [],
  raidRequirements: [{ itemId: MASK, count: 1, purpose: 'handover', mapIds: [] }],
}
const station: HideoutStation = { id: 'workbench', name: 'Верстак', levels: [{ level: 1, itemRequirements: [{ itemId: KEYCARD, count: 1 }] }] } as unknown as HideoutStation

const state = vi.hoisted(() => ({ mode: 'pvp' as RaidMode, data: { items: [] as unknown[], quests: [] as unknown[], hideout: [] as unknown[] }, profile: null as unknown }))
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: state.data }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: state.mode, activeProfile: state.profile }) }))

function renderPage() {
  return render(<LocaleProvider><MemoryRouter><CultistCirclePage /></MemoryRouter></LocaleProvider>)
}
const tile = (name: RegExp) => screen.getByRole('button', { name })
const tiles = () => [...document.querySelectorAll('.circle-tile')].map((entry) => entry.getAttribute('title'))
const shownNames = (button: HTMLElement) => [...button.querySelectorAll('.circle-tile-name[data-shown="true"] strong')].map((entry) => entry.textContent)

beforeEach(() => {
  localStorage.clear()
  state.mode = 'pvp'
  state.data = {
    items: [
      item(FIGURINE, 'Фигурка Сектанта', { pvp: 60_000, pve: 90_000 }), item(MASK, 'Маска "Череп"'), item(KNIFE, 'Нож сектанта'),
      item(KERMAN, 'Голограмма кота', { pvp: 300_000 }), item(KEYCARD, 'Ключ-карта лаборатории'),
      item(ORNAMENT, 'Шар красный'), item(SILVER, 'Шар серебристый'),
      item(LEFT_HALF, 'Левая половинка', { pvp: 20_000 }), item(RIGHT_HALF, 'Правая половинка', { pvp: 30_000 }), item(BITCOIN, 'Монета Биткоина'),
      item(TAGILLA, 'Фигурка Тагиллы'), item(GORILLA, 'Маска Горилла'), item(UBEY, 'Маска УБЕЙ'),
    ],
    quests: [quest],
    hideout: [station],
  }
  state.profile = setTaskProgress(createLocalProfile('TEST', 'circle'), 'pvp', { taskId: quest.id, status: 'active', source: 'eft-log', updatedAt: '2026-11-04T05:00:00.000Z' })
})
afterEach(() => {
  setRenderLanguage('ru')
  vi.useRealTimers()
})

describe('«Круг сектантов»', () => {
  it('lists what drops, what is needed first; everything an exchange gives is on one tile', () => {
    renderPage()
    // the hologram comes back with the keycard
    expect(tiles()[0]).toBe('Ключ-карта лаборатории + Голограмма кота')
    expect(tiles()).toContain('Маска "Череп"')
    expect(tiles()).toContain('Нож сектанта')
    expect(tiles()).not.toContain('Голограмма кота')
    expect(tile(/Нож сектанта/)).toHaveTextContent('11 ч 6 мин · разово')
  })

  it('a click shows what to place, its flea price with a link, the time and the rule', () => {
    renderPage()
    fireEvent.click(tile(/^Нужно для квестов и убежища.*Маска "Череп"/))
    const dialog = screen.getByRole('dialog', { name: 'Маска "Череп"' })
    expect(within(dialog).getByText('Положить в круг')).toBeInTheDocument()
    const put = within(dialog).getByRole('link', { name: /Фигурка Сектанта/ })
    expect(put).toHaveAttribute('href', `/flea?selected=${FIGURINE}`)
    expect(put).toHaveTextContent('60 000')
    expect(within(dialog).getByText('1 ч 6 мин')).toBeInTheDocument()
    expect(within(dialog).getByText('один раз')).toBeInTheDocument()
    expect(within(dialog).getByText('Только эти предметы: с другими результат будет случайным.')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('five figurines: the price of all five on their row; several items: their total', () => {
    renderPage()
    fireEvent.click(tile(/Нож сектанта/))
    const knife = screen.getByRole('dialog', { name: 'Нож сектанта' })
    expect(within(knife).getByRole('link', { name: /Фигурка Сектанта ×5/ })).toHaveTextContent('300 000')
    expect(within(knife).queryByText(/Всего на барахолке/)).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(tile(/Монета Биткоина/))
    expect(within(screen.getByRole('dialog', { name: 'Монета Биткоина' })).getByText(/Всего на барахолке/)).toHaveTextContent('50 000')
  })

  it('what the flea market does not sell says so and links nowhere; a tile with several items opens with their list on top', () => {
    renderPage()
    fireEvent.click(tile(/Шар серебристый/))
    const silver = screen.getByRole('dialog', { name: 'Шар серебристый' })
    expect(within(silver).getByText('на барахолке не продаётся')).toBeInTheDocument()
    expect(within(silver).queryByRole('link')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(tile(/Ключ-карта лаборатории/))
    const keycard = screen.getByRole('dialog', { name: 'Ключ-карта лаборатории + Голограмма кота' })
    const drops = within(keycard).getByText('Выпадет').parentElement!
    expect(drops.querySelectorAll('li')).toHaveLength(2)
    expect(drops).toHaveTextContent('Ключ-карта лаборатории')
    expect(drops).toHaveTextContent('Голограмма кота')
    expect(keycard.firstElementChild?.nextElementSibling).toBe(drops)
    expect(within(keycard).queryByText('возможно, выпадет')).toBeNull()
    expect(within(keycard).queryByText('Вместе с ним выпадет')).toBeNull()
    expect(within(keycard).getByText('Нужно для').parentElement).toHaveTextContent('Верстак · ур. 1')
  })

  it('prices and needs go by the mode: PvE has its own price, and what is done there is still needed in PvP', () => {
    const profile = setTaskProgress(state.profile as LocalProfile, 'pve', { taskId: quest.id, status: 'completed', source: 'eft-log', updatedAt: '2026-11-04T05:00:00.000Z' })
    state.profile = { ...profile, modes: { ...profile.modes, pve: { ...profile.modes.pve, hideoutLevels: { workbench: 1 } } } }
    state.mode = 'pve'
    const { unmount } = renderPage()
    expect(document.querySelector('.circle-tile-need')).toBeNull()
    fireEvent.click(tile(/Маска "Череп"/))
    const dialog = screen.getByRole('dialog', { name: 'Маска "Череп"' })
    expect(within(dialog).getByRole('link', { name: /Фигурка Сектанта/ })).toHaveTextContent('90 000')
    expect(within(dialog).queryByText('Маскарад')).toBeNull()
    unmount()

    state.mode = 'pvp'
    renderPage()
    expect(document.querySelectorAll('.circle-tile-need')).toHaveLength(2)
    fireEvent.click(tile(/Маска "Череп"/))
    const pvp = screen.getByRole('dialog', { name: 'Маска "Череп"' })
    expect(within(pvp).getByRole('link', { name: /Фигурка Сектанта/ })).toHaveTextContent('60 000')
    expect(within(pvp).getByText('Маскарад')).toBeInTheDocument()
  })

  it('a quest still locked behind its chain marks nothing', () => {
    state.data = { ...state.data, quests: [{ ...quest, previous: ['not-done-yet'], requirements: [{ taskId: 'not-done-yet', allowedStatuses: ['complete'] }] }, { ...quest, id: 'not-done-yet', name: 'Начало цепочки', raidRequirements: [] }] }
    state.profile = createLocalProfile('TEST', 'circle')
    renderPage()
    expect(tile(/Маска "Череп"/).querySelector('.circle-tile-need')).toBeNull()
    fireEvent.click(tile(/Маска "Череп"/))
    expect(within(screen.getByRole('dialog', { name: 'Маска "Череп"' })).queryByText('Нужно для')).toBeNull()
  })

  it('the search and «Нужно для квестов и убежища» narrow the list', () => {
    renderPage()
    fireEvent.change(screen.getByRole('textbox', { name: 'Найти предмет…' }), { target: { value: 'нож' } })
    expect(tiles()).toEqual(['Нож сектанта'])
    fireEvent.change(screen.getByRole('textbox', { name: 'Найти предмет…' }), { target: { value: 'нет такого' } })
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Найти предмет…' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нужно для квестов и убежища' }))
    expect(tiles().sort()).toEqual(['Ключ-карта лаборатории + Голограмма кота', 'Маска "Череп"'])
  })

  it('a tile with several items changes its picture and name every two seconds; a tile with one stands', () => {
    vi.useFakeTimers()
    renderPage()
    const several = tile(/Ключ-карта лаборатории/)
    const one = tile(/Нож сектанта/)
    expect(shownNames(several)).toEqual(['Ключ-карта лаборатории'])
    expect(several.querySelectorAll('.circle-picture[data-shown="true"]')).toHaveLength(1)
    expect(several.querySelectorAll('img')).toHaveLength(2)
    const start = shownNames(several)[0]
    act(() => { vi.advanceTimersByTime(1_999) })
    expect(shownNames(several)[0]).toBe(start)
    act(() => { vi.advanceTimersByTime(1) })
    expect(shownNames(several)).toEqual(['Голограмма кота'])
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(shownNames(several)[0]).toBe(start)
    expect(shownNames(one)).toEqual(['Нож сектанта'])
    // A screen reader hears them all, whichever is shown.
    expect(several.getAttribute('aria-label')).toContain('Голограмма кота')
    expect(several.getAttribute('aria-label')).toContain('Ключ-карта лаборатории')
    expect(one.getAttribute('aria-label')).toBeNull()
  })

  it('what goes by chance says so, on the tile and in the window, with how many drop in all', () => {
    renderPage()
    const figurine = tile(/Маска Горилла/)
    expect(figurine).toHaveTextContent('возможно, выпадет')
    fireEvent.click(figurine)
    const dialog = screen.getByRole('dialog', { name: 'Маска Горилла + Маска УБЕЙ' })
    const drops = within(dialog).getByText('Выпадет').parentElement!
    expect(within(drops).getAllByText('возможно, выпадет')).toHaveLength(2)
    expect(within(drops).getByText(/Всего выпадет/)).toHaveTextContent('Всего выпадет: 1')
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(tile(/Ключ-карта лаборатории/))
    expect(within(screen.getByRole('dialog')).queryByText(/Всего выпадет/)).toBeNull()
  })

  it('a quest that wants the item leads to itself; a hideout level is plain text', () => {
    renderPage()
    fireEvent.click(tile(/Маска "Череп"/))
    const mask = screen.getByRole('dialog', { name: 'Маска "Череп"' })
    expect(within(mask).getByRole('link', { name: 'Маскарад' })).toHaveAttribute('href', `/quests?selected=${quest.id}&filter=all`)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(tile(/Ключ-карта лаборатории/))
    const keycard = screen.getByRole('dialog')
    expect(within(keycard).getByText('Нужно для').parentElement).toHaveTextContent('Верстак · ур. 1')
    expect(within(keycard).queryByRole('link', { name: /Верстак/ })).toBeNull()
  })

  it('the search finds a tile by any item that drops; a mark is a tick, named for a screen reader', () => {
    renderPage()
    fireEvent.change(screen.getByRole('textbox', { name: 'Найти предмет…' }), { target: { value: 'голограмма' } })
    expect(tiles()).toEqual(['Ключ-карта лаборатории + Голограмма кота'])
    const mark = document.querySelector('.circle-tile-need')!
    expect(mark).toHaveAttribute('aria-label', 'Нужно для квестов и убежища')
    expect(mark.textContent).toBe('')
    expect(mark.querySelector('svg')).not.toBeNull()
  })

  it('«Убежище и квесты» has its own button', () => {
    render(<LocaleProvider><MemoryRouter><HideoutHubPage /></MemoryRouter></LocaleProvider>)
    expect(screen.getByRole('link', { name: /Круг сектантов/ })).toHaveAttribute('href', '/hideout/cultist-circle')
  })

  it('speaks English', () => {
    for (const [ru, en] of [
      ['Выпадет', 'Drops'], ['возможно, выпадет', 'may drop'], ['Всего выпадет', 'Total drops'],
      ['Круг сектантов', 'Cultist Circle'], ['Положить в круг', 'Place in the circle'], ['разово', 'once'], ['можно повторять', 'repeatable'], ['один раз', 'once'], ['каждый раз', 'every time'],
      ['на барахолке не продаётся', 'not sold on the flea market'], ['Нужно для квестов и убежища', 'Needed for quests and the hideout'],
    ]) expect(exactUiText(ru), ru).toBe(en)
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    setRenderLanguage('en')
    renderPage()
    expect(screen.getByRole('heading', { name: 'Cultist Circle' })).toBeInTheDocument()
    expect(tile(/Нож сектанта/)).toHaveTextContent('11 h 6 min · once')
    fireEvent.click(tile(/Нож сектанта/))
    expect(within(screen.getByRole('dialog')).getByText('Place in the circle')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText('11 h 6 min')).toBeInTheDocument()
  })
})
