import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppDataset, Item, Quest, RaidMode } from '../domain/types'
import { demoDataset } from '../data/demo'
import { DataProvider } from '../data/DataProvider'
import { AppStateProvider } from '../state/AppState'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { installCatalogTranslations, setRenderLanguage } from '../i18n/renderText'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { DashboardPage } from './DashboardPage'
import { deferQuest, deferredQuestsKey, restoreDeferredQuests } from '../progression/deferredQuests'
import type { ItemUnlocks } from '../progression/itemUnlocks'
import { setDeferredFavorites } from '../progression/questDeferral'
import { setManualTraderLevel } from '../gunsmith/traderLevels'
import { useAppState } from '../state/AppState'

// «Сорвать сделку»: one stash objective that accepts any 7.62x51 pack (tarkov.dev ids and Russian names).
const PACKS: Array<[string, string]> = [
  ['65702566bfc87b3a3409324d', 'ТПЗ SP'], ['65702561cfc010a0f5006a28', 'БПЗ FMJ'], ['6570255dbfc87b3a3409324a', 'Ultra Nosler'],
  ['65702558cfc010a0f5006a25', 'M80'], ['65702554bfc87b3a34093247', 'M62 Tracer'], ['6570254fcfc010a0f5006a22', 'M61'],
  ['648984e3f09d032aa9399d53', 'M993'], ['6769b8e3c1a1466c850658a8', 'M80A1'],
]
const ELCAN: Array<[string, string]> = [['57ac965c24597706be5f975c', 'Оптический прицел ELCAN "SpecterDR 1x/4x"'], ['57aca93d2459771f2c7e26db', 'Оптический прицел ELCAN "SpecterDR 1x/4x" (FDE)']]
const item = (id: string, name: string, types: string[]): Item => ({ id, name, shortName: name, category: 'Бартер', description: '', types, prices: [] })
const task = (id: string, name: string, level: number, raidRequirements: Quest['raidRequirements']): Quest => ({
  id, name, trader: 'Барахольщик', mapId: 'customs', mapIds: ['customs'], level, kappa: false, description: '', objectives: [], rewards: [], raidRequirements,
})
const dataset: AppDataset = {
  ...demoDataset,
  quests: [
    ...demoDataset.quests,
    task('break-the-deal', 'Сорвать сделку', 12, PACKS.map(([itemId]) => ({ itemId, count: 1, purpose: 'place', mapIds: ['customs'], objectiveId: 'break-the-deal-stash', alternatives: PACKS.length }))),
    task('scope-stash', 'Оптика', 14, ELCAN.map(([itemId]) => ({ itemId, count: 1, purpose: 'place', mapIds: ['customs'], objectiveId: 'scope-stash-obj', alternatives: 2 }))),
  ],
  items: [
    ...demoDataset.items,
    ...PACKS.map(([id, name]) => item(id, `Пачка патронов 7.62x51мм ${name} (20 штук)`, ['ammoBox'])),
    ...ELCAN.map(([id, name]) => item(id, name, ['mods'])),
    // Favourites: a trader quote above the flea price (the old Math.max picked it), and an item priced only in PvE.
    { ...item('fav-odd', 'Флешка', ['barter']), prices: [
      { source: 'Барахолка', price: 36500, mode: 'pvp', updatedAt: '', kind: 'flea', basis: 'last-low' },
      { source: 'Терапевт', price: 40000, mode: 'pvp', updatedAt: '', kind: 'trader' },
    ] },
    { ...item('fav-pve', 'Тетрис', ['barter']), prices: [{ source: 'Барахолка', price: 410000, mode: 'pve', updatedAt: '', kind: 'flea' }] },
  ],
}
// «Дебют» is not in the log: «Проверка», which requires it, is current, so the chain counts «Дебют» as done.
const CUSTOMS_TASKS = ['checking', 'operation-aquarius', 'golden-swag', 'bp-depot', 'pharmacist', 'break-the-deal', 'scope-stash']
const point = (id: string, questId: string, objectiveId?: string): AppDataset['markers'][number] => ({
  id, mapId: 'customs', type: 'quest', title: id, description: '', position: [500, 500], questId, ...(objectiveId ? { objectiveId } : {}),
})
// Bug report №30: two Customs quests that plant Wi-Fi cameras (4 and 3), each with the point of its objective.
const CAMERA = 'wifi-camera'
const cameraQuest = (id: string, name: string, level: number, count: number) => task(id, name, level, [{ itemId: CAMERA, count, purpose: 'place', mapIds: ['customs'], objectiveId: `${id}-plant` }])
const camerasData: AppDataset = {
  ...dataset,
  quests: [...dataset.quests, cameraQuest('cameras-reminds', 'Что-то это мне напоминает..', 20, 4), cameraQuest('cameras-watch', 'Наблюдатель', 21, 3)],
  items: [...dataset.items, item(CAMERA, 'Wi-Fi камера', ['barter'])],
  markers: [...dataset.markers, point('cameras-reminds-spot', 'cameras-reminds', 'cameras-reminds-plant'), point('cameras-watch-spot', 'cameras-watch', 'cameras-watch-plant')],
}
const CAMERA_TASKS = [...CUSTOMS_TASKS, 'cameras-reminds', 'cameras-watch']
// «Отложить квест» → «До уровня»: Mechanic sells the camera at loyalty 2 (character level 12), the flea from 15.
const MECHANIC = 'mechanic-test'
const traderData: AppDataset = { ...camerasData, traders: [...camerasData.traders, { id: MECHANIC, name: 'Механик', role: '', loyalty: 4, accent: '', levelPlayerLevels: [1, 12, 26, 40] }] }
const cameraUnlocks: ItemUnlocks = { mode: 'pvp', flea: { enabled: true, level: 15 }, items: new Map([[CAMERA, { noFlea: false, offers: [{ traderId: MECHANIC, loyalty: 2 }] }]]) }
// «Сбор на рейд»: a Customs quest that wants a weapon and a part.
const gearQuest: Quest = {
  ...task('gear-patriot', 'Работа для патриота', 15, []),
  objectiveDetails: [{ id: 'gear-o1', type: 'shoot', description: '', count: 10, mapIds: ['customs'],
    conditions: { weapons: [{ id: 'ak-12', name: 'АК-12' }], mods: [[{ id: 'ps-320', name: 'ПС-320' }]], targets: [{ key: 'AnyPmc', name: 'любых бойцов ЧВК' }] } }],
}
const DAY = 24 * 60 * 60 * 1000
const probe: { app?: ReturnType<typeof useAppState> } = {}
function Probe() {
  const app = useAppState()
  useEffect(() => { probe.app = app })
  return null
}

function renderDashboard(favoriteItemIds?: string[], { data = dataset, tasks = CUSTOMS_TASKS, raidItemIds, deferred = {}, level, unlocks }: { data?: AppDataset; tasks?: string[]; raidItemIds?: string[]; deferred?: Partial<Record<RaidMode, string[]>>; level?: number; unlocks?: ItemUnlocks } = {}) {
  let profile = createLocalProfile('TEST', 'overview')
  if (favoriteItemIds) profile = { ...profile, modes: { ...profile.modes, pvp: { ...profile.modes.pvp, favoriteItemIds } } }
  if (raidItemIds) profile = { ...profile, modes: { ...profile.modes, pvp: { ...profile.modes.pvp, raidItemIds } } }
  // a level the game's screen showed
  if (level) profile = { ...profile, modes: { ...profile.modes, pvp: { ...profile.modes.pvp, playerLevel: level, levelAnchor: { level, observedAt: '2026-11-03T08:00:00.000Z', source: 'screen', checked: true } } } }
  for (const taskId of [...tasks, 'grenadier']) profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-10-08T10:00:00.000Z' })
  // «Отложенные квесты» of this profile, per mode
  for (const [mode, questIds] of Object.entries(deferred) as Array<[RaidMode, string[]]>) for (const questId of questIds) deferQuest(profile.id, mode, questId)
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['tarkov-companion-data', 'pvp'], data)
  if (unlocks) client.setQueryData(['raidos-item-unlocks', 'pvp'], unlocks)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><Probe /><DataProvider><MemoryRouter><DashboardPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => setRenderLanguage('ru'))

describe('DashboardPage', () => {
  it('puts «Приоритет карт» across the page under the cards and the raid requirements in the left column, with one row for any 7.62x51 pack', async () => {
    const { container } = renderDashboard()
    const priority = container.querySelector('.map-priority') as HTMLElement
    // the default rows: the cards, the strip under them, then the two columns
    expect([...container.querySelectorAll('.overview-rows > .overview-block')].map((row) => row.getAttribute('data-block'))).toEqual(['stats', 'priority', 'columns'])
    expect(priority.closest('[data-block]')).toHaveAttribute('data-block', 'priority')
    expect(priority.closest('.dashboard-layout')).toBeNull()
    expect(priority.querySelectorAll('.map-priority-tile')).toHaveLength(dataset.maps.length)
    const [left, right] = [...container.querySelectorAll('.dashboard-column')]
    const needs = left.querySelector('.raid-needs') as HTMLElement
    expect(needs).not.toBeNull()
    expect(right.querySelector('.raid-needs')).toBeNull()
    expect(within(needs).getByText('Любая пачка патронов 7.62x51')).toBeInTheDocument()
    expect(within(needs).queryByText(/M80 \(20 штук\)/)).toBeNull()
    // the two ELCAN colours: one row, the other colour in the row's hover card
    expect(within(needs).getAllByText(/ELCAN/)).toHaveLength(1)
    const elcan = within(needs).getByText(/ELCAN/).closest('a')!
    expect(elcan).toHaveTextContent('+1')
    expect(elcan).not.toHaveAttribute('title')
    fireEvent.mouseEnter(elcan)
    const card = await screen.findByRole('tooltip')
    expect(card).toHaveTextContent('Подходит и')
    expect(card.textContent?.match(/ELCAN/g)).toHaveLength(1)
    expect(card.parentElement).toBe(document.body)
    fireEvent.mouseLeave(elcan)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    // any 7.62x51 pack: every pack in the hover card
    fireEvent.mouseEnter(within(needs).getByText('Любая пачка патронов 7.62x51').closest('a')!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Пачка патронов 7.62x51мм M80A1 (20 штук)')
  })

  it('shows three current tasks of the map, «11 на Таможне»-style count and the rest behind «Ещё»', async () => {
    const user = userEvent.setup()
    const { container } = renderDashboard()
    const panel = container.querySelector('.current-tasks') as HTMLElement
    expect(within(panel).getByRole('link', { name: `${CUSTOMS_TASKS.length} на Таможне` })).toHaveClass('panel-title')
    const visible = [...panel.querySelectorAll(':scope > .panel-body > .quest-row strong')].map((node) => node.textContent)
    // earliest first (level, then chain depth), not catalog order
    expect(visible).toEqual(['Проверка', 'БП «Топливо»', 'Операция «Водолей»'])
    // four more tasks of Customs and «Гренадёр» from «Любая карта»
    const toggle = within(panel).getByRole('button', { name: /Ещё 5 заданий/ })
    await user.click(toggle)
    expect(panel.querySelector('.current-tasks-more')).toHaveClass('is-open')
    expect(within(panel).getByRole('button', { name: /Свернуть/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps the four stat cards in order; «Квесты» on the Kappa card opens the four key tasks for «Коллекционер»', async () => {
    const user = userEvent.setup()
    const { container } = renderDashboard()
    const cards = [...container.querySelectorAll('.stat-grid .stat-card')]
    expect(cards).toHaveLength(4)
    expect(cards[2]).toHaveClass('kappa-card')
    expect(cards[2]).toHaveTextContent('Выполнено 0 из 4')
    await user.click(within(cards[2] as HTMLElement).getByRole('button', { name: 'Квесты' }))
    const dialog = document.querySelector('[role=dialog]') as HTMLElement
    expect([...dialog.querySelectorAll('.kappa-quest strong')].map((node) => node.textContent))
      .toEqual(['Реагент. Часть 4', 'Стрелок от бога', 'Тарковский стрелок. Часть 4', 'Шить — не тужить. Часть 4'])
  })
  it('«Настроить блоки»: every block, the big map too, gets a handle, arrows move it within its zone, the order is kept and «Сбросить» restores it', async () => {
    const user = userEvent.setup()
    const { container, unmount } = renderDashboard()
    expect(container.querySelector('.overview-veil')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Настроить блоки/ }))
    expect(screen.getByRole('button', { name: /Готово/ })).toHaveAttribute('aria-pressed', 'true')
    // the four cards, the strip, the raid map and the two left blocks, the three right ones; only the rows stay put
    const handles = () => [...container.querySelectorAll('.overview-veil')].map((veil) => veil.closest('[data-block]')?.getAttribute('data-block'))
    expect(handles().sort()).toEqual(['favorites', 'gunsmith', 'priority', 'raid', 'requirements', 'squad', 'stat-goons', 'stat-kappa', 'stat-conditions', 'stat-tasks', 'tasks'].sort())
    expect(container.querySelector('.raid-card')!.closest('[data-block]')).toHaveAttribute('data-block', 'raid')
    // while editing, the content under a handle does not react
    expect(container.querySelector('[data-block="stat-kappa"] > .overview-block-content')).toHaveAttribute('inert')

    const veil = (id: string) => container.querySelector(`[data-block="${id}"] > .overview-veil`) as HTMLElement
    const order = (selector: string) => [...container.querySelectorAll(selector)].map((element) => element.getAttribute('data-block'))
    // the strip goes above the cards; the Kappa card one place to the left; the market to the top of the right column
    fireEvent.keyDown(veil('priority'), { key: 'ArrowUp' })
    fireEvent.keyDown(veil('stat-kappa'), { key: 'ArrowLeft' })
    fireEvent.keyDown(veil('favorites'), { key: 'ArrowUp' })
    fireEvent.keyDown(veil('favorites'), { key: 'ArrowUp' })
    // the raid map one place down, under the squad
    fireEvent.keyDown(veil('raid'), { key: 'ArrowDown' })
    expect(order('.dashboard-column:first-child > .overview-block')).toEqual(['squad', 'raid', 'requirements'])
    expect(order('.overview-rows > .overview-block')).toEqual(['priority', 'stats', 'columns'])
    expect(order('.stat-grid > .overview-block')).toEqual(['stat-tasks', 'stat-kappa', 'stat-conditions', 'stat-goons'])
    expect(order('.dashboard-column:last-child > .overview-block')).toEqual(['favorites', 'tasks', 'gunsmith'])
    expect(JSON.parse(localStorage.getItem('raidos-overview-layout-v1')!)).toMatchObject({ rows: ['priority', 'stats', 'columns'], left: ['squad', 'raid', 'requirements'], right: ['favorites', 'tasks', 'gunsmith'] })

    // «Готово» ends the editing; the order stays after a reload
    await user.click(screen.getByRole('button', { name: /Готово/ }))
    expect(container.querySelector('.overview-veil')).toBeNull()
    unmount()
    const again = renderDashboard()
    expect([...again.container.querySelectorAll('.stat-grid > .overview-block')].map((element) => element.getAttribute('data-block'))).toEqual(['stat-tasks', 'stat-kappa', 'stat-conditions', 'stat-goons'])
    await user.click(screen.getByRole('button', { name: /Настроить блоки/ }))
    await user.click(screen.getByRole('button', { name: /Сбросить/ }))
    expect([...again.container.querySelectorAll('.overview-rows > .overview-block')].map((row) => row.getAttribute('data-block'))).toEqual(['stats', 'priority', 'columns'])
    expect(localStorage.getItem('raidos-overview-layout-v1')).toBeNull()
    expect(screen.getByRole('button', { name: /Сбросить/ })).toBeDisabled()
  })

  it('market favourites show the PvP flea price (cheapest offer), not the highest quote nor another mode\'s price', () => {
    const { container } = renderDashboard(['fav-odd', 'fav-pve'])
    const rows = [...container.querySelectorAll('.market-favorites .item-row')].map((row) => row.textContent?.replace(/\s+/g, ' '))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('барахолка, минимальное предложение')
    expect(rows[0]).toMatch(/36 500 ₽/)
    expect(rows[0]).not.toMatch(/40 000/)
    expect(rows[1]).toContain('нет цены')
    expect(rows[1]).not.toMatch(/410 000/)
  })

  // Owner, 03.11.2026: «при нажатии на предмет в требованиях рейда, открываться должен квест на карте. в то место где нужно заложить предмет».
  it('«Требования рейда»: a row opens its quest on the raid map at the point of its objective; a hand-added item opens on the flea market', () => {
    // The 206 key: «Операция «Водолей»» (a point, not of the key's objective) comes first, «Проверка общежития» has the point of it.
    const data: AppDataset = {
      ...dataset,
      quests: [
        ...dataset.quests.map((quest) => (quest.id === 'operation-aquarius' ? { ...quest, raidRequirements: [{ itemId: 'dorm-206-key', count: 1, purpose: 'key' as const, mapIds: ['customs'], objectiveId: 'aquarius-water' }] } : quest)),
        task('dorm-check', 'Проверка общежития', 7, [{ itemId: 'dorm-206-key', count: 1, purpose: 'key', mapIds: ['customs'], objectiveId: 'dorm-check-room' }]),
      ],
      markers: [...dataset.markers, point('dorm-check-room', 'dorm-check', 'dorm-check-room'), point('scope-stash-spot', 'scope-stash', 'scope-stash-obj')],
    }
    const { container } = renderDashboard(undefined, { data, tasks: [...CUSTOMS_TASKS, 'dorm-check'], raidItemIds: ['ms2000'] })
    const needs = container.querySelector('.raid-needs') as HTMLElement
    const row = (text: string | RegExp) => within(needs).getByText(text).closest('a')!
    expect(row(/ELCAN/)).toHaveAttribute('href', '/maps/customs?quest=scope-stash&objective=scope-stash-obj')
    expect(row(/Ключ от комнаты 206/)).toHaveAttribute('href', '/maps/customs?quest=dorm-check&objective=dorm-check-room')
    // no point of «Сорвать сделку» on Customs: its window on the map
    expect(row('Любая пачка патронов 7.62x51')).toHaveAttribute('href', '/maps/customs?quest=break-the-deal')
    expect(row('Маркер MS2000')).toHaveAttribute('href', '/flea?selected=ms2000')
  })

  // Bug report №30 (0.6.0.204): «Если я отложил тот или иной квест … он все равно требует Wifi камеры на рейд … что бы он
  // показывал что нужно допустим 4 камеры на 1 квест, и 3 камеры на 2 квест, а то он все эти камеры миксует в одно».
  it('«Требования рейда»: an item of two quests shows the total and each quest\'s count, each line opening its own quest at its point', () => {
    const { container } = renderDashboard(undefined, { data: camerasData, tasks: CAMERA_TASKS })
    const needs = container.querySelector('.raid-needs') as HTMLElement
    const camera = within(needs).getByText('Wi-Fi камера ×7').closest('.raid-need') as HTMLElement
    expect(within(camera).getByRole('link', { name: 'Wi-Fi камера ×7' })).toHaveAttribute('href', '/maps/customs?quest=cameras-reminds&objective=cameras-reminds-plant')
    expect(within(camera).getByText('Взять и заложить')).toBeInTheDocument()
    expect(within(camera).getByRole('link', { name: '4 — Что-то это мне напоминает..' })).toHaveAttribute('href', '/maps/customs?quest=cameras-reminds&objective=cameras-reminds-plant')
    expect(within(camera).getByRole('link', { name: '3 — Наблюдатель' })).toHaveAttribute('href', '/maps/customs?quest=cameras-watch&objective=cameras-watch-plant')
    // an item of one quest keeps its one line and its one link
    const elcan = within(needs).getByText(/ELCAN/).closest('.raid-need') as HTMLElement
    expect(within(elcan).getAllByRole('link')).toHaveLength(1)
    expect(elcan).toHaveTextContent('Взять и заложить · Оптика')
    expect(needs.querySelector('.raid-needs-deferred')).toBeNull()
  })

  it('«Требования рейда»: a deferred quest brings nothing until it is returned, at once; put aside in PvE it still counts in PvP', () => {
    const { container } = renderDashboard(undefined, { data: camerasData, tasks: CAMERA_TASKS, deferred: { pvp: ['cameras-reminds'], pve: ['cameras-watch'] } })
    const needs = container.querySelector('.raid-needs') as HTMLElement
    const camera = () => (within(needs).queryByText(/^Wi-Fi камера/)?.closest('.raid-need') ?? null) as HTMLElement | null
    const deferredNote = () => needs.querySelector('.raid-needs-deferred')
    // «Наблюдатель» alone: its 3 cameras, its one line, its point
    expect(camera()).toHaveTextContent('Wi-Fi камера ×3')
    expect(camera()).toHaveTextContent('Взять и заложить · Наблюдатель')
    expect(camera()).not.toHaveTextContent('Что-то это мне напоминает')
    expect(within(camera()!).getByRole('link')).toHaveAttribute('href', '/maps/customs?quest=cameras-watch&objective=cameras-watch-plant')
    expect(deferredNote()).toHaveTextContent('Не учтены отложенные квесты: Что-то это мне напоминает..')

    // «Вернуть» in «Отложенные квесты»: its cameras are back without a restart
    act(() => restoreDeferredQuests('overview', 'pvp', ['cameras-reminds']))
    expect(camera()).toHaveTextContent('Wi-Fi камера ×7')
    expect(within(camera()!).getByRole('link', { name: '4 — Что-то это мне напоминает..' })).toBeInTheDocument()
    expect(deferredNote()).toBeNull()

    // both quests put aside: no camera at all
    act(() => { deferQuest('overview', 'pvp', 'cameras-reminds'); deferQuest('overview', 'pvp', 'cameras-watch') })
    expect(camera()).toBeNull()
    expect(deferredNote()).toHaveTextContent('Не учтены отложенные квесты: Что-то это мне напоминает.., Наблюдатель')
    expect(within(needs).getByText(/ELCAN/)).toBeInTheDocument()
  })

  it('«Требования рейда» in English: the purpose, each quest\'s count and the deferred quests', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    installCatalogTranslations([['Wi-Fi камера', 'WI-FI Camera'], ['Что-то это мне напоминает..', 'Something Reminds Me Of..'], ['Наблюдатель', 'The Watcher'], ['Оптика', 'Scope Stash']])
    try {
      const { container } = renderDashboard(undefined, { data: camerasData, tasks: CAMERA_TASKS, deferred: { pvp: ['scope-stash'] } })
      const needs = container.querySelector('.raid-needs') as HTMLElement
      const camera = within(needs).getByText('WI-FI Camera ×7').closest('.raid-need') as HTMLElement
      expect(within(camera).getByText('Take and plant')).toBeInTheDocument()
      expect(within(camera).getByRole('link', { name: '4 — Something Reminds Me Of..' })).toHaveAttribute('href', '/maps/customs?quest=cameras-reminds&objective=cameras-reminds-plant')
      expect(within(camera).getByRole('link', { name: '3 — The Watcher' })).toHaveAttribute('href', '/maps/customs?quest=cameras-watch&objective=cameras-watch-plant')
      expect(needs.querySelector('.raid-needs-deferred')).toHaveTextContent('Deferred quests not counted: Scope Stash')
      expect(within(needs).queryByText(/ELCAN/)).toBeNull()
    } finally {
      installCatalogTranslations([])
      vi.unstubAllGlobals()
    }
  })

  // Owner, 03.11.2026: «нажать на любой предмет ПКМ и отложить квест не открывая и не запоминая каждый квест… отладка по
  // времени, то можно выбрать 1-2-3-4-5-6-7 дней».
  it('«Отложить квест»: a right click on an item puts its quests aside for days, and they come back by themselves', () => {
    const { container } = renderDashboard(undefined, { data: camerasData, tasks: CAMERA_TASKS })
    const needs = container.querySelector('.raid-needs') as HTMLElement
    const camera = () => (within(needs).queryByText(/^Wi-Fi камера/)?.closest('.raid-need') ?? null) as HTMLElement | null
    fireEvent.contextMenu(camera()!, { clientX: 200, clientY: 150 })
    const menu = screen.getByRole('menu', { name: 'Меню предмета' })
    expect(menu).toHaveTextContent('Wi-Fi камера')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Отложить квест' }))
    expect(screen.queryByRole('menu')).toBeNull()
    const dialog = screen.getByRole('dialog', { name: /Отложить квест/ })
    // the item's two quests, both ticked, with how many each takes
    expect(within(dialog).getByRole('checkbox', { name: /Что-то это мне напоминает/ })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /Наблюдатель/ }).closest('label')).toHaveTextContent('Наблюдатель×3')
    // «По времени» first: 1 to 7 days
    expect(within(dialog).getByRole('radio', { name: 'По времени' })).toHaveAttribute('aria-checked', 'true')
    expect(within(dialog).getAllByRole('radio', { name: /^\d (день|дня|дней)$/ }).map((day) => day.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    fireEvent.click(within(dialog).getByRole('radio', { name: '3 дня' }))
    expect(dialog).toHaveTextContent(/Вернётся сам \d+ [а-я]+/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отложить (2)' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(probe.app!.favoriteItemIds).toContain(CAMERA)

    // no camera now; the term under the list; PvP only
    expect(camera()).toBeNull()
    expect(needs.querySelector('.raid-needs-deferred')).toHaveTextContent(/Не учтены отложенные квесты: Что-то это мне напоминает\.\. \(до .+\), Наблюдатель \(до .+\)/)
    const key = deferredQuestsKey('overview', 'pvp')
    const stored = JSON.parse(localStorage.getItem(key)!) as Record<string, { at: number; until: number }>
    expect(Object.keys(stored)).toEqual(['cameras-reminds', 'cameras-watch'])
    expect(stored['cameras-watch']!.until - stored['cameras-watch']!.at).toBe(3 * DAY)
    expect(localStorage.getItem(deferredQuestsKey('overview', 'pve'))).toBeNull()

    // the three days are over: both quests are back by themselves, and gone from «Отложенные квесты»
    act(() => {
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(stored).map(([id, entry]) => [id, { ...entry, until: 1 }]))))
      window.dispatchEvent(new Event('tarkov-deferred-quests-changed'))
    })
    expect(camera()).toHaveTextContent('Wi-Fi камера ×7')
    expect(needs.querySelector('.raid-needs-deferred')).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()
    // and the camera added for them leaves «Избранное» (owner, 03.11.2026: «когда убираешь квест из отложенных, предметы
    // добавленые в избранное должны удаляться»)
    expect(probe.app!.favoriteItemIds).not.toContain(CAMERA)
  })

  it('«Отложить квест» on a quest\'s line ticks that quest; «До уровня» says where the item opens and brings it back at that level', () => {
    const { container } = renderDashboard(undefined, { data: traderData, tasks: CAMERA_TASKS, level: 12, unlocks: cameraUnlocks })
    const needs = container.querySelector('.raid-needs') as HTMLElement
    const camera = () => (within(needs).queryByText(/^Wi-Fi камера/)?.closest('.raid-need') ?? null) as HTMLElement | null
    fireEvent.contextMenu(within(camera()!).getByRole('link', { name: '3 — Наблюдатель' }), { clientX: 200, clientY: 150 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Меню предмета' })).getByRole('menuitem', { name: 'Отложить квест' }))
    const dialog = screen.getByRole('dialog', { name: /Отложить квест/ })
    expect(within(dialog).getByRole('checkbox', { name: /Наблюдатель/ })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /Что-то это мне напоминает/ })).not.toBeChecked()

    fireEvent.click(within(dialog).getByRole('radio', { name: 'До уровня' }))
    expect(dialog).toHaveTextContent('Сейчас у персонажа в этом режиме 12 уровень.')
    // Mechanic at loyalty 2 needs level 12: the character has it, yet «Торговцы» shows loyalty 1 — still a term, the first
    const mechanic = within(dialog).getByRole('radio', { name: /Механик · лояльность 2/ })
    expect(mechanic).toBeEnabled()
    expect(mechanic).toBeChecked()
    expect(mechanic.closest('label')).toHaveTextContent('сейчас лояльность 1')
    expect(mechanic.closest('label')).not.toHaveTextContent('уже есть')
    expect(dialog).toHaveTextContent('Вернётся сам, когда у торговца Механик будет лояльность 2.')
    const flea = within(dialog).getByRole('radio', { name: /Барахолка/ })
    expect(flea.closest('label')).toHaveTextContent('с 15 уровня')
    fireEvent.click(flea)
    expect(dialog).toHaveTextContent('Вернётся сам, когда персонаж достигнет 15 уровня.')
    // an own level must be above the character's
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Уровень персонажа' }), { target: { value: '12' } })
    expect(within(dialog).getByRole('button', { name: 'Отложить' })).toBeDisabled()
    fireEvent.click(flea)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отложить' }))

    expect(camera()).toHaveTextContent('Wi-Fi камера ×4')
    expect(needs.querySelector('.raid-needs-deferred')).toHaveTextContent('Не учтены отложенные квесты: Наблюдатель (до 15 уровня)')
    expect(JSON.parse(localStorage.getItem(deferredQuestsKey('overview', 'pvp'))!)['cameras-watch']).toMatchObject({ level: 15 })
    // level 14 is not enough; 15 brings it back by itself
    expect(probe.app!.favoriteItemIds).toContain(CAMERA)
    act(() => probe.app!.raisePlayerLevel('pvp', 14))
    expect(camera()).toHaveTextContent('Wi-Fi камера ×4')
    act(() => probe.app!.raisePlayerLevel('pvp', 15))
    expect(camera()).toHaveTextContent('Wi-Fi камера ×7')
    expect(localStorage.getItem(deferredQuestsKey('overview', 'pvp'))).toBeNull()
    expect(probe.app!.favoriteItemIds).not.toContain(CAMERA)
  })

  // Owner, 03.11.2026: «уровень лояльности расходится в блоках» — the window said «уже есть» for Therapist 2 by the level
  // alone while «Торговцы» showed Therapist I.
  it('«До уровня» goes by the loyalty «Торговцы» shows: not there yet, the quest waits for it; there, it is no term', () => {
    const { container, unmount } = renderDashboard(undefined, { data: traderData, tasks: CAMERA_TASKS, level: 12, unlocks: cameraUnlocks })
    const camera = () => (within(document.querySelector('.raid-needs') as HTMLElement).queryByText(/^Wi-Fi камера/)?.closest('.raid-need') ?? null) as HTMLElement | null
    const open = () => {
      fireEvent.contextMenu(within(camera()!).getByRole('link', { name: '3 — Наблюдатель' }), { clientX: 200, clientY: 150 })
      fireEvent.click(within(screen.getByRole('menu', { name: 'Меню предмета' })).getByRole('menuitem', { name: 'Отложить квест' }))
      const dialog = screen.getByRole('dialog', { name: /Отложить квест/ })
      fireEvent.click(within(dialog).getByRole('radio', { name: 'До уровня' }))
      return dialog
    }
    fireEvent.click(within(open()).getByRole('button', { name: 'Отложить' }))
    expect(JSON.parse(localStorage.getItem(deferredQuestsKey('overview', 'pvp'))!)['cameras-watch']).toMatchObject({ loyalty: { traderId: MECHANIC, trader: 'Механик', level: 2 } })
    expect(container.querySelector('.raid-needs-deferred')).toHaveTextContent('Не учтены отложенные квесты: Наблюдатель (до лояльности 2 · Механик)')
    // a higher character level alone does not bring it back; Mechanic at loyalty 2 in «Торговцы» does
    act(() => probe.app!.raisePlayerLevel('pvp', 30))
    expect(camera()).toHaveTextContent('Wi-Fi камера ×4')
    act(() => setManualTraderLevel('pvp', 'механик', 2))
    expect(camera()).toHaveTextContent('Wi-Fi камера ×7')
    expect(localStorage.getItem(deferredQuestsKey('overview', 'pvp'))).toBeNull()
    expect(probe.app!.favoriteItemIds).not.toContain(CAMERA)
    unmount()

    // loyalty 2 already: «уже есть», no term; the flea is chosen
    localStorage.clear()
    setManualTraderLevel('pvp', 'механик', 2)
    renderDashboard(undefined, { data: traderData, tasks: CAMERA_TASKS, level: 12, unlocks: cameraUnlocks })
    const dialog = open()
    const mechanic = within(dialog).getByRole('radio', { name: /Механик · лояльность 2/ })
    expect(mechanic).toBeDisabled()
    expect(mechanic.closest('label')).toHaveTextContent('уже есть')
    expect(within(dialog).getByRole('radio', { name: /Барахолка/ })).toBeChecked()
  })

  it('«Предметы в избранное»: an item stays while another quest put aside needs it, and the player\'s own star always stays', () => {
    const { container, unmount } = renderDashboard(undefined, { data: camerasData, tasks: CAMERA_TASKS })
    const deferBoth = (needs: HTMLElement) => {
      fireEvent.contextMenu(within(needs).getByText('Wi-Fi камера ×7').closest('.raid-need')!, { clientX: 200, clientY: 150 })
      fireEvent.click(within(screen.getByRole('menu', { name: 'Меню предмета' })).getByRole('menuitem', { name: 'Отложить квест' }))
      fireEvent.click(within(screen.getByRole('dialog', { name: /Отложить квест/ })).getByRole('button', { name: 'Отложить (2)' }))
    }
    deferBoth(container.querySelector('.raid-needs') as HTMLElement)
    expect(probe.app!.favoriteItemIds).toContain(CAMERA)
    // «Вернуть» one of them: the other still needs the camera
    act(() => restoreDeferredQuests('overview', 'pvp', ['cameras-reminds']))
    expect(probe.app!.favoriteItemIds).toContain(CAMERA)
    act(() => restoreDeferredQuests('overview', 'pvp', ['cameras-watch']))
    expect(probe.app!.favoriteItemIds).not.toContain(CAMERA)
    unmount()

    // starred by the player before: his, it stays when the quests come back
    localStorage.clear()
    const view = renderDashboard([CAMERA], { data: camerasData, tasks: CAMERA_TASKS })
    deferBoth(view.container.querySelector('.raid-needs') as HTMLElement)
    act(() => restoreDeferredQuests('overview', 'pvp', ['cameras-reminds', 'cameras-watch']))
    expect(probe.app!.favoriteItemIds).toContain(CAMERA)
  })

  it('«Сбор на рейд»: a right click on a quest\'s gear puts that quest aside, and the card says so', () => {
    const data: AppDataset = { ...dataset, quests: [...dataset.quests, gearQuest], items: [...dataset.items, item('ak-12', 'Автомат АК-12', ['gun'])] }
    const { container } = renderDashboard(undefined, { data, tasks: [...CUSTOMS_TASKS, 'gear-patriot'] })
    const card = container.querySelector('.quest-conditions-card') as HTMLElement
    expect(card.querySelector(':scope > .qc-main .qc-name')).toHaveTextContent('Работа для патриота')
    fireEvent.contextMenu(card.querySelector(':scope > .qc-main [data-item-id="ak-12"]')!, { clientX: 300, clientY: 120 })
    const menu = screen.getByRole('menu', { name: 'Меню предмета' })
    expect(menu).toHaveTextContent('Автомат АК-12')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Отложить квест' }))
    const dialog = screen.getByRole('dialog', { name: /Отложить квест/ })
    // one quest: named, no ticks
    expect(dialog).toHaveTextContent('Квест: Работа для патриота')
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отложить' }))
    expect(card.querySelector('.qc-main')).toBeNull()
    expect(card).toHaveTextContent('Квесты этой карты со снаряжением отложены')
    expect(Object.keys(JSON.parse(localStorage.getItem(deferredQuestsKey('overview', 'pvp'))!))).toEqual(['gear-patriot'])
  })

  // Owner, 03.11.2026: «в этом блоке тоже нужно что бы правая кнопка мыши работала и можно было добавить отложеные»;
  // «предмет или ключ который требуется для квеста который отложен, сам добавлялся в избранное как напоминание».
  it('«Текущие задания»: a right click on a task puts that quest aside; it leaves the list and its item goes to «Избранное»', () => {
    const { container } = renderDashboard(undefined, { data: camerasData, tasks: CAMERA_TASKS })
    const tasks = container.querySelector('.current-tasks') as HTMLElement
    const row = (name: string) => (within(tasks).queryByText(name)?.closest('.quest-row') ?? null) as HTMLElement | null
    expect(probe.app!.favoriteItemIds).not.toContain(CAMERA)
    fireEvent.contextMenu(row('Наблюдатель')!, { clientX: 500, clientY: 200 })
    const menu = screen.getByRole('menu', { name: 'Меню предмета' })
    expect(menu).toHaveTextContent('Наблюдатель')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Отложить квест' }))
    const dialog = screen.getByRole('dialog', { name: /Отложить квест/ })
    // one quest, no ticks; its item is the one «До уровня» tells of
    expect(dialog).toHaveTextContent('Квест: Наблюдатель')
    expect(dialog).toHaveTextContent('Wi-Fi камера')
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    fireEvent.click(within(dialog).getByRole('radio', { name: '7 дней' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отложить' }))

    expect(row('Наблюдатель')).toBeNull()
    expect(row('Что-то это мне напоминает..')).not.toBeNull()
    expect(tasks).toHaveTextContent('Не показаны отложенные квесты: 1. Вернуть их — кнопка «Отложенные квесты» на карте.')
    expect(JSON.parse(localStorage.getItem(deferredQuestsKey('overview', 'pvp'))!)['cameras-watch'].until).toBeGreaterThan(Date.now() + 6 * DAY)
    // its camera is a reminder in «Избранное» now (one list for every mode, as with the star)
    expect(probe.app!.favoriteItemIds).toContain(CAMERA)
    expect(within(container.querySelector('.market-favorites') as HTMLElement).getByText('Wi-Fi камера')).toBeInTheDocument()
  })

  it('«Предметы в избранное» switched off: putting a quest aside adds nothing to «Избранное»', () => {
    setDeferredFavorites(false)
    const { container } = renderDashboard(undefined, { data: camerasData, tasks: CAMERA_TASKS })
    const needs = container.querySelector('.raid-needs') as HTMLElement
    fireEvent.contextMenu(within(needs).getByText('Wi-Fi камера ×7').closest('.raid-need')!, { clientX: 200, clientY: 150 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Меню предмета' })).getByRole('menuitem', { name: 'Отложить квест' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: /Отложить квест/ })).getByRole('button', { name: 'Отложить (2)' }))
    expect(within(needs).queryByText(/^Wi-Fi камера/)).toBeNull()
    expect(probe.app!.favoriteItemIds).not.toContain(CAMERA)
  })

  it('«Отложить квест» in English', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    installCatalogTranslations([['Wi-Fi камера', 'WI-FI Camera'], ['Что-то это мне напоминает..', 'Something Reminds Me Of..'], ['Наблюдатель', 'The Watcher'], ['Механик', 'Mechanic']])
    try {
      const { container } = renderDashboard(undefined, { data: traderData, tasks: CAMERA_TASKS, level: 12, unlocks: cameraUnlocks })
      const needs = container.querySelector('.raid-needs') as HTMLElement
      fireEvent.contextMenu(within(needs).getByText('WI-FI Camera ×7').closest('.raid-need')!, { clientX: 200, clientY: 150 })
      const menu = screen.getByRole('menu', { name: 'Item menu' })
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Defer quest' }))
      const dialog = screen.getByRole('dialog', { name: /Defer quest/ })
      expect(dialog).toHaveTextContent('Tasks that need this item — which to defer:')
      expect(within(dialog).getByRole('checkbox', { name: /The Watcher/ })).toBeChecked()
      fireEvent.click(within(dialog).getByRole('radio', { name: '2 days' }))
      expect(dialog).toHaveTextContent(/Comes back by itself on [A-Z][a-z]+ \d+/)
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Until a level' }))
      expect(dialog).toHaveTextContent('Your character in this mode is level 12 now.')
      expect(within(dialog).getByRole('radio', { name: /Flea market/ }).closest('label')).toHaveTextContent('from level 15')
      expect(within(dialog).getByRole('radio', { name: /Mechanic · loyalty 2/ }).closest('label')).toHaveTextContent('loyalty 1 now')
      expect(dialog).toHaveTextContent('Comes back by itself once Mechanic’s loyalty reaches 2.')
      fireEvent.click(within(dialog).getByRole('radio', { name: /Flea market/ }))
      expect(dialog).toHaveTextContent('Comes back by itself once your character reaches level 15.')
      expect(dialog).not.toHaveTextContent(/[А-Яа-яЁё]/)
      fireEvent.click(within(dialog).getByRole('button', { name: 'Defer (2)' }))
      expect(needs.querySelector('.raid-needs-deferred')).toHaveTextContent('Deferred quests not counted: Something Reminds Me Of.. (until level 15), The Watcher (until level 15)')
      expect(container.querySelector('.current-tasks')).toHaveTextContent('Deferred tasks not listed: 2. Bring them back with «Deferred quests» on the map.')
    } finally {
      installCatalogTranslations([])
      vi.unstubAllGlobals()
    }
  })
})
