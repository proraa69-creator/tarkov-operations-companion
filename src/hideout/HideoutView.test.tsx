import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HideoutStation, Item } from '../domain/types'
import type { Craft } from '../data/economyApi'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { HideoutView } from './HideoutView'

const MED = 'med-station'
const BENCH = 'work-bench'
const BANDAGE = 'bandage'
const WIRE = 'wire'
const BOLTS = 'bolts'

const item = (id: string, name: string): Item => ({ id, name, shortName: name, category: 'Бартер', description: '', iconUrl: '', types: [], prices: [] }) as unknown as Item
const stations: HideoutStation[] = [
  { id: MED, name: 'Медблок', normalizedName: 'medstation', level: 0, status: 'locked', requirements: [], bonus: '', levels: [
    { level: 1, requirements: ['Бинт × 2'], itemRequirements: [{ itemId: BANDAGE, count: 2 }], bonus: '' },
    { level: 2, requirements: ['Провода × 3', 'Лояльность: Терапевт ур. 2'], stationRequirements: ['Верстак ур. 1'], itemRequirements: [{ itemId: WIRE, count: 3 }], bonus: '' },
  ] },
  { id: BENCH, name: 'Верстак', normalizedName: 'workbench', level: 0, status: 'locked', requirements: [], bonus: '', levels: [{ level: 1, requirements: [], itemRequirements: [], bonus: '' }] },
]
const crafts: Craft[] = [
  { id: 'wire-craft', stationId: BENCH, stationName: 'Верстак', level: 1, duration: 7200, requiredItems: [{ itemId: BOLTS, count: 2 }], rewardItems: [{ itemId: WIRE, count: 1 }] },
  { id: 'med-craft', stationId: MED, stationName: 'Медблок', level: 2, duration: 3600, requiredItems: [{ itemId: BANDAGE, count: 1 }], rewardItems: [{ itemId: BOLTS, count: 1 }] },
]

const state = vi.hoisted(() => ({ levels: {} as Record<string, number>, setHideoutLevel: vi.fn() }))
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { items: [item(BANDAGE, 'Бинт'), item(WIRE, 'Провода'), item(BOLTS, 'Болты')], hideout: stations, quests: [] } }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp', activeProfile: { id: 'p1', modes: { pvp: { hideoutLevels: state.levels } } }, setHideoutLevel: state.setHideoutLevel }) }))
vi.mock('../data/useEconomy', () => ({ useEconomySnapshot: () => ({ data: { crafts, barters: [] } }) }))
vi.mock('./hideoutViews', () => ({
  overviewPicture: () => 'overview.webp',
  overviewSize: { width: 1920, height: 1080 },
  moduleSpot: (id: string) => (id === MED ? { x: 0.25, y: 0.5 } : id === BENCH ? { x: 0.75, y: 0.4 } : undefined),
  modulePicture: (id: string, level: number) => `${id}-${level}.webp`,
}))

const renderView = () => render(<LocaleProvider><MemoryRouter initialEntries={['/hideout']}><HideoutView /></MemoryRouter></LocaleProvider>)

beforeEach(() => {
  localStorage.clear()
  state.levels = { [MED]: 1 }
  state.setHideoutLevel.mockReset()
})

describe('«Убежище» как в игре', () => {
  it('puts a button on every module of the overview, with its level', () => {
    renderView()
    const med = screen.getByRole('button', { name: /Медблок, уровень 1/ })
    expect(med).toHaveStyle({ left: '25%', top: '50%' })
    expect(within(med).getByText('I')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Верстак, не построен/ })).toBeInTheDocument()
  })

  it('a module opens its picture at the built level, what the next level takes and its crafts', () => {
    localStorage.setItem('raidos-hideout-found-v1:p1:pvp', JSON.stringify({ [WIRE]: 1 }))
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Медблок/ }))
    expect(screen.getByRole('img', { name: /Медблок · I/ })).toHaveAttribute('src', `${MED}-1.webp`)
    expect(screen.getByRole('heading', { name: /Для уровня II/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Провода/ })).toHaveTextContent('1/3')
    expect(screen.getByText(/Верстак ур. 1/)).toBeInTheDocument()
    expect(screen.getByText(/Лояльность: Терапевт ур. 2/)).toBeInTheDocument()
    expect(document.querySelector('#hv-craft-med-craft')).toHaveClass('is-locked')
    // another level picked shows its picture
    fireEvent.click(screen.getByRole('button', { name: 'II' }))
    expect(screen.getByRole('img', { name: /Медблок · II/ })).toHaveAttribute('src', `${MED}-2.webp`)
    fireEvent.click(screen.getByRole('button', { name: /Построил II/ }))
    expect(state.setHideoutLevel).toHaveBeenCalledWith(MED, 2)
  })

  it('an item says where to get it, and the row opens what it takes', () => {
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Медблок/ }))
    fireEvent.click(screen.getByRole('button', { name: /Провода/ }))
    const row = screen.getByRole('button', { name: /Скрафтить: Верстак, ур. I/ })
    fireEvent.click(row)
    expect(screen.getByRole('link', { name: 'Открыть модуль' })).toHaveAttribute('href', `/hideout?module=${BENCH}&craft=wire-craft`)
    expect(screen.getByText('Болты').closest('li')).toHaveTextContent('×2')
  })
})
