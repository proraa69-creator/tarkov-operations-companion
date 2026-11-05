import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppDataset, Quest, RaidMode } from '../../domain/types'
import { demoDataset } from '../../data/demo'
import { DataProvider } from '../../data/DataProvider'
import { AppStateProvider } from '../../state/AppState'
import { LocaleProvider } from '../../i18n/LocaleProvider'
import { setRenderLanguage } from '../../i18n/renderText'
import { createLocalProfile, setTaskProgress } from '../../domain/progress'
import { QuestsPage } from '../../pages/QuestsPage'

const PRAPOR = '54cb50c76803fa8b248b4571'
const THERAPIST = '54cb57776803fa99248b456e'
const quest = (id: string, name: string, extra: Partial<Quest> = {}): Quest => ({
  id, name, nameRu: name, trader: 'Прапор', traderId: PRAPOR, level: 1, kappa: false, description: 'Задание от торговца.', objectives: [], rewards: [], requirements: [], ...extra,
})
const needs = (taskId: string, status: 'complete' | 'active' = 'complete') => ({ requirements: [{ taskId, allowedStatuses: [status] }] })

const quests: Quest[] = [
  quest('debut', 'Дебют', { unlock: { lines: [{ id: 'line-1', level: 1, order: 1, ll: 1 }] }, nameEn: 'Debut' }),
  quest('checking', 'Проверка на вшивость', { ...needs('debut'), kappa: true, level: 5, nameEn: 'Checking' }),
  quest('friend', 'Друг с запада', { ...needs('checking', 'active'), nameEn: 'Friend' }),
  quest('shortage', 'Дефицит', { trader: 'Терапевт', traderId: THERAPIST, ...needs('debut'), nameEn: 'Shortage' }),
]
const dataset: AppDataset = { ...demoDataset, quests, traders: demoDataset.traders }

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname}{location.search}</output>
}

function renderQuests(path: string, options: { locale?: 'ru' | 'en'; mode?: RaidMode; progress?: Array<[RaidMode, string, 'active' | 'completed' | 'failed']> } = {}) {
  let profile = createLocalProfile('TEST', 'tree')
  for (const [mode, taskId, status] of options.progress ?? []) profile = setTaskProgress(profile, mode, { taskId, status, source: 'eft-log', updatedAt: '2026-11-05T10:00:00.000Z' })
  if (options.mode) profile = { ...profile, selectedMode: options.mode }
  localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: profile.id, profiles: [profile] }))
  localStorage.setItem('tarkov-operations-locale-v1', options.locale ?? 'ru')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  for (const mode of ['pvp', 'pve', 'seasonal']) client.setQueryData(['tarkov-companion-data', mode], dataset)
  return render(<LocaleProvider><QueryClientProvider client={client}><AppStateProvider><DataProvider><MemoryRouter initialEntries={[path]}><QuestsPage /><Where /></MemoryRouter></DataProvider></AppStateProvider></QueryClientProvider></LocaleProvider>)
}

const card = (id: string) => document.querySelector(`.quest-tree-card[data-quest="${id}"]`) as HTMLElement

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => setRenderLanguage('ru'))

describe('the «Капа» tab', () => {
  it('is gone from the tabs', () => {
    renderQuests('/quests')
    const tabs = document.querySelector('.segmented-filter')!
    expect(within(tabs as HTMLElement).queryByRole('button', { name: 'Капа' })).toBeNull()
    expect(within(tabs as HTMLElement).getByRole('button', { name: 'Хронология' })).toBeInTheDocument()
  })

  it('an old link opens «Все» with the quest it asked for, and an unknown filter opens «Текущие»', () => {
    const old = renderQuests('/quests?filter=kappa&selected=checking')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Все задания')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Проверка на вшивость')
    old.unmount()
    renderQuests('/quests?filter=nothing')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Текущие задания')
  })
})

describe('the two buttons of «Хронология»', () => {
  it('opens on the catalog, the tree is one press away and back', () => {
    renderQuests('/quests?filter=chronology')
    const buttons = within(screen.getByTestId('quest-view-switch'))
    expect(buttons.getByRole('button', { name: 'Каталог заданий' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('.quest-chronology-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('quest-tree')).toBeNull()

    fireEvent.click(buttons.getByRole('button', { name: 'Дерево квестов' }))
    expect(screen.getByTestId('where')).toHaveTextContent('view=tree')
    expect(screen.getByTestId('quest-tree')).toBeInTheDocument()
    expect(document.querySelector('.quest-chronology-panel')).toBeNull()
    // the trader chips stand in for the page's list
    expect(document.querySelector('.quest-filter-bar select')).toBeNull()

    fireEvent.click(buttons.getByRole('button', { name: 'Каталог заданий' }))
    expect(screen.queryByTestId('quest-tree')).toBeNull()
    expect(document.querySelector('.quest-chronology-panel')).toBeInTheDocument()
  })

  it('the buttons are on «Хронология» only', () => {
    renderQuests('/quests?filter=all&view=tree')
    expect(screen.queryByTestId('quest-view-switch')).toBeNull()
    expect(screen.queryByTestId('quest-tree')).toBeNull()
  })
})

describe('«Дерево квестов»', () => {
  it('shows the quests of one trader with their links, and another trader\'s quest as a chip', () => {
    renderQuests('/quests?filter=chronology&view=tree')
    expect(card('debut')).toHaveTextContent('Дебют')
    expect(card('checking')).toHaveTextContent('Проверка на вшивость')
    expect(card('shortage')).toBeNull()
    expect(document.querySelector('.quest-tree-links path.is-active')).toBeInTheDocument()
    expect(document.querySelector('[data-quest-link="shortage"]')).toHaveTextContent('Терапевт: Дефицит')
    expect(screen.getByText('Ветка 1 · LL1')).toBeInTheDocument()
    expect(screen.getByText('Уровень 1')).toBeInTheDocument()
  })

  it('a press opens the quest\'s card beside the tree, and it closes', () => {
    renderQuests('/quests?filter=chronology&view=tree')
    expect(document.querySelector('.quest-tree-page')).not.toHaveClass('has-card')
    fireEvent.click(card('checking'))
    expect(screen.getByTestId('where')).toHaveTextContent('selected=checking')
    expect(document.querySelector('.quest-tree-page')).toHaveClass('has-card')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Проверка на вшивость')
    expect(card('checking')).toHaveClass('is-selected')
    // what comes before and after it lights up
    expect(card('debut')).toHaveClass('in-chain')
    expect(card('friend')).toHaveClass('in-chain')
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть карточку' }))
    expect(document.querySelector('.quest-tree-page')).not.toHaveClass('has-card')
  })

  it('a chip leads to the other trader\'s lane and its quest', () => {
    renderQuests('/quests?filter=chronology&view=tree')
    fireEvent.click(document.querySelector('[data-quest-link="shortage"]')!)
    expect(screen.getByTestId('where')).toHaveTextContent(`lane=${THERAPIST}`)
    expect(card('shortage')).toHaveClass('is-selected')
    expect(card('debut')).toBeNull()
    expect(document.querySelector('[data-quest-link="debut"]')).toHaveTextContent('Прапор: Дебют')
  })

  it('shows every trader on «Все»', () => {
    renderQuests('/quests?filter=chronology&view=tree')
    fireEvent.click(within(screen.getByTestId('quest-tree-lanes')).getByRole('button', { name: 'Все' }))
    for (const id of ['debut', 'checking', 'friend', 'shortage']) expect(card(id)).toBeInTheDocument()
  })

  it('statuses are the current mode\'s own', () => {
    const progress: Array<[RaidMode, string, 'active' | 'completed' | 'failed']> = [['pvp', 'debut', 'completed'], ['pvp', 'checking', 'active'], ['pve', 'debut', 'active']]
    const pvp = renderQuests('/quests?filter=chronology&view=tree', { progress })
    expect(card('debut')).toHaveClass('is-completed')
    expect(card('checking')).toHaveClass('is-active')
    expect(card('friend')).toHaveClass('is-available')
    pvp.unmount()
    const pve = renderQuests('/quests?filter=chronology&view=tree', { progress, mode: 'pve' })
    expect(card('debut')).toHaveClass('is-active')
    expect(card('checking')).not.toHaveClass('is-active')
    pve.unmount()
    renderQuests('/quests?filter=chronology&view=tree', { progress, mode: 'seasonal' })
    expect(card('debut')).not.toHaveClass('is-active')
    expect(card('debut')).not.toHaveClass('is-completed')
  })

  it('finds a quest, marks the matches and counts them', () => {
    renderQuests('/quests?filter=chronology&view=tree')
    fireEvent.change(screen.getByPlaceholderText('Поиск задания…'), { target: { value: 'вшивость' } })
    expect(screen.getByTestId('quest-tree-found')).toHaveTextContent('1 из 1')
    expect(card('checking')).toHaveClass('is-found', 'is-current-match')
    expect(card('debut')).not.toHaveClass('is-found')
    fireEvent.change(screen.getByPlaceholderText('Поиск задания…'), { target: { value: 'нет такого' } })
    expect(screen.getByTestId('quest-tree-found')).toHaveTextContent('Ничего не найдено')
  })

  it('a match in another trader\'s lane moves there', () => {
    renderQuests('/quests?filter=chronology&view=tree')
    fireEvent.change(screen.getByPlaceholderText('Поиск задания…'), { target: { value: 'дефицит' } })
    expect(screen.getByTestId('where')).toHaveTextContent(`lane=${THERAPIST}`)
    expect(card('shortage')).toHaveClass('is-current-match')
  })

  it('zooms with the buttons, within limits', () => {
    renderQuests('/quests?filter=chronology&view=tree')
    expect(screen.getByTestId('quest-tree-zoom-value')).toHaveTextContent('100%')
    fireEvent.click(screen.getByTestId('quest-tree-zoom-in'))
    expect(screen.getByTestId('quest-tree-zoom-value')).toHaveTextContent('120%')
    for (let press = 0; press < 12; press += 1) fireEvent.click(screen.getByTestId('quest-tree-zoom-out'))
    expect(screen.getByTestId('quest-tree-zoom-value')).toHaveTextContent('30%')
    expect(document.querySelector('.quest-tree-plane')).toHaveStyle({ transform: 'scale(0.3)' })
  })

  it('a dragged view stays on the same quest: the press is not a click', () => {
    renderQuests('/quests?filter=chronology&view=tree')
    const canvas = screen.getByTestId('quest-tree-canvas')
    fireEvent.pointerDown(canvas, { button: 0, clientX: 300, clientY: 200 })
    fireEvent.pointerMove(canvas, { clientX: 250, clientY: 150 })
    fireEvent.pointerUp(canvas)
    fireEvent.click(card('checking'))
    expect(screen.getByTestId('where')).not.toHaveTextContent('selected=')
  })

  it('in English', () => {
    renderQuests('/quests?filter=chronology&view=tree', { locale: 'en' })
    const buttons = within(screen.getByTestId('quest-view-switch'))
    expect(buttons.getByRole('button', { name: 'Task catalog' })).toBeInTheDocument()
    expect(buttons.getByRole('button', { name: 'Quest tree' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Line 1 · LL1')).toBeInTheDocument()
    expect(screen.getByText('Level 1')).toBeInTheDocument()
    const legend = screen.getByTestId('quest-tree-legend').textContent ?? ''
    expect(legend).not.toMatch(/[А-Яа-яЁё]/)
    expect(legend).toContain('Completed')
    expect(screen.getByRole('group', { name: 'Zoom' })).toBeInTheDocument()
  })
})

describe('on the phone', () => {
  const phone = (run: () => void) => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    window.dispatchEvent(new Event('resize'))
    try { run() } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      window.dispatchEvent(new Event('resize'))
    }
  }

  it('is an outline: each quest under the quest that opens it, a press opens the sheet', () => phone(() => {
    renderQuests('/quests?filter=chronology&view=tree')
    expect(screen.queryByTestId('quest-tree-canvas')).toBeNull()
    const outline = within(screen.getByTestId('quest-tree-outline'))
    const first = outline.getByRole('button', { name: /Дебют/ })
    const child = outline.getByRole('button', { name: /Проверка на вшивость/ })
    expect(first.style.marginLeft).toBe('0px')
    expect(child.style.marginLeft).toBe('12px')
    expect(outline.getByRole('button', { name: /открывает Терапевт: Дефицит/ })).toBeInTheDocument()
    fireEvent.click(child)
    expect(screen.getByRole('dialog')).toHaveTextContent('Проверка на вшивость')
  }))

  it('searches the whole tree', () => phone(() => {
    renderQuests('/quests?filter=chronology&view=tree')
    fireEvent.change(screen.getByPlaceholderText('Поиск задания…'), { target: { value: 'дефицит' } })
    const outline = within(screen.getByTestId('quest-tree-outline'))
    expect(outline.getByRole('button', { name: /^Дефицит/ })).toBeInTheDocument()
    expect(outline.queryByRole('button', { name: /^Дебют/ })).toBeNull()
  }))
})
