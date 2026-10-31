import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import type { Item, RaidMode } from '../domain/types'

const state = vi.hoisted(() => ({ mode: 'pvp' as RaidMode, items: [] as Item[] }))
const tarkovJson = vi.hoisted(() => vi.fn())
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { items: state.items } }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: state.mode }) }))
vi.mock('../data/tarkovApi', () => ({ tarkovJson }))

const { TierListPanel } = await import('./TierListPanel')

const item = (id: string, extra: Partial<Item> & { flea?: Partial<Record<RaidMode, number>> } = {}): Item => {
  const { flea = {}, ...rest } = extra
  return {
    id, name: id, shortName: id, category: 'Бартер', description: '', width: 1, height: 1, types: ['barter'],
    prices: Object.entries(flea).map(([mode, price]) => ({ source: 'Барахолка', kind: 'flea' as const, mode: mode as RaidMode, price: price!, updatedAt: '' })),
    ...rest,
  }
}

const tier = (letter: string) => document.querySelector(`.tier-${letter}`) as HTMLElement

afterEach(() => {
  localStorage.clear()
  setRenderLanguage('ru')
  tarkovJson.mockReset()
  state.mode = 'pvp'
})

describe('«Тир-листы»', () => {
  it('puts loot into tiers by the price per slot of the chosen mode', () => {
    state.items = [item('LEDX', { flea: { pvp: 900_000, pve: 15_000 } }), item('Bolts', { width: 2, flea: { pvp: 30_000 } })]
    const { unmount } = render(<LocaleProvider><TierListPanel /></LocaleProvider>)
    expect(within(tier('s')).getByText('LEDX')).toBeTruthy()
    expect(within(tier('c')).getByText('Bolts')).toBeTruthy()
    expect(screen.getByText(/Цена за слот: лучшая цена продажи/)).toBeTruthy()
    unmount()
    state.mode = 'pve'
    render(<LocaleProvider><TierListPanel /></LocaleProvider>)
    expect(within(tier('c')).getByText('LEDX')).toBeTruthy()
  })

  it('loads helmet stats from the items file when the catalog has none', async () => {
    state.items = [item('Kiver', { types: ['helmet', 'wearable'], weight: 1.2, flea: { pvp: 43_000 } })]
    tarkovJson.mockResolvedValue({ data: { armorMaterials: { Aramid: { destructibility: 0.1875 } }, items: {
      Kiver: { id: 'Kiver', types: ['helmet', 'wearable'], properties: { class: 3, durability: 63, material: 'Aramid', zones: ['a', 'b', 'c'], deafening: 'High', ergoPenalty: -0.01, turnPenalty: -0.01, speedPenalty: 0 } },
    } } })
    render(<LocaleProvider><TierListPanel /></LocaleProvider>)
    fireEvent.click(screen.getByRole('tab', { name: 'Шлемы' }))
    expect(await screen.findByText('Кл.3 · 63 · −2%')).toBeTruthy()
    expect(tarkovJson).toHaveBeenCalledWith('regular/items')
    expect(within(tier('b')).getByText('Kiver')).toBeTruthy()
  })

  it('speaks English', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    state.items = [item('Headset', { types: ['headphones', 'wearable'], gear: { kind: 'headphones', distanceModifier: 1.135, distortion: 0.08, compressorGain: 3 } })]
    render(<LocaleProvider><TierListPanel /></LocaleProvider>)
    fireEvent.click(screen.getByRole('tab', { name: 'Headsets' }))
    expect(within(tier('s')).getByText('+13.5% · dist. 8%')).toBeTruthy()
    expect(screen.getByText(/Headsets: hearing distance first/)).toBeTruthy()
  })
})
