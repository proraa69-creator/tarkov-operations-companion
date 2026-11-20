import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HideoutStation, Item } from '../domain/types'
import type { Craft } from '../data/economyApi'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { HideoutView } from './HideoutView'

const MED = 'med-station'
const BENCH = 'work-bench'
const LIGHT = 'illumination'
const WALL = 'defective-wall'
const GYM = 'gym'
const BANDAGE = 'bandage'
const WIRE = 'wire'
const BOLTS = 'bolts'

const item = (id: string, name: string): Item => ({ id, name, shortName: name, category: 'Бартер', description: '', iconUrl: '', types: [], prices: [] }) as unknown as Item
const station = (id: string, name: string, levels: NonNullable<HideoutStation['levels']>): HideoutStation =>
  ({ id, name, level: 0, status: 'locked', requirements: [], bonus: '', levels }) as HideoutStation
const plain = (level: number) => ({ level, requirements: [], itemRequirements: [], bonus: '' })
const stations: HideoutStation[] = [
  station(MED, 'Медблок', [
    { level: 1, requirements: ['Бинт × 2'], itemRequirements: [{ itemId: BANDAGE, count: 2, foundInRaid: true }], bonus: '' },
    { level: 2, requirements: ['Провода × 3', 'Лояльность: Терапевт ур. 2'], stationRequirements: ['Верстак ур. 1'], itemRequirements: [{ itemId: WIRE, count: 3 }], bonus: '' },
  ]),
  station(BENCH, 'Верстак', [plain(1)]),
  station(LIGHT, 'Освещение', [plain(1), plain(2), plain(3)]),
  station(WALL, 'Аварийная стена', [plain(1), plain(2), plain(3), plain(4), plain(5), plain(6)]),
  station(GYM, 'Спортзал', [plain(1)]),
]
const crafts: Craft[] = [
  { id: 'wire-craft', stationId: BENCH, stationName: 'Верстак', level: 1, duration: 7200, requiredItems: [{ itemId: BOLTS, count: 2 }], rewardItems: [{ itemId: WIRE, count: 1 }] },
  { id: 'med-craft', stationId: MED, stationName: 'Медблок', level: 2, duration: 3600, requiredItems: [{ itemId: BANDAGE, count: 1 }], rewardItems: [{ itemId: BOLTS, count: 1 }] },
  { id: 'bandage-craft', stationId: BENCH, stationName: 'Верстак', level: 1, duration: 600, requiredItems: [{ itemId: WIRE, count: 3 }], rewardItems: [{ itemId: BANDAGE, count: 2 }] },
]
const barters = [{ id: 'bandage-barter', traderId: 'therapist', traderName: 'Терапевт', level: 1, requiredItems: [{ itemId: BOLTS, count: 1 }], rewardItems: [{ itemId: BANDAGE, count: 1 }] }]

const state = vi.hoisted(() => ({ levels: {} as Record<string, number>, setHideoutLevel: vi.fn() }))
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { items: [item(BANDAGE, 'Бинт'), item(WIRE, 'Провода'), item(BOLTS, 'Болты')], hideout: stations, quests: [] } }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp', activeProfile: { id: 'p1', modes: { pvp: { hideoutLevels: state.levels } } }, setHideoutLevel: state.setHideoutLevel }) }))
vi.mock('../data/useEconomy', () => ({ useEconomySnapshot: () => ({ data: { crafts, barters } }) }))
vi.mock('./hideoutViews', () => ({
  pictureSize: { width: 1000, height: 500 },
  lightStation: 'illumination',
  roomsInfo: { station: 'defective-wall', openLevel: 5, inside: ['gym', 'work-bench'], behind: ['gym'] },
  lightOf: (level: number) => Math.min(level, 3),
  basePicture: (light: number) => `base-L${light}.webp`,
  moduleSpot: (id: string) => ({ 'med-station': { x: 0.25, y: 0.5 }, 'work-bench': { x: 0.75, y: 0.4 }, gym: { x: 0.1, y: 0.1 } } as Record<string, { x: number; y: number }>)[id],
  modulePiece: (id: string, level: number, light: number) => (id === 'med-station' || id === 'gym' ? { url: `${id}-${level}-L${light}.webp`, left: 0.2, top: 0.4, width: 0.1, height: 0.2 } : undefined),
  roomsPicture: () => 'rooms.webp',
  christmasPiece: (light: number) => ({ url: `christmas-1-L${light}.webp`, left: 0.5, top: 0.5, width: 0.05, height: 0.1 }),
  christmasSeason: () => false,
  roomsClosed: (built: Record<string, number>) => (built['defective-wall'] ?? 0) < 5,
}))

const renderView = () => render(<LocaleProvider><MemoryRouter initialEntries={['/hideout']}><HideoutView /></MemoryRouter></LocaleProvider>)
const pictures = () => [...document.querySelectorAll('.hv-stage img.hv-picture, .hv-stage img.hv-piece')].map((image) => image.getAttribute('src'))

beforeEach(() => {
  localStorage.clear()
  state.levels = { [MED]: 1 }
  state.setHideoutLevel.mockReset()
})

describe('«Убежище» как в игре', () => {
  it('builds the picture from the base of the player\'s light and the pieces of the built levels, the closed rooms black', () => {
    state.levels = { [MED]: 2, [LIGHT]: 2, [GYM]: 1 }
    renderView()
    // the gym is in a room behind the wall, still closed: not there yet
    expect(pictures()).toEqual(['base-L2.webp', `${MED}-2-L2.webp`, 'rooms.webp'])
    const piece = document.querySelector(`img[src="${MED}-2-L2.webp"]`)
    expect(piece).toHaveStyle({ left: '20%', top: '40%', width: '10%', height: '20%' })
  })

  it('puts the Christmas tree up by a press, out of season too, and remembers it', () => {
    renderView()
    expect(pictures()).not.toContain('christmas-1-L0.webp')
    fireEvent.click(screen.getByRole('button', { name: /Ёлка/ }))
    expect(pictures()).toContain('christmas-1-L0.webp')
    expect(localStorage.getItem('raidos-hideout-christmas')).toBe('on')
  })

  it('opens the rooms behind the wall once it is broken', () => {
    state.levels = { [WALL]: 5, [GYM]: 1 }
    renderView()
    expect(pictures()).not.toContain('rooms.webp')
    expect(pictures()).toContain(`${GYM}-1-L0.webp`)
    expect(screen.getByRole('button', { name: /Спортзал/ })).toBeInTheDocument()
  })

  it('puts a button on every module with its level; a module behind the wall not broken yet has none', () => {
    renderView()
    const med = screen.getByRole('button', { name: /Медблок, уровень 1/ })
    expect(med).toHaveStyle({ left: '25%', top: '50%' })
    expect(within(med).getByText('01')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Верстак, не построен/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Спортзал/ })).not.toBeInTheDocument()
    // in the rooms' picture but built before the wall (the med station, rest space, booze generator): shown
    expect(screen.getByRole('button', { name: /Верстак, не построен/ })).toBeInTheDocument()
  })

  it('a module opens beside the picture; a level button shows that level alone and the module at it on the picture', () => {
    localStorage.setItem('raidos-hideout-found-v1:p1:pvp', JSON.stringify({ [WIRE]: 1 }))
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Медблок, уровень 1/ }))
    // the next level first: its needs only, not every level at once
    expect(screen.getAllByRole('heading', { name: /Для уровня/ }).map((heading) => heading.textContent)).toEqual(['Для уровня II'])
    expect(screen.getByRole('button', { name: /Провода/ })).toHaveTextContent('1/3')
    expect(screen.getByText(/Верстак ур. 1/)).toBeInTheDocument()
    expect(screen.getByText(/Лояльность: Терапевт ур. 2/)).toBeInTheDocument()
    expect(pictures()).toContain(`${MED}-2-L0.webp`)
    // the crafts of that level, by name and count: what goes in, what comes out
    const craft = document.querySelector('#hv-craft-med-craft')!
    expect(craft).toHaveTextContent('Нужно')
    expect(craft).toHaveTextContent('Бинт×1')
    expect(craft).toHaveTextContent('Получите')
    expect(craft).toHaveTextContent('Болты×1')
    // level I: built, the picture back at the player's own level
    fireEvent.click(screen.getByRole('tab', { name: /Уровень I$/ }))
    expect(screen.getAllByRole('heading', { name: /Для уровня/ }).map((heading) => heading.textContent)).toEqual(['Для уровня I построен'])
    expect(pictures()).toContain(`${MED}-1-L0.webp`)
    fireEvent.click(screen.getByRole('button', { name: /Снять уровень I/ }))
    expect(state.setHideoutLevel).toHaveBeenCalledWith(MED, 0)
    fireEvent.click(screen.getByRole('tab', { name: /Уровень II/ }))
    fireEvent.click(screen.getByRole('button', { name: /Построил II/ }))
    expect(state.setHideoutLevel).toHaveBeenLastCalledWith(MED, 2)
  })

  it('an item wanted found in raid says at once where it is crafted and from what, not the barters', () => {
    state.levels = {}
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Медблок, не построен/ }))
    expect(screen.getAllByRole('heading', { name: /Для уровня/ }).map((heading) => heading.textContent)).toEqual(['Для уровня I'])
    const bandage = screen.getByRole('button', { name: /Бинт/ }).closest('li')!
    expect(within(bandage).getByRole('button', { name: /Скрафтить: Верстак, ур. I ×2/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(bandage).getByText('Провода').closest('li')).toHaveTextContent('×3')
    expect(within(bandage).queryByText(/Обменять/)).toBeNull()
  })

  it('an item says where to get it, and the row opens what it takes', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Медблок/ }))
    fireEvent.click(screen.getByRole('button', { name: /Провода/ }))
    fireEvent.click(screen.getByRole('button', { name: /Скрафтить: Верстак, ур. I/ }))
    expect(screen.getByRole('link', { name: 'Открыть модуль' })).toHaveAttribute('href', `/hideout?module=${BENCH}&craft=wire-craft`)
    const wire = screen.getByRole('button', { name: /Провода/ }).closest('li')!
    expect(within(wire).getByText('Болты').closest('li')).toHaveTextContent('×2')
  })
})
