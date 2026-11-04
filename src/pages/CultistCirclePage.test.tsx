import { fireEvent, render, screen, within } from '@testing-library/react'
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
const tiles = () => [...document.querySelectorAll('.circle-tile strong')].map((entry) => entry.textContent)

beforeEach(() => {
  localStorage.clear()
  state.mode = 'pvp'
  state.data = {
    items: [
      item(FIGURINE, 'Фигурка Сектанта', { pvp: 60_000, pve: 90_000 }), item(MASK, 'Маска "Череп"'), item(KNIFE, 'Нож сектанта'),
      item(KERMAN, 'Голограмма кота', { pvp: 300_000 }), item(KEYCARD, 'Ключ-карта лаборатории'),
      item(ORNAMENT, 'Шар красный'), item(SILVER, 'Шар серебристый'),
      item(LEFT_HALF, 'Левая половинка', { pvp: 20_000 }), item(RIGHT_HALF, 'Правая половинка', { pvp: 30_000 }), item(BITCOIN, 'Монета Биткоина'),
    ],
    quests: [quest],
    hideout: [station],
  }
  state.profile = setTaskProgress(createLocalProfile('TEST', 'circle'), 'pvp', { taskId: quest.id, status: 'active', source: 'eft-log', updatedAt: '2026-11-04T05:00:00.000Z' })
})
afterEach(() => setRenderLanguage('ru'))

describe('«Круг сектантов»', () => {
  it('lists only the items that drop, what is needed first; an item that only comes back is no tile', () => {
    renderPage()
    expect(tiles()[0]).toBe('Ключ-карта лаборатории')
    expect(tiles()).toContain('Маска "Череп"')
    expect(tiles()).toContain('Нож сектанта')
    // the hologram comes back with the keycard
    expect(tiles()).not.toContain('Голограмма кота')
    expect(tile(/Нож сектанта/)).toHaveTextContent('11 ч 6 мин · разово')
  })

  it('a click shows what to place, its flea price with a link, the time and the rule', () => {
    renderPage()
    fireEvent.click(tile(/^нужно.*Маска "Череп"/))
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

  it('what the flea market does not sell says so and links nowhere; what also drops is named', () => {
    renderPage()
    fireEvent.click(tile(/Шар серебристый/))
    const silver = screen.getByRole('dialog', { name: 'Шар серебристый' })
    expect(within(silver).getByText('на барахолке не продаётся')).toBeInTheDocument()
    expect(within(silver).queryByRole('link')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(tile(/Ключ-карта лаборатории/))
    const keycard = screen.getByRole('dialog', { name: 'Ключ-карта лаборатории' })
    expect(within(keycard).getByText('Вместе с ним выпадет').nextSibling).toHaveTextContent('Голограмма кота')
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
    expect(tile(/Маска "Череп"/)).not.toHaveTextContent('нужно')
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
    expect(tiles().sort()).toEqual(['Ключ-карта лаборатории', 'Маска "Череп"'])
  })

  it('«Убежище и квесты» has its own button', () => {
    render(<LocaleProvider><MemoryRouter><HideoutHubPage /></MemoryRouter></LocaleProvider>)
    expect(screen.getByRole('link', { name: /Круг сектантов/ })).toHaveAttribute('href', '/hideout/cultist-circle')
  })

  it('speaks English', () => {
    for (const [ru, en] of [
      ['Круг сектантов', 'Cultist Circle'], ['Положить в круг', 'Place in the circle'], ['разово', 'once'], ['можно повторять', 'repeatable'], ['один раз', 'once'], ['каждый раз', 'every time'],
      ['на барахолке не продаётся', 'not sold on the flea market'], ['Вместе с ним выпадет', 'Also drops'], ['Нужно для квестов и убежища', 'Needed for quests and the hideout'],
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
