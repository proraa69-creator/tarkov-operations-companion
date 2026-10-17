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
/** The card at rest (the unfolded copy in .qc-pop comes after it). */
const rest = () => card().querySelector(':scope > .qc-main') as HTMLElement
const shownName = () => rest()?.querySelector('.qc-name')?.textContent

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(() => { setRenderLanguage('ru'); vi.unstubAllGlobals() })

describe('QuestConditionsCard', () => {
  it('shows one quest: its name, the maps as chips, the weapon picture, the parts as icons and a short line', () => {
    renderCard([patriot])
    expect(card().querySelector(':scope > .qc-head .stat-label')).toHaveTextContent('Сбор на рейд')
    expect(shownName()).toBe('Работа для патриота')
    expect([...rest().querySelectorAll('.qc-chip')].map((chip) => chip.textContent)).toEqual(['Улицы Таркова', 'Берег', '+1'])
    // the whole AK-12 (its default preset), then the scope and the suppressor
    expect(card().querySelector('.qc-weapon')).toHaveAttribute('src', 'https://assets.tarkov.dev/64c1510bda0f6d156000cc17-512.webp')
    expect([...rest().querySelectorAll('.is-mods .qc-icon')].map((icon) => icon.getAttribute('alt'))).toEqual(['Оптический прицел Валдай ПС-320 1x/6x', 'Глушитель 5.45x39 для АК-12'])
    expect(rest().querySelector('.qc-line')).toHaveTextContent('×10 · ЧВК')
    // a single quest: no list, no «ещё»
    expect(card().querySelector(':scope > .qc-head .qc-count')).toBeNull()
    expect(card().querySelector('.qc-list')).toBeNull()
  })

  it('«any of N» weapons: the first one and «+N-1»; any map is said so', () => {
    renderCard([shooter])
    expect(rest().querySelectorAll('.qc-weapon')).toHaveLength(1)
    expect(rest().querySelector('.qc-weapon-group .qc-more')).toHaveTextContent('+2')
    expect(rest().querySelector('.qc-chip')).toHaveTextContent('Любая карта')
    expect(rest().querySelector('.qc-line')).toHaveTextContent('×5 · Дикие · 40+ м')
  })

  it('hovering unfolds the card in place: its quest with all of its info, every other quest below as a full-size card', async () => {
    renderCard([patriot, dandies, shooter])
    const pop = card().querySelector('.qc-pop') as HTMLElement
    expect(pop).not.toHaveClass('is-open')
    expect(pop).toHaveAttribute('inert')
    // a touch does not unfold it
    fireEvent.pointerEnter(card(), { pointerType: 'touch' })
    expect(pop).not.toHaveClass('is-open')
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' })
    expect(pop).toHaveClass('is-open')
    expect(pop).not.toHaveAttribute('inert')
    // the card's own quest first, in full; the two others below it
    const first = shownName()
    const shownCard = pop.querySelector('.qc-card.is-shown') as HTMLElement
    expect(shownCard).toHaveClass('is-full')
    expect(shownCard.querySelector('.qc-name')).toHaveTextContent(first!)
    const listCards = [...pop.querySelectorAll('.qc-list .qc-card')] as HTMLElement[]
    expect(listCards.map((entry) => entry.querySelector('.qc-name')?.textContent).sort()).toEqual(['Работа для патриота', 'Стиляги', 'Тарковский стрелок. Часть 1'].filter((name) => name !== first).sort())
    // each one is a card of the main card's size and layout: name, the weapon picture (not a tiny icon), the maps, the line
    for (const entry of listCards) {
      expect(entry).toHaveClass('qc-main')
      expect(entry).not.toHaveClass('is-full')
      expect(entry.querySelector('.qc-gear')).not.toHaveClass('is-tiny')
      expect(entry.querySelector('.qc-chips')).not.toBeNull()
    }
    // pointing at a list card shows all of its info in place (both are rendered; the stylesheet shows one)
    expect(listCards.every((entry) => entry.classList.contains('is-expandable') && entry.querySelector('.qc-rest') && entry.querySelector('.qc-all'))).toBe(true)
    const patriotCard = [...pop.querySelectorAll('.qc-card')].find((entry) => entry.querySelector('.qc-name')?.textContent === 'Работа для патриота') as HTMLElement
    fireEvent.pointerEnter(patriotCard, { pointerType: 'mouse' })
    expect(patriotCard).toHaveClass('is-full')
    expect([...patriotCard.querySelectorAll('.qc-all .qc-chip')].map((chip) => chip.textContent)).toEqual(['Улицы Таркова', 'Берег', 'Эпицентр'])
    expect(patriotCard.querySelector('.qc-full-row.is-weapons .qc-weapon')).toHaveAttribute('src', 'https://assets.tarkov.dev/64c1510bda0f6d156000cc17-512.webp')
    expect(patriotCard.querySelectorAll('.qc-full-row.is-mods .qc-icon')).toHaveLength(2)
    // the card itself stays as it was
    expect(shownName()).toBe(first)
    fireEvent.pointerLeave(card(), { pointerType: 'mouse' })
    await waitFor(() => expect(pop).not.toHaveClass('is-open'))
  })

  it('a card with a lot of data shows the essentials at rest and «+N»; unfolded, one weapon «или любое из 3», every condition and map', () => {
    const many: Quest = { ...shooter, id: 'many', name: 'Много всего', objectiveDetails: [{ ...shooter.objectiveDetails![0], mapIds: ['streets-of-tarkov', 'shoreline', 'ground-zero'],
      conditions: { ...shooter.objectiveDetails![0].conditions, zoneNames: ['Причал'], bodyParts: [{ key: 'Head', name: 'голова' }] } }] }
    renderCard([many])
    // at rest: one weapon and «+2», two maps and «+1»
    expect(rest().querySelectorAll('.qc-weapon')).toHaveLength(1)
    expect(rest().querySelector('.qc-chip.is-more')).toHaveTextContent('+1')
    // no other quest: no «ещё», but hovering still unfolds the whole of it
    expect(card().querySelector(':scope > .qc-head .qc-count')).toBeNull()
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' })
    const full = card().querySelector('.qc-pop.is-open .qc-card.is-full') as HTMLElement
    // a choice is one example, never a long list (owner, 15.10.2026)
    expect(full.querySelectorAll('.is-weapons .qc-weapon')).toHaveLength(1)
    expect(full.querySelector('.is-weapons .qc-choice-more')).toHaveTextContent('или любое из 3')
    expect(full.querySelectorAll('.qc-chip')).toHaveLength(3)
    expect(full.querySelector('.qc-line')).toHaveTextContent('Причал')
  })

  it('a click on a list card opens its build and keeps it in the card', async () => {
    renderCard([patriot, dandies, shooter])
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' })
    const pop = card().querySelector('.qc-pop') as HTMLElement
    const target = [...pop.querySelectorAll('.qc-list .qc-card')][0] as HTMLElement
    const name = target.querySelector('.qc-name')!.textContent
    fireEvent.click(target)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: name! })).toBeInTheDocument()
    expect(pop).not.toHaveClass('is-open')
    expect(shownName()).toBe(name)
  })

  it('on touch, «ещё N» unfolds it; a tap outside folds it; a tapped card opens its build', async () => {
    renderCard([patriot, dandies, shooter])
    const more = within(card()).getAllByRole('button', { name: /ещё 2/ })[0]
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(card().querySelector('.qc-pop')).toHaveClass('is-open')
    fireEvent.pointerDown(document.body)
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    const tapped = card().querySelector('.qc-list .qc-card') as HTMLElement
    const name = tapped.querySelector('.qc-name')!.textContent!
    fireEvent.click(tapped)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name })).toBeInTheDocument()
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

  it('several gear options: the first and «или другой вариант из 2»; gear not to wear is never shown', async () => {
    const setup: Quest = { ...dandies, id: 'setup', name: 'Подстава', objectiveDetails: [{ ...dandies.objectiveDetails![0], conditions: {
      wearing: [[{ id: 'beanie0000000000000000aa', name: 'Шапка' }, { id: 'glasses000000000000000aa', name: 'Очки' }], [{ id: 'hat', name: 'Ушанка' }, { id: 'vest', name: 'Жилет' }]],
      notWearing: [{ id: 'helmet', name: 'Шлем' }],
    } }] }
    renderCard([setup])
    expect(rest().querySelector('.is-wearing .qc-more')).toHaveTextContent('+1')
    expect(rest().querySelector('.is-not-wearing')).toBeNull()
    expect(rest()).not.toHaveTextContent('Шлем')
    fireEvent.click(rest())
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelectorAll('.gs-part')).toHaveLength(2)
    expect(dialog).not.toHaveTextContent('Ушанка')
    expect(dialog.querySelector('.qc-choice-more')).toHaveTextContent('или другой вариант из 2')
    expect(dialog).not.toHaveTextContent('Нельзя надевать')
    expect(dialog).not.toHaveTextContent('Шлем')
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
    expect(card()).toHaveTextContent('Raid loadout')
    expect(within(card()).getAllByRole('button', { name: /1 more/ })[0]).toBeInTheDocument()
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' })
    const shooterCard = within(card().querySelector('.qc-pop') as HTMLElement).getByText('Тарковский стрелок. Часть 1').closest('button')!
    expect(shooterCard.querySelector('.qc-chip')).toHaveTextContent('Any map')
    expect(shooterCard.querySelector('.qc-line')).toHaveTextContent(/×5 · Scavs · 40\+ m/)
    fireEvent.click(shooterCard)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Weapon')
    expect(dialog).toHaveTextContent('or any of 3')
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

describe('«Сбор на рейд»: every variant of a choice on pointing at it (owner, 16.10.2026)', () => {
  const scopes: Quest = { ...patriot, id: 'scopes', name: 'Прицелы', objectiveDetails: [{ ...patriot.objectiveDetails![0], conditions: {
    weapons: [{ id: '6499849fc93611967b034949', name: 'АК-12' }],
    mods: [[{ id: '5c0517910db83400232ffee5', name: 'ПС-320' }], [{ id: 'eotech0000000000000000aa', name: 'EOTech EXPS3' }], [{ id: 'okp7000000000000000000aa', name: 'ОКП-7' }]],
  } }] }
  const popup = () => document.querySelector('.qc-variants') as HTMLElement | null
  const names = () => [...popup()!.querySelectorAll('.qc-variant-name')].map((node) => node.textContent)

  it('hovering a weapon of «any of N» lists every allowed weapon with its picture; leaving it closes the list', async () => {
    renderCard([shooter])
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' })
    const full = card().querySelector('.qc-pop.is-open .qc-card.is-full') as HTMLElement
    const example = full.querySelector('.is-weapons .qc-choice') as HTMLElement
    // still one example and «или любое из 3»
    expect(example.querySelectorAll('.qc-weapon')).toHaveLength(1)
    expect(example.querySelector('.qc-choice-more')).toHaveTextContent('или любое из 3')
    expect(popup()).toBeNull()
    fireEvent.pointerEnter(example.querySelector('.qc-weapon')!, { pointerType: 'mouse' })
    await waitFor(() => expect(popup()).not.toBeNull())
    // in <body>, never clipped by the card: a fixed list with its heading and all three
    expect(popup()!.parentElement).toBe(document.body)
    expect(popup()).toHaveAttribute('role', 'tooltip')
    expect(popup()!.querySelector('.qc-variants-title')).toHaveTextContent('Подходит любое из 3')
    expect(names().sort()).toEqual(['M700', 'Мосин', 'СВ-98'].sort())
    expect(popup()!.querySelectorAll('.qc-variant.is-weapon .qc-variant-weapon')).toHaveLength(3)
    expect(example).toHaveAttribute('aria-describedby', popup()!.id)
    // the pointer may cross into the list
    fireEvent.pointerLeave(example, { pointerType: 'mouse' })
    fireEvent.pointerEnter(popup()!, { pointerType: 'mouse' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(popup()).not.toBeNull()
    fireEvent.pointerLeave(popup()!, { pointerType: 'mouse' })
    await waitFor(() => expect(popup()).toBeNull())
  })

  it('scopes too: the card at rest shows one scope and «+2»; hovering it lists all three; Escape closes the list, the card stays unfolded', async () => {
    renderCard([scopes])
    const group = rest().querySelector('.qc-reqs .is-mods') as HTMLElement
    expect(group.querySelectorAll('.qc-icon')).toHaveLength(1)
    expect(group.querySelector('.qc-more')).toHaveTextContent('+2')
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' })
    const full = card().querySelector('.qc-pop.is-open .qc-card.is-shown') as HTMLElement
    const mods = full.querySelector('.qc-full-row.is-mods .qc-choice') as HTMLElement
    expect(mods.querySelector('.qc-choice-more')).toHaveTextContent('или любое из 3')
    fireEvent.pointerEnter(mods.querySelector('.qc-icon')!, { pointerType: 'mouse' })
    await waitFor(() => expect(popup()).not.toBeNull())
    expect(names().sort()).toEqual(['EOTech EXPS3', 'ОКП-7', 'Оптический прицел Валдай ПС-320 1x/6x'].sort())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(popup()).toBeNull()
    expect(card().querySelector('.qc-pop')).toHaveClass('is-open')
  })

  it('a single fixed weapon and a fixed set of parts: no list', async () => {
    renderCard([patriot])
    expect(card().querySelector('.qc-choice')).toBeNull()
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' })
    fireEvent.pointerEnter(rest().querySelector('.qc-weapon')!, { pointerType: 'mouse' })
    fireEvent.pointerEnter(rest().querySelector('.qc-icon')!, { pointerType: 'mouse' })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(popup()).toBeNull()
    expect(card()).not.toHaveTextContent('или любое')
  })

  it('a tap on the example at rest shows the list instead of opening the build', async () => {
    renderCard([shooter])
    const example = rest().querySelector('.qc-weapon-group.qc-choice') as HTMLElement
    fireEvent.pointerDown(example, { pointerType: 'touch' })
    fireEvent.click(example)
    expect(popup()).not.toBeNull()
    expect(names()).toHaveLength(3)
    expect(screen.queryByRole('dialog')).toBeNull()
    // a press outside closes it
    fireEvent.pointerDown(document.body)
    expect(popup()).toBeNull()
  })

  it('in the build dialog «или другой вариант из 2» is a button: the keyboard opens the list of the sets, Escape closes only the list', async () => {
    const setup: Quest = { ...dandies, id: 'setup', name: 'Подстава', objectiveDetails: [{ ...dandies.objectiveDetails![0], conditions: {
      wearing: [[{ id: 'beanie0000000000000000aa', name: 'Шапка' }, { id: 'glasses000000000000000aa', name: 'Очки' }], [{ id: 'hat', name: 'Ушанка' }, { id: 'vest', name: 'Жилет' }]],
    } }] }
    renderCard([setup])
    fireEvent.click(rest())
    const dialog = await screen.findByRole('dialog')
    const toggle = within(dialog).getByRole('button', { name: 'или другой вариант из 2' })
    fireEvent.focus(toggle)
    expect(popup()).not.toBeNull()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(popup()!.querySelector('.qc-variants-title')).toHaveTextContent('Подходит любой вариант из 2')
    const sets = [...popup()!.querySelectorAll('.qc-variants-sets > li')].map((set) => [...set.querySelectorAll('.qc-variant-name')].map((node) => node.textContent))
    expect(sets).toEqual([['Шапка Bomber', 'Очки RayBench'], ['Ушанка', 'Жилет']])
    // Enter on the button hides and shows it again
    fireEvent.click(toggle)
    expect(popup()).toBeNull()
    fireEvent.click(toggle)
    expect(popup()).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(popup()).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('speaks English', async () => {
    setRenderLanguage('en')
    renderCard([shooter])
    fireEvent.pointerEnter(card(), { pointerType: 'mouse' })
    const example = card().querySelector('.qc-pop.is-open .is-weapons .qc-choice') as HTMLElement
    fireEvent.pointerEnter(example, { pointerType: 'mouse' })
    await waitFor(() => expect(popup()).not.toBeNull())
    expect(popup()!.querySelector('.qc-variants-title')).toHaveTextContent('Any of 3 fits')
  })
})

describe('«Сбор на рейд»: the weapon large, the requirements beside or below it (owner, 16.10.2026)', () => {
  it('at rest and unfolded the weapon has its own place and the parts and gear sit together after it', () => {
    renderCard([patriot])
    const gear = rest().querySelector('.qc-gear') as HTMLElement
    expect(gear).toHaveClass('has-weapon')
    expect([...gear.children].map((child) => child.className)).toEqual(['qc-weapon-group', 'qc-reqs'])
    expect(gear.querySelector('.qc-weapon-group .qc-weapon')).toHaveAttribute('src', 'https://assets.tarkov.dev/64c1510bda0f6d156000cc17-512.webp')
    expect([...gear.querySelectorAll('.qc-reqs .is-mods .qc-icon')].map((icon) => icon.getAttribute('alt'))).toEqual(['Оптический прицел Валдай ПС-320 1x/6x', 'Глушитель 5.45x39 для АК-12'])
    const full = card().querySelector('.qc-pop .qc-card.is-full') as HTMLElement
    const build = full.querySelector('.qc-full-build') as HTMLElement
    expect(build).toHaveClass('has-weapon')
    expect(build.querySelector(':scope > .qc-full-row.is-weapons .qc-weapon')).not.toBeNull()
    expect(build.querySelector(':scope > .qc-full-reqs > .qc-full-row.is-mods')).toHaveTextContent('Модули на оружии')
    expect(build.querySelectorAll('.qc-full-reqs .is-mods .qc-icon')).toHaveLength(2)
  })

  it('gear without a weapon takes the whole row', () => {
    renderCard([dandies])
    const gear = rest().querySelector('.qc-gear') as HTMLElement
    expect(gear).not.toHaveClass('has-weapon')
    expect(gear.querySelector('.qc-weapon')).toBeNull()
    expect(gear.querySelectorAll('.qc-reqs .is-wearing .qc-icon')).toHaveLength(2)
  })
})

describe('«Сбор на рейд» on the Overview with real tarkov.dev quests', () => {
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
    const cards = [...card().querySelectorAll('.qc-pop .qc-card .qc-name')].map((entry) => entry.textContent)
    expect(cards.sort()).toEqual(['Работа для патриота', 'Стиляги', 'Тарковский стрелок. Часть 6'])
    const patriotCard = within(card().querySelector('.qc-pop') as HTMLElement).getByText('Работа для патриота').closest('button')!
    fireEvent.pointerEnter(patriotCard, { pointerType: 'mouse' })
    expect([...patriotCard.querySelectorAll('.qc-all .qc-chip')].map((chip) => chip.textContent)).toEqual(['Улицы Таркова', 'Берег', 'Эпицентр'])
    fireEvent.click(patriotCard)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('.qc-weapon-card')).toHaveTextContent('АК-12')
    expect(dialog).toHaveTextContent('ПС-320')
    expect(dialog).toHaveTextContent('Глушитель 5.45x39 для АК-12')
    expect(dialog).toHaveTextContent('×10')
  })
  it('«Текущие задания» lists these quests with the others (no section of their own); «Требования рейда» lists no weapon or gear', async () => {
    const { container } = await renderOverview()
    const tasks = container.querySelector('.current-tasks') as HTMLElement
    // owner, 15.10.2026: «Вот этот блок удали вообще. Сделай, как раньше было»
    expect(tasks.querySelector('.gear-section')).toBeNull()
    expect(tasks).not.toHaveTextContent('С условиями на снаряжение')
    const names = [...tasks.querySelectorAll('.quest-row strong')].map((node) => node.textContent)
    for (const name of ['Работа для патриота', 'Стиляги', 'Тарковский стрелок. Часть 6']) expect(names).toContain(name)
    // Only keys and the items to plant or mark (owner, 15.10.2026): the build is in «Сбор на рейд» alone.
    const needs = container.querySelector('.raid-needs') as HTMLElement
    expect(needs).not.toHaveTextContent('АК-12')
    expect(needs).not.toHaveTextContent('ПС-320')
  })
})
