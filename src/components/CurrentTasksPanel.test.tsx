import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Quest } from '../domain/types'
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
})
