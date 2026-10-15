import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppDataset, GameMap, Item, Quest } from '../domain/types'
import { setRenderLanguage } from '../i18n/renderText'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { DataProvider } from '../data/DataProvider'
import { AppStateProvider } from '../state/AppState'
import { createLocalProfile, setTaskProgress } from '../domain/progress'
import { fetchLiveCatalog } from '../data/catalogSource'
import { conditionQuestsFetcher } from '../data/__fixtures__/conditionQuestsFeed'
import fixture from '../data/__fixtures__/tarkovDevConditionQuests.json'
import { DashboardPage } from '../pages/DashboardPage'
import { QuestConditionsCard } from './QuestConditionsCard'
import type { MapConditionQuests } from './questConditions'

const MAP: GameMap = { id: 'streets-of-tarkov', name: 'Улицы Таркова', subtitle: '', raidTime: 50, players: '', difficulty: 'Высокая', accent: '', markerCount: 0 }
const MAP_NAMES: Record<string, string> = { 'streets-of-tarkov': 'Улицы Таркова', shoreline: 'Берег', 'ground-zero': 'Эпицентр' }
const mapName = (id: string) => MAP_NAMES[id] ?? id
const item = (id: string, name: string, shortName = name): Item => ({ id, name, shortName, category: 'Оружие', description: '', prices: [], iconUrl: `https://assets.tarkov.dev/${id}-icon.webp` })
const ITEMS = [
  { ...item('6499849fc93611967b034949', 'Автомат Калашникова АК-12 5.45x39', 'АК-12'), presetImageUrl: 'https://assets.tarkov.dev/64c1510bda0f6d156000cc17-512.webp' },
  item('5c0517910db83400232ffee5', 'Оптический прицел Валдай ПС-320 1x/6x', 'ПС-320'),
  item('64c196ad26a15b84aa07132f', 'Глушитель 5.45x39 для АК-12', 'АК-12 Гл.'),
  item('beanie0000000000000000aa', 'Шапка Bomber', 'Bomber'),
  item('glasses000000000000000aa', 'Очки RayBench', 'RayBench'),
]
const patriot: Quest = {
  id: '64f5deac39e45b527a7c4232', name: 'Работа для патриота', trader: 'Прапор', level: 15, kappa: false, description: '', objectives: [], rewards: [],
  objectiveDetails: [{
    id: 'o1', type: 'shoot', description: 'Устранить бойцов ЧВК из АК-12 с оригинальным глушителем и прицелом Валдай ПС-320 1x/6x', count: 10,
    mapIds: ['streets-of-tarkov', 'shoreline', 'ground-zero'],
    conditions: {
      weapons: [{ id: '6499849fc93611967b034949', name: 'АК-12' }],
      mods: [[{ id: '5c0517910db83400232ffee5', name: 'ПС-320' }, { id: '64c196ad26a15b84aa07132f', name: 'Глушитель' }]],
      targets: [{ key: 'AnyPmc', name: 'любых бойцов ЧВК' }],
    },
  }],
}
const dandies: Quest = {
  id: 'dandies', name: 'Стиляги', trader: 'Барахольщик', level: 12, kappa: false, description: '', objectives: [], rewards: [],
  objectiveDetails: [{ id: 'o2', type: 'shoot', description: 'Устранить любые цели в шапке Bomber и очках RayBench', count: 5, mapIds: ['streets-of-tarkov'],
    conditions: { wearing: [[{ id: 'beanie0000000000000000aa', name: 'Шапка' }, { id: 'glasses000000000000000aa', name: 'Очки' }]], targets: [{ key: 'Any', name: 'любые цели' }] } }],
}
const shooter: Quest = {
  id: 'shooter', name: 'Тарковский стрелок. Часть 1', trader: 'Егерь', level: 2, kappa: true, description: '', objectives: [], rewards: [],
  objectiveDetails: [{ id: 'o3', type: 'shoot', description: '', count: 5,
    conditions: { weapons: [{ id: 'mosin', name: 'Мосин' }, { id: 'sv98', name: 'СВ-98' }, { id: 'm700', name: 'M700' }], distance: { compare: '>=', value: 40 }, targets: [{ key: 'Savage', name: 'Диких' }] } }],
}
const result = (quests: Quest[]): MapConditionQuests => ({ tier: quests.length ? 'active' : 'none', quests: quests.map((quest) => ({ quest, objectives: quest.objectiveDetails! })) })

function renderCard(quests: Quest[], pickKey = 'pvp:streets-of-tarkov', items = ITEMS) {
  const view = (keyOverride = pickKey, itemsOverride = items) => <MemoryRouter><QuestConditionsCard result={result(quests)} map={MAP} mapName={mapName} items={itemsOverride} pickKey={keyOverride} /></MemoryRouter>
  const rendered = render(view())
  return { ...rendered, rerenderWith: (key?: string, list?: Item[]) => rendered.rerender(view(key, list)) }
}
const card = () => document.querySelector('.quest-conditions-card') as HTMLElement
const shownName = () => card().querySelector('.qc-main .qc-name')?.textContent

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(() => { setRenderLanguage('ru'); vi.unstubAllGlobals() })

describe('QuestConditionsCard', () => {
  it('shows one quest: its name, the maps as chips, the weapon picture, the parts as icons and a short line', () => {
    renderCard([patriot])
    expect(within(card()).getByText('Условия квестов')).toBeInTheDocument()
    expect(shownName()).toBe('Работа для патриота')
    expect([...card().querySelectorAll('.qc-main .qc-chip')].map((chip) => chip.textContent)).toEqual(['Улицы Таркова', 'Берег', '+1'])
    // the whole AK-12 (its default preset), then the scope and the suppressor
    expect(card().querySelector('.qc-weapon')).toHaveAttribute('src', 'https://assets.tarkov.dev/64c1510bda0f6d156000cc17-512.webp')
    expect([...card().querySelectorAll('.qc-main .is-mods .qc-icon')].map((icon) => icon.getAttribute('alt'))).toEqual(['Оптический прицел Валдай ПС-320 1x/6x', 'Глушитель 5.45x39 для АК-12'])
    expect(card().querySelector('.qc-line')).toHaveTextContent('×10 · ЧВК')
    // a single quest: no list, no «ещё»
    expect(card().querySelector('.qc-count')).toBeNull()
    expect(card().querySelector('.qc-list')).toBeNull()
  })

  it('«any of N» weapons: the first one and «+N-1»; any map is said so', () => {
    renderCard([shooter])
    expect(card().querySelectorAll('.qc-main .qc-weapon')).toHaveLength(1)
    expect(card().querySelector('.qc-main .qc-weapon-group .qc-more')).toHaveTextContent('+2')
    expect(card().querySelector('.qc-main .qc-chip')).toHaveTextContent('Любая карта')
    expect(card().querySelector('.qc-line')).toHaveTextContent('×5 · Дикие · 40+ м')
  })

  it('hovering unfolds every quest below; a row shows its quest in the card; leaving folds it', async () => {
    renderCard([patriot, dandies, shooter])
    const list = card().querySelector('.qc-list') as HTMLElement
    expect(list).not.toHaveClass('is-open')
    expect(list).toHaveAttribute('inert')
    // a touch does not unfold it
    fireEvent.pointerEnter(card(), { pointerType: 'touch' })
    expect(list).not.toHaveClass('is-open')
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' })
    expect(list).toHaveClass('is-open')
    expect([...list.querySelectorAll('.qc-row strong')].map((row) => row.textContent)).toEqual(['Работа для патриота', 'Стиляги', 'Тарковский стрелок. Часть 1'])
    // each row: its maps and tiny pictures
    const dandiesRow = within(list).getByText('Стиляги').closest('button') as HTMLElement
    expect(dandiesRow.querySelectorAll('.qc-gear.is-tiny .qc-icon')).toHaveLength(2)
    fireEvent.pointerEnter(dandiesRow, { pointerType: 'mouse' })
    expect(shownName()).toBe('Стиляги')
    expect(dandiesRow).toHaveClass('is-shown')
    fireEvent.pointerLeave(card(), { pointerType: 'mouse' })
    await waitFor(() => expect(list).not.toHaveClass('is-open'))
    // the chosen quest stays in the card
    expect(shownName()).toBe('Стиляги')
  })

  it('on touch, «ещё N» unfolds the list; a tapped row is shown and the list folds; a tap outside folds it too', () => {
    renderCard([patriot, dandies, shooter])
    const more = within(card()).getByRole('button', { name: /ещё 2/ })
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(card().querySelector('.qc-list') as HTMLElement).getByText('Тарковский стрелок. Часть 1'))
    expect(shownName()).toBe('Тарковский стрелок. Часть 1')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    fireEvent.pointerDown(document.body)
    expect(more).toHaveAttribute('aria-expanded', 'false')
  })

  it('a click opens the build: the weapon large, the parts all together, every condition, «Открыть квест» and item links', async () => {
    renderCard([patriot])
    fireEvent.click(card().querySelector('.qc-main')!)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(within(dialog).getByRole('heading', { name: 'Работа для патриота' })).toBeInTheDocument()
    const weapon = dialog.querySelector('.qc-weapon-card') as HTMLAnchorElement
    expect(weapon).toHaveAttribute('href', '/flea?selected=6499849fc93611967b034949')
    expect(weapon.querySelector('img')).toHaveAttribute('src', 'https://assets.tarkov.dev/64c1510bda0f6d156000cc17-512.webp')
    const parts = dialog.querySelector('.qc-block:has(.gs-parts)') as HTMLElement
    expect(parts).toHaveTextContent('Модули на оружии')
    expect(parts).toHaveTextContent('все вместе')
    expect([...parts.querySelectorAll('.gs-part strong')].map((node) => node.textContent)).toEqual(['ПС-320', 'АК-12 Гл.'])
    const facts = Object.fromEntries([...dialog.querySelectorAll('.qc-facts div')].map((fact) => [fact.querySelector('dt')!.textContent, fact.querySelector('dd')!.textContent]))
    expect(facts).toEqual({ Убить: '×10', Противник: 'ЧВК', Карты: 'Улицы Таркова, Берег, Эпицентр' })
    expect(within(dialog).getByRole('link', { name: /Открыть квест/ })).toHaveAttribute('href', '/quests?selected=64f5deac39e45b527a7c4232')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('several gear options: each a variant; gear not to wear is crossed out', async () => {
    const setup: Quest = { ...dandies, id: 'setup', name: 'Подстава', objectiveDetails: [{ ...dandies.objectiveDetails![0], conditions: {
      wearing: [[{ id: 'beanie0000000000000000aa', name: 'Шапка' }, { id: 'glasses000000000000000aa', name: 'Очки' }], [{ id: 'hat', name: 'Ушанка' }, { id: 'vest', name: 'Жилет' }]],
      notWearing: [{ id: 'helmet', name: 'Шлем' }],
    } }] }
    renderCard([setup])
    expect(card().querySelector('.qc-main .is-wearing .qc-more')).toHaveTextContent('+1')
    expect(card().querySelector('.qc-main .is-not-wearing')).not.toBeNull()
    fireEvent.click(card().querySelector('.qc-main')!)
    const dialog = await screen.findByRole('dialog')
    expect([...dialog.querySelectorAll('.qc-option-label')].map((label) => label.textContent)).toEqual(['Вариант 1', 'Вариант 2'])
    expect(dialog).toHaveTextContent('Нельзя надевать')
    expect(dialog.querySelectorAll('.qc-part.is-banned')).toHaveLength(1)
  })

  it('no such quest on the map: a short line', () => {
    renderCard([])
    expect(card()).toHaveTextContent('На этой карте нет квестов с условиями на снаряжение')
    expect(card().querySelector('.qc-main')).toBeNull()
  })

  it('keeps the random pick on a re-render with fresh prices; another map picks again', () => {
    const view = renderCard([patriot, dandies, shooter], 'pvp:streets-of-tarkov')
    const first = shownName()
    view.rerenderWith('pvp:streets-of-tarkov', ITEMS.map((entry) => ({ ...entry, fleaPrice: 12345 })))
    expect(shownName()).toBe(first)
    const picks = new Set<string | null | undefined>()
    for (const map of ['customs', 'woods', 'shoreline', 'interchange', 'reserve', 'lighthouse', 'factory', 'ground-zero', 'labs', 'labyrinth']) {
      view.rerenderWith(`pvp:${map}`)
      picks.add(shownName())
    }
    expect(picks.size).toBeGreaterThan(1)
  })

  it('speaks English', () => {
    setRenderLanguage('en')
    renderCard([shooter, patriot])
    expect(card()).toHaveTextContent('Quest conditions')
    expect(within(card()).getByRole('button', { name: /1 more/ })).toBeInTheDocument()
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' })
    fireEvent.pointerEnter(within(card().querySelector('.qc-list') as HTMLElement).getByText('Тарковский стрелок. Часть 1').closest('button')!, { pointerType: 'mouse' })
    expect(card().querySelector('.qc-main .qc-chip')).toHaveTextContent('Any map')
    expect(card().querySelector('.qc-line')).toHaveTextContent('×5 · Scavs · 40+ m')
    fireEvent.click(card().querySelector('.qc-main')!)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Weapon')
    expect(dialog).toHaveTextContent('any one')
    expect(dialog).toHaveTextContent('Kill conditions')
    expect(dialog).toHaveTextContent('Distance')
    expect(within(dialog).getByRole('link', { name: /Open task/ })).toBeInTheDocument()
  })

  it('in English with nothing on the map', () => {
    setRenderLanguage('en')
    renderCard([])
    expect(card()).toHaveTextContent('No quests with gear conditions on this map')
  })
})

describe('«Условия квестов» on the Overview with real tarkov.dev quests', () => {
  async function renderOverview() {
    const catalog: AppDataset = await fetchLiveCatalog('pvp', 'ru', conditionQuestsFetcher(fixture as unknown as Record<string, unknown>), { wiki: async () => ({ titles: [], pages: [], storyQuests: [] }) })
    let profile = createLocalProfile('TEST', 'conditions-overview')
    profile = { ...profile, modes: { ...profile.modes, pvp: { ...profile.modes.pvp, playerLevel: 42 } } }
    // current in the game: «Работа для патриота», «Стиляги» (Streets) and «Тарковский стрелок. Часть 6» (any map); «Ловкач» is on Woods
    for (const taskId of ['64f5deac39e45b527a7c4232', '65734c186dc1e402c80dc19e', '5bc4856986f77454c317bea7', '60e729cf5698ee7b05057439']) {
      profile = setTaskProgress(profile, 'pvp', { taskId, status: 'active', source: 'eft-log', updatedAt: '2026-10-15T08:00:00.000Z' })
    }
    // done: never shown
    profile = setTaskProgress(profile, 'pvp', { taskId: '5c0bde0986f77479cf22c2f8', status: 'completed', source: 'eft-log', updatedAt: '2026-10-15T08:00:00.000Z' })
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
    localStorage.setItem('tarkov-operations-ui-v2', JSON.stringify({ selectedMapId: 'streets-of-tarkov' }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['tarkov-companion-data', 'pvp'], catalog)
    return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter><DashboardPage /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
  }

  it('replaces «Прогресс» in its slot and lists the current quests of Streets with their gear; «Работа для патриота» opens with its AK-12 build', async () => {
    const { container } = await renderOverview()
    const blocks = [...container.querySelectorAll('.stat-grid > .overview-block')].map((block) => block.getAttribute('data-block'))
    expect(blocks).toEqual(['stat-tasks', 'stat-conditions', 'stat-kappa', 'stat-goons'])
    expect(container.querySelector('[data-block="stat-conditions"] .quest-conditions-card')).not.toBeNull()
    expect(container.querySelector('.stat-grid')).not.toHaveTextContent('Прогресс')
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' })
    const rows = [...card().querySelectorAll('.qc-row strong')].map((row) => row.textContent)
    expect(rows.sort()).toEqual(['Работа для патриота', 'Стиляги', 'Тарковский стрелок. Часть 6'])
    fireEvent.pointerEnter(within(card().querySelector('.qc-list') as HTMLElement).getByText('Работа для патриота').closest('button')!, { pointerType: 'mouse' })
    expect(shownName()).toBe('Работа для патриота')
    expect([...card().querySelectorAll('.qc-main .qc-chip')].map((chip) => chip.textContent)).toEqual(['Улицы Таркова', 'Берег', '+1'])
    fireEvent.click(card().querySelector('.qc-main')!)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('.qc-weapon-card')).toHaveTextContent('АК-12')
    expect(dialog).toHaveTextContent('ПС-320')
    expect(dialog).toHaveTextContent('Глушитель 5.45x39 для АК-12')
    expect(dialog).toHaveTextContent('×10')
  })
})
