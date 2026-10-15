import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Item, Quest } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { CurrentTasksPanel } from './CurrentTasksPanel'

const quest = (index: number, extra: Partial<Quest> = {}): Quest => ({
  id: `q${index}`, name: `Задание ${index}`, trader: 'Прапор', level: index, kappa: false, description: '', objectives: [], rewards: [], ...extra,
})
const customs = { id: 'customs', name: 'Таможня' }

function renderPanel(quests: Quest[], anyMapQuests: Quest[] = [], map = customs) {
  return render(<LocaleProvider><MemoryRouter>
    <CurrentTasksPanel map={map} quests={quests} anyMapQuests={anyMapQuests} questLink={(entry) => `/maps/${map.id}?quest=${entry.id}`} />
  </MemoryRouter></LocaleProvider>)
}

const ak12: Item = { id: 'ak12', name: 'Автомат АК-12', shortName: 'АК-12', category: 'Оружие', description: '', prices: [], iconUrl: 'https://assets.tarkov.dev/ak12-icon.webp', presetImageUrl: 'https://assets.tarkov.dev/ak12-512.webp' }
const gearQuest = (index: number, extra: Partial<Quest> = {}) => quest(index, {
  objectiveDetails: [{ id: `o${index}`, type: 'shoot', description: 'Убить из АК-12', count: 5, mapIds: ['customs'], conditions: { weapons: [{ id: 'ak12', name: 'АК-12' }], targets: [{ key: 'AnyPmc', name: 'ЧВК' }] } }],
  ...extra,
})

function renderWithGear(quests: Quest[], anyMapQuests: Quest[], gear: Quest[]) {
  return render(<LocaleProvider><MemoryRouter>
    <CurrentTasksPanel map={customs} quests={quests} anyMapQuests={anyMapQuests} questLink={(entry) => `/maps/customs?quest=${entry.id}`}
      gear={{ quests: gear.map((entry) => ({ quest: entry, objectives: entry.objectiveDetails! })), items: [ak12], mapName: (id) => id === 'customs' ? 'Таможня' : id }} />
  </MemoryRouter></LocaleProvider>)
}

const rowNames = (root: ParentNode) => [...root.querySelectorAll('.quest-row strong')].map((node) => node.textContent)

afterEach(() => {
  localStorage.clear()
  setRenderLanguage('ru')
})

describe('CurrentTasksPanel', () => {
  it('shows three tasks and keeps the rest behind «Ещё»', () => {
    const { container } = renderPanel(Array.from({ length: 11 }, (_, index) => quest(index + 1)), [quest(40, { anyMap: true, kappa: true })])
    const body = container.querySelector('.panel-body')!
    const more = container.querySelector('.current-tasks-more')!
    expect(rowNames(body).slice(0, 3)).toEqual(['Задание 1', 'Задание 2', 'Задание 3'])
    // every task is rendered (the old list stopped at 10 while the badge said 11), the rest folded away
    expect(rowNames(more)).toEqual([...Array.from({ length: 8 }, (_, index) => `Задание ${index + 4}`), 'Задание 40'])
    expect(more).not.toHaveClass('is-open')
    expect(more).toHaveAttribute('inert')
    const toggle = screen.getByRole('button', { name: /Ещё 9 заданий/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', more.id)
  })

  it('opens the rest and folds it back', async () => {
    const user = userEvent.setup()
    const { container } = renderPanel(Array.from({ length: 5 }, (_, index) => quest(index + 1)))
    const more = container.querySelector('.current-tasks-more')!
    await user.click(screen.getByRole('button', { name: /Ещё 2 задания/ }))
    expect(more).toHaveClass('is-open')
    expect(more).not.toHaveAttribute('inert')
    const collapse = screen.getByRole('button', { name: /Свернуть/ })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await user.click(collapse)
    expect(more).not.toHaveClass('is-open')
    expect(more).toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: /Ещё 2 задания/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('has no «Ещё» for three tasks or fewer', () => {
    const { container } = renderPanel([quest(1), quest(2), quest(3)])
    expect(rowNames(container)).toHaveLength(3)
    expect(container.querySelector('.current-tasks-more')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps the «Любая карта» heading with its first visible task', () => {
    const { container } = renderPanel([quest(1)], [quest(21, { anyMap: true }), quest(22, { anyMap: true }), quest(23, { anyMap: true })])
    const more = container.querySelector('.current-tasks-more')!
    expect(container.querySelector('.current-tasks-group')?.closest('.current-tasks-more')).toBeNull()
    expect(container.querySelector('.current-tasks-group')).toHaveTextContent('Любая карта · 3')
    expect(rowNames(more)).toEqual(['Задание 23'])
    expect(screen.getByRole('button', { name: /Ещё 1 задание/ })).toBeInTheDocument()
  })

  it('names the map in the locative, in the heading’s type', () => {
    renderPanel(Array.from({ length: 11 }, (_, index) => quest(index + 1)))
    const where = screen.getByRole('link', { name: '11 на Таможне' })
    expect(where).toHaveClass('panel-title', 'current-tasks-where')
    expect(where).toHaveAttribute('href', '/maps/customs')
    expect(screen.queryByText(/на Таможня/)).toBeNull()
  })

  it('speaks English', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    renderPanel(Array.from({ length: 4 }, (_, index) => quest(index + 1)))
    expect(screen.getByText('Current tasks')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '4 on Customs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 more task$/ })).toBeInTheDocument()
  })

  it('moves the tasks with gear conditions to their own section at the bottom; the count stays; a click shows the build', async () => {
    const user = userEvent.setup()
    const patriot = gearQuest(2, { name: 'Работа для патриота' })
    const shooter = gearQuest(31, { name: 'Тарковский стрелок', anyMap: true, objectiveDetails: [{ ...gearQuest(31).objectiveDetails![0], mapIds: [] }] })
    const { container } = renderWithGear([quest(1), patriot, quest(3)], [quest(30, { anyMap: true }), shooter], [patriot, shooter])
    const main = [...container.querySelectorAll('.panel-body > .quest-row strong, .current-tasks-more .quest-row strong')].map((node) => node.textContent)
    expect(main).toEqual(['Задание 1', 'Задание 3', 'Задание 30'])
    expect(container.querySelector('.current-tasks-group')).toHaveTextContent('Любая карта · 1')
    // the count of the map's tasks is unchanged
    expect(screen.getByRole('link', { name: '3 на Таможне' })).toBeInTheDocument()
    const section = container.querySelector('.gear-section') as HTMLElement
    expect(section.querySelector('.gear-section-head')).toHaveTextContent('С условиями на снаряжение2')
    expect(section.parentElement?.lastElementChild).toBe(section)
    expect(rowNames(section)).toEqual(['Работа для патриота', 'Тарковский стрелок'])
    expect(section.querySelectorAll('.quest-row.is-gear .qc-weapon')).toHaveLength(2)
    expect(section).toHaveTextContent('Любая карта')
    await user.click(screen.getByRole('button', { name: /Работа для патриота/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Работа для патриота' })).toBeInTheDocument()
    expect(dialog.querySelector('.qc-weapon-card img')).toHaveAttribute('src', 'https://assets.tarkov.dev/ak12-512.webp')
    expect(dialog).toHaveTextContent('Таможня')
    expect(within(dialog).getByRole('link', { name: /Показать на карте/ })).toHaveAttribute('href', '/maps/customs?quest=q2')
  })

  it('names the gear section in English', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    const patriot = gearQuest(2)
    const { container } = renderWithGear([quest(1), patriot], [], [patriot])
    expect(container.querySelector('.gear-section-head')).toHaveTextContent('Gear conditions1')
    expect(container.querySelector('.gear-quest-button')).toHaveAttribute('title', 'Raid gear')
  })
})
