import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import type { Item, RaidMode } from '../domain/types'

const state = vi.hoisted(() => ({ mode: 'pvp' as RaidMode, items: [] as Item[] }))
const tarkovJson = vi.hoisted(() => vi.fn())
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { items: state.items }, refresh: () => {} }), useTarkovDataStatus: () => ({ isFetching: false, updatedAt: Date.now() - 5 * 60_000 }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: state.mode }) }))
vi.mock('../data/tarkovApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../data/tarkovApi')>(), tarkovJson }))
// No server here: the catalog's prices and the catalog's ammo (the minute prices and the «Баллистика» rounds come from it).
vi.mock('../data/livePrices', async (importOriginal) => ({ ...await importOriginal<typeof import('../data/livePrices')>(), useLivePrices: () => null }))
vi.mock('../arsenal/ammoSource', async (importOriginal) => ({ ...await importOriginal<typeof import('../arsenal/ammoSource')>(), useAmmoStats: () => ({ data: undefined }) }))

const { TierListPanel } = await import('./TierListPanel')

const item = (id: string, extra: Partial<Item> & { flea?: Partial<Record<RaidMode, number>> } = {}): Item => {
  const { flea = {}, ...rest } = extra
  return {
    id, name: id, shortName: id, category: 'Бартер', description: '', width: 1, height: 1, types: ['barter'],
    iconUrl: `https://raidos.app/v1/item-images/${id}-icon.webp`,
    prices: Object.entries(flea).map(([mode, price]) => ({ source: 'Барахолка', kind: 'flea' as const, mode: mode as RaidMode, price: price!, updatedAt: '' })),
    ...rest,
  }
}

const tier = (letter: string) => document.querySelector(`.tier-${letter}`) as HTMLElement
const tile = (name: string) => screen.getByText(name).closest('.tier-tile') as HTMLElement
const open = () => render(<LocaleProvider><TierListPanel /></LocaleProvider>)

afterEach(() => {
  localStorage.clear()
  setRenderLanguage('ru')
  tarkovJson.mockReset()
  state.mode = 'pvp'
})

describe('«Тир листы»', () => {
  it('ranks each category by the flea price per slot of the chosen mode, with the time the prices came, and no texts over the board', () => {
    state.items = [
      ...Array.from({ length: 9 }, (_, index) => item(`Bolts${index}`, { flea: { pvp: 10_000 + index, pve: 5_000 } })),
      item('LEDX', { flea: { pvp: 900_000, pve: 1_000 } }),
      item('ETG', { types: ['injectors', 'meds'], flea: { pvp: 40_000 } }),
    ]
    const { unmount } = open()
    expect(within(tier('s')).getByText('LEDX')).toBeTruthy()
    expect(screen.queryByText('ETG')).toBeNull()
    expect(screen.getByText('обновлены 5 мин назад')).toBeTruthy()
    // Owner, 02.11.2026: «эти надписи нужно убрать везде».
    expect(document.body.textContent).not.toMatch(/Тиры внутри категории|приложение обновляет их|Наведите на предмет/)
    fireEvent.click(screen.getByRole('tab', { name: 'Инъекторы' }))
    expect(within(tier('s')).getByText('ETG')).toBeTruthy()
    unmount()
    state.mode = 'pve'
    open()
    expect(within(tier('d')).getByText('LEDX')).toBeTruthy()
  })

  it('shows a weapon whole with its price, and the app\'s hover card instead of the browser\'s tooltip', async () => {
    state.items = [item('627e14b21713922ded6f2c15', { name: 'Снайперская винтовка AXMC', shortName: 'AXMC', types: ['gun'], presetImageUrl: 'https://assets.tarkov.dev/62973e474bb5ab23071c2a70-512.webp', flea: { pvp: 359_999 } })]
    open()
    fireEvent.click(screen.getByRole('tab', { name: 'Оружие' }))
    const axmc = tile('AXMC')
    expect(axmc.querySelector('img')?.getAttribute('src')).toMatch(/62973e474bb5ab23071c2a70-grid/)
    expect(axmc.textContent).toMatch(/359\s999 ₽/)
    expect(axmc.textContent).not.toMatch(/слот/)
    expect(axmc.getAttribute('title')).toBeNull()
    await userEvent.hover(axmc)
    const card = await screen.findByRole('tooltip')
    expect(within(card).getByText('Снайперская винтовка AXMC')).toBeTruthy()
    expect(within(card).getByText('Цена на барахолке').nextSibling?.textContent).toMatch(/359\s999 ₽/)
  })

  it('drops an item whose picture does not load, a figurine aside (owner: «предметы без картинок … убери кроме фигурок»)', () => {
    state.items = [
      item('bolts', { flea: { pvp: 10_000 } }),
      item('horse', { name: 'Статуэтка коня', normalizedName: 'horse-figurine', shortName: 'Конь', flea: { pvp: 50_000 } }),
      item('nopic', { iconUrl: undefined, flea: { pvp: 20_000 } }),
    ]
    open()
    expect(screen.queryByText('nopic')).toBeNull()
    fireEvent.error(tile('bolts').querySelector('img')!)
    expect(screen.queryByText('bolts')).toBeNull()
    fireEvent.error(tile('Конь').querySelector('img')!)
    expect(tile('Конь').querySelector('.tier-no-icon')).toBeTruthy()
  })

  it('lists helmets by level with the visor from the items file when the catalog has no stats: «3LvL», no price list', async () => {
    state.items = [item('Kiver', { types: ['helmet', 'wearable'], weight: 1.2, flea: { pvp: 43_000 } })]
    tarkovJson.mockResolvedValue({ data: { armorMaterials: { Aramid: { destructibility: 0.1875 } }, items: {
      Kiver: { id: 'Kiver', types: ['helmet', 'wearable'], properties: { class: 3, durability: 63, material: 'Aramid', zones: ['a', 'b', 'c'], deafening: 'High', ergoPenalty: -0.01, turnPenalty: -0.01, speedPenalty: 0 } },
    } } })
    open()
    fireEvent.click(screen.getByRole('tab', { name: 'Шлемы' }))
    expect(await screen.findByText('3LvL · 63')).toBeTruthy()
    expect(tarkovJson).toHaveBeenCalledWith('regular/items')
    expect(within(tier('b')).getByText('Kiver')).toBeTruthy()
    expect(within(tier('s')).getByText('5–6LvL')).toBeTruthy()
    expect(within(tier('a')).getByText('4LvL')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'По цене за слот' })).toBeNull()
    expect(screen.queryByText(/Цены:/)).toBeNull()
    // owner, 04.11.2026: «не сильное, а сильно, не слабое, а слабо»
    await userEvent.hover(tile('Kiver'))
    expect(within(await screen.findByRole('tooltip')).getByText('Глушит звук').nextSibling?.textContent).toBe('сильно')
  })

  it('lists body armor by its plates\' level with no prices; the card says the plates\' level (owner, 02.11.2026)', async () => {
    state.items = [item('zhuk', { types: ['armor', 'wearable'], weight: 2.97, flea: { pvp: 300_000 }, gear: { kind: 'armor', armorClass: 6, durability: 305, zones: 12, material: 'Aramid', destructibility: 0.1875 } })]
    open()
    fireEvent.click(screen.getByRole('tab', { name: 'Бронежилеты' }))
    expect(within(tier('s')).getByText('zhuk')).toBeTruthy()
    expect(within(tier('s')).getByText('6LvL')).toBeTruthy()
    await userEvent.hover(tile('zhuk'))
    const card = await screen.findByRole('tooltip')
    expect(within(card).getByText('Уровень бронеплит').nextSibling?.textContent).toBe('6LvL')
    expect(card.textContent).not.toMatch(/Цена/)
    // owner, 04.11.2026: «убери надпись в бронежилетах с учетом износа и везде где она есть»
    expect(card.textContent).not.toMatch(/износа/i)
  })

  it('lists ammo by penetration as the «Баллистика» table does, with no grenades and no price', () => {
    const round = (id: string, penetration: number, extra: Partial<Item> = {}) => item(id, { category: 'Боеприпас', types: ['ammo'], caliber: 'Caliber556x45NATO', damage: 40, penetration, flea: { pvp: 1_000 }, ...extra })
    state.items = [round('SSA AP', 62), round('M855', 31), round('ВОГ-25', 1, { caliber: 'Caliber40x46' })]
    open()
    fireEvent.click(screen.getByRole('tab', { name: 'Патроны' }))
    expect(within(tier('s')).getByText('SSA AP')).toBeTruthy()
    expect(within(tier('s')).getByText('до 6LvL')).toBeTruthy()
    expect(within(tier('c')).getByText('M855')).toBeTruthy()
    expect(screen.queryByText('ВОГ-25')).toBeNull()
    expect(document.querySelector('.tier-board')?.textContent).not.toMatch(/₽/)
  })

  it('«Тир листы» in «Экономика» (02.11.2026): a block per category on top, the chosen one titles the board; no tarkov.dev in the texts', () => {
    state.items = [item('LEDX', { types: ['barter'], flea: { pvp: 900_000 } })]
    // «Рюкзаки» lists by cells: their stats come from the items file.
    tarkovJson.mockResolvedValue({ data: { items: {} } })
    open()
    const blocks = within(screen.getByRole('tablist', { name: 'Категории' })).getAllByRole('tab')
    expect(blocks).toHaveLength(16)
    expect(blocks[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Предметы')
    fireEvent.click(screen.getByRole('tab', { name: 'Рюкзаки' }))
    expect(screen.getByRole('tab', { name: 'Рюкзаки' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Рюкзаки')
    expect(document.body.textContent).not.toMatch(/tarkov\.dev/i)
  })

  it('speaks English', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    state.items = [item('Headset', { types: ['headphones', 'wearable'], gear: { kind: 'headphones', distanceModifier: 1.135, distortion: 0.08, compressorGain: 3 } })]
    open()
    fireEvent.click(screen.getByRole('tab', { name: 'Headsets' }))
    expect(within(tier('s')).getByText('+13.5% · dist. 8%')).toBeTruthy()
    await userEvent.hover(tile('Headset'))
    expect((await screen.findByRole('tooltip')).textContent).toContain('Hearing distance')
  })
})
