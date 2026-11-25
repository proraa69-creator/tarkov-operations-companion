import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { LONG_PRESS_MS } from '../components/useHoverCard'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import type { Item, Quest, RaidMode } from '../domain/types'
import type { Barter } from '../data/economyApi'

const state = vi.hoisted(() => ({ mode: 'pvp' as RaidMode, items: [] as Item[], quests: [] as Quest[], barters: [] as Barter[], done: {} as Record<string, { taskId: string; status: 'completed'; source: 'manual'; updatedAt: string }> }))
const tarkovJson = vi.hoisted(() => vi.fn())
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { items: state.items, quests: state.quests }, refresh: () => {} }), useTarkovDataStatus: () => ({ isFetching: false, updatedAt: Date.now() - 5 * 60_000 }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: state.mode, activeProfile: { modes: { [state.mode]: { taskProgress: state.done, faction: 'unknown', prestige: 0, playerLevel: 30 } } } }) }))
// This mode's barters (economy snapshot), and the item's full card as a plain box (its own tests are elsewhere)
vi.mock('../data/useEconomy', () => ({ useEconomySnapshot: (mode: RaidMode) => ({ data: { mode, barters: state.barters } }) }))
vi.mock('../components/ItemDrawer', () => ({ ItemDrawer: ({ item, extra, onClose }: { item: Item; extra?: import('react').ReactNode; onClose: () => void }) => <div data-testid="item-drawer"><h2>{item.name}</h2>{extra}<button type="button" onClick={onClose}>×</button></div> }))
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
// as in the app: the query cache (the weapons tab reads «Сборка оружия»'s catalogue) and the router (its menu opens it)
const open = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><LocaleProvider><TierListPanel /></LocaleProvider></MemoryRouter></QueryClientProvider>)

afterEach(() => {
  localStorage.clear()
  setRenderLanguage('ru')
  tarkovJson.mockReset()
  state.mode = 'pvp'
  state.quests = []
  state.barters = []
  state.done = {}
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

  // Owner, 20.11.2026: «функция опустить, поднять забрало правой кнопкой должно быть в тир-листе… с поднятым забралом характеристики
  // пишутся без забрала, с опущенным забралом — с забралом… Одна кнопка, которая меняется в зависимости от положения».
  describe('a helmet’s visor, down and raised', () => {
    const KILLA = '5c0e874186f7745dc7616606'
    const VISOR = '5c0e842486f77443a74d2976'
    const killa = () => item(KILLA, {
      name: 'Маска-1Щ Killa', shortName: 'Maska Killa', types: ['helmet', 'wearable'], weight: 2.6,
      gear: {
        kind: 'helmet', armorClass: 4, durability: 108, material: 'ArmoredSteel', zones: 3, speedPenalty: 0, turnPenalty: -0.01, ergoPenalty: -0.04,
        deafening: 'High', blocksHeadset: false, faceClass: 6, visorId: VISOR, ricochet: 0.9,
        visor: { armorClass: 6, durability: 50, zones: 3, ricochet: 0.9, speedPenalty: 0, turnPenalty: 0, ergoPenalty: -0.13, weight: 1.1 },
      },
    })
    const kiver = () => item('Kiver', { types: ['helmet', 'wearable'], gear: { kind: 'helmet', armorClass: 3, durability: 63, zones: 3, faceClass: 0, ricochet: 0.2 } })
    const visorItem = () => item(VISOR, { name: 'Забрало Killa', shortName: 'Забрало Killa', types: ['glasses', 'wearable'] })
    const fact = (card: HTMLElement, label: string) => within(card).getByText(label).nextSibling?.textContent
    const picture = () => tile('Maska Killa').querySelector('img')!.getAttribute('src')

    it('a right click gives one button that lowers or raises it; the picture, the level and the card change, the tier stays', async () => {
      state.items = [killa(), kiver(), visorItem()]
      open()
      fireEvent.click(screen.getByRole('tab', { name: 'Шлемы' }))
      expect(within(tier('s')).getByText('Maska Killa')).toBeTruthy()
      expect(picture()).toMatch(new RegExp(`${KILLA}\\.down\\.webp`))
      expect(within(tile('Maska Killa')).getByText('6LvL · 108')).toBeTruthy()
      // the picture shows them together: no visor beside it
      expect(tile('Maska Killa').querySelector('.tier-tile-visor')).toBeNull()

      fireEvent.contextMenu(tile('Maska Killa'), { clientX: 120, clientY: 140 })
      expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((button) => button.textContent)).toEqual(['Поднять забрало'])
      fireEvent.click(screen.getByRole('menuitem', { name: 'Поднять забрало' }))
      expect(screen.queryByRole('menu')).toBeNull()
      expect(picture()).toMatch(new RegExp(`${KILLA}\\.up\\.webp`))
      expect(within(tile('Maska Killa')).getByText('4LvL · 108')).toBeTruthy()
      expect(within(tier('s')).getByText('Maska Killa')).toBeTruthy()
      await userEvent.hover(tile('Maska Killa'))
      let card = await screen.findByRole('tooltip')
      expect(fact(card, 'Уровень')).toBe('4LvL')
      expect(fact(card, 'Забрало')).toBe('Забрало Killa · поднято')
      expect(fact(card, 'Зоны попадания')).toBe('3')
      expect(fact(card, 'Рикошет')).toBe('высокий')
      // the game counts a raised visor's penalties and weight
      expect(fact(card, 'Скорость · эрг. · поворот')).toBe('0% · −17% · −1%')
      expect(fact(card, 'Вес')).toBe('3.7 кг')
      expect(within(card).queryByText('Уровень с забралом')).toBeNull()
      expect(card.querySelector('img')!.getAttribute('src')).toMatch(/\.up\.webp/)
      await userEvent.unhover(tile('Maska Killa'))

      fireEvent.contextMenu(tile('Maska Killa'), { clientX: 120, clientY: 140 })
      fireEvent.click(screen.getByRole('menuitem', { name: 'Опустить забрало' }))
      expect(picture()).toMatch(/\.down\.webp/)
      await userEvent.hover(tile('Maska Killa'))
      card = await screen.findByRole('tooltip')
      expect(fact(card, 'Уровень с забралом')).toBe('6LvL')
      expect(fact(card, 'Забрало')).toBe('Забрало Killa · 6LvL')
      expect(fact(card, 'Зоны попадания')).toBe('6')
      expect(fact(card, 'Скорость · эрг. · поворот')).toBe('0% · −17% · −1%')
    })

    it('only the photographed helmets have the menu; the rest keep the browser’s and the card', () => {
      state.items = [killa(), kiver(), visorItem()]
      open()
      fireEvent.click(screen.getByRole('tab', { name: 'Шлемы' }))
      expect(fireEvent.contextMenu(tile('Kiver'))).toBe(true)
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('a phone: the long press shows the card, the lifted finger the button', async () => {
      vi.useFakeTimers()
      try {
        state.items = [killa(), visorItem()]
        open()
        fireEvent.click(screen.getByRole('tab', { name: 'Шлемы' }))
        const helmet = tile('Maska Killa')
        fireEvent.pointerDown(helmet, { pointerType: 'touch', clientX: 10, clientY: 10 })
        act(() => { vi.advanceTimersByTime(LONG_PRESS_MS) })
        expect(screen.getByRole('tooltip')).toBeTruthy()
        // Android's own menu on a held finger does not open ours
        fireEvent.contextMenu(helmet)
        expect(screen.queryByRole('menu')).toBeNull()
        fireEvent.pointerUp(helmet, { pointerType: 'touch', clientX: 10, clientY: 10 })
        expect(screen.queryByRole('tooltip')).toBeNull()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Поднять забрало' }))
        expect(tile('Maska Killa').querySelector('img')!.getAttribute('src')).toMatch(/\.up\.webp/)
      } finally {
        vi.useRealTimers()
      }
    })

    it('speaks English', () => {
      localStorage.setItem('tarkov-operations-locale-v1', 'en')
      state.items = [killa(), visorItem()]
      open()
      fireEvent.click(screen.getByRole('tab', { name: 'Helmets' }))
      fireEvent.contextMenu(tile('Maska Killa'), { clientX: 120, clientY: 140 })
      fireEvent.click(screen.getByRole('menuitem', { name: 'Raise the visor' }))
      fireEvent.contextMenu(tile('Maska Killa'), { clientX: 120, clientY: 140 })
      expect(screen.getByRole('menuitem', { name: 'Lower the visor' })).toBeTruthy()
    })
  })

  describe('what an item is needed for, and its full card (owner 26.11.2026, report 243)', () => {
    const grip = () => item('grip', { name: 'Пистолетная рукоятка Magpul MOE для АК (FDE) с очень длинным названием', shortName: 'MOE AK', types: ['mods'], flea: { pvp: 20_000 } })
    const quests = (): Quest[] => [
      { id: 'gs-aks', name: 'Оружейник. АКС-74Н', trader: 'Механик', level: 10, kappa: false, description: '', objectives: [], rewards: [], objectiveDetails: [{ id: 'o', type: 'buildWeapon', description: '', count: 1, build: { weaponId: 'aks74n', partIds: ['grip'], attributes: [] } }] },
      { id: 'supply', name: 'Поставка', trader: 'Терапевт', level: 5, kappa: false, description: '', objectives: [], rewards: [], raidRequirements: [{ itemId: 'grip', count: 2, purpose: 'handover', mapIds: [], foundInRaid: true, objectiveId: 'h' }] },
      { id: 'plant', name: 'Закладка', trader: 'Прапор', level: 3, kappa: false, description: '', objectives: [], rewards: [], raidRequirements: [{ itemId: 'grip', count: 1, purpose: 'place', mapIds: [], objectiveId: 'p' }] },
    ]
    const barters = (): Barter[] => [{ id: 'b1', traderId: 'prapor', traderName: 'Прапор', level: 2, requiredItems: [{ itemId: 'grip', count: 2 }], rewardItems: [{ itemId: 'reward', count: 1 }] }]

    it('a module’s hover card names its Gunsmith parts, the other quests (hand over, plant) and the barters; a completed quest says so', async () => {
      state.items = [grip(), item('reward', { name: 'Автомат АКМ', shortName: 'АКМ' })]
      state.quests = quests()
      state.barters = barters()
      state.done = { plant: { taskId: 'plant', status: 'completed', source: 'manual', updatedAt: '' } }
      open()
      fireEvent.click(screen.getByRole('tab', { name: 'Модули оружия' }))
      await userEvent.hover(tile('MOE AK'))
      const card = await screen.findByRole('tooltip')
      expect(within(card).getByText('Пистолетная рукоятка Magpul MOE для АК (FDE) с очень длинным названием')).toBeTruthy()
      expect(within(card).getByText('Нужен для квестов')).toBeTruthy()
      const rows = [...card.querySelectorAll('.item-needs li')].map((row) => row.textContent)
      expect(rows).toEqual(['Поставкасдать 2 · FIR', 'Оружейник. АКС-74Нобязательно', 'Закладкавыполнен', 'Прапор 2 · АКМ×2'])
      expect(within(card).getByText('Нужен для бартеров')).toBeTruthy()
    })

    it('a click (or Enter) opens the item’s full card with every quest linked; an item needed for nothing has no such rows', async () => {
      state.items = [grip(), item('Bolts', { name: 'Болты', types: ['mods'], flea: { pvp: 5_000 } })]
      state.quests = quests()
      open()
      fireEvent.click(screen.getByRole('tab', { name: 'Модули оружия' }))
      await userEvent.hover(tile('Bolts'))
      expect((await screen.findByRole('tooltip')).querySelector('.item-needs')).toBeNull()
      fireEvent.click(tile('MOE AK'))
      const drawer = screen.getByTestId('item-drawer')
      expect(within(drawer).getByRole('link', { name: 'Оружейник. АКС-74Н' }).getAttribute('href')).toBe('/gunsmith?quest=gs-aks')
      expect(within(drawer).getByRole('link', { name: 'Поставка' }).getAttribute('href')).toBe('/quests?filter=all&selected=supply')
      fireEvent.click(within(drawer).getByRole('button', { name: '×' }))
      expect(screen.queryByTestId('item-drawer')).toBeNull()
      fireEvent.keyDown(tile('Bolts'), { key: 'Enter' })
      expect(within(screen.getByTestId('item-drawer')).getByText('Болты')).toBeTruthy()
    })

    it('in English', async () => {
      localStorage.setItem('tarkov-operations-locale-v1', 'en')
      state.items = [grip(), item('reward', { name: 'AKM', shortName: 'AKM' })]
      state.quests = quests()
      state.barters = barters()
      open()
      fireEvent.click(screen.getByRole('tab', { name: 'Weapon mods' }))
      await userEvent.hover(tile('MOE AK'))
      const card = await screen.findByRole('tooltip')
      expect(within(card).getByText('Needed for quests')).toBeTruthy()
      expect(within(card).getByText('Needed for barters')).toBeTruthy()
      expect(within(card).getByText('hand over 2 · FIR')).toBeTruthy()
      expect(within(card).getByText('required')).toBeTruthy()
      expect(within(card).getByText('plant')).toBeTruthy()
    })
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
