import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Quest } from '../domain/types'
import { QuestTextEditor, questTextFields } from './QuestTextEditor'

const quest: Quest = {
  id: 'q1', name: 'Посылка', trader: 'Прапор', description: 'Задание от торговца Прапор.', level: 1, kappa: false, rewards: [],
  objectives: ['Найти посылку'], objectiveIds: ['o1'], objectiveDetails: [{ id: 'o1', type: 'visit', description: 'Найти посылку', count: 1 }],
}
const story: Quest = {
  id: 'story-tour', name: 'Тур', trader: 'Сюжет', kind: 'story', description: 'Сюжетная глава.', level: 1, kappa: false, rewards: [], objectives: [],
  stages: [{ id: 's0', title: 'Начало', description: 'Выйти с базы', mapIds: ['customs'] }],
}

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'tarkovDesktop') })

/** The owner app signed in to the owner's account: the server keeps the corrections in `stored`. */
function ownerApp(stored: Array<Record<string, unknown>> = []) {
  const requests: Array<[string, string, unknown]> = []
  const serviceRequest = vi.fn(async (method: string, path: string, body?: unknown) => {
    requests.push([method, path, body])
    if (method === 'PUT') {
      const input = body as Record<string, unknown>
      const saved = { id: 'a'.repeat(24), ...input, updatedBy: 'owner@raidos.app', updatedAt: '2026-10-13T12:00:00.000Z' }
      stored.splice(0, stored.length, ...stored.filter((entry) => !(entry.field === input.field && entry.target === input.target)), saved)
    }
    if (method === 'POST' && path.endsWith('/remove')) stored.splice(0, stored.length)
    return { overrides: stored }
  })
  Object.assign(window, { tarkovDesktop: { edition: 'owner', serviceRequest } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { requests, wrapper }
}

describe('quest constructor: texts in the quest window (owner, 13.10.2026)', () => {
  it('a trader quest offers its title, description and every objective; a story chapter its title, shown stage and description', () => {
    expect(questTextFields(quest, null).map((field) => [field.field, field.target, field.label])).toEqual([
      ['name', '', 'Название квеста'], ['description', '', 'Описание квеста (страница «Задания»)'], ['objective', 'o1', 'Цель 1'],
    ])
    expect(questTextFields(story, 0).map((field) => [field.field, field.target, field.value])).toEqual([
      ['name', '', story.name], ['stage-title', '0', 'Начало'], ['stage-description', '0', 'Выйти с базы'], ['description', '', 'Сюжетная глава.'],
    ])
  })

  it('saves an objective line for every player in the interface language and says so', async () => {
    const { requests, wrapper } = ownerApp()
    const view = render(<QuestTextEditor quest={quest} stageIndex={null} />, { wrapper })
    const field = screen.getByLabelText('Цель 1')
    // Nothing changed: no «Сохранить» at all; the button appears under the field being edited.
    expect(screen.queryByRole('button', { name: /Сохранить/ })).toBeNull()
    fireEvent.change(field, { target: { value: '  Найти посылку на заправке  ' } })
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }))
    await waitFor(() => expect(requests.some(([method]) => method === 'PUT')).toBe(true))
    expect(requests.find(([method]) => method === 'PUT')).toEqual(['PUT', '/v1/accounts/me/admin/quest-texts', { questId: 'q1', field: 'objective', target: 'o1', lang: 'ru', text: 'Найти посылку на заправке' }])
    // The app lays the saved text over the quest (DataProvider): the window shows it as saved and corrected.
    view.rerender(<QuestTextEditor quest={{ ...quest, objectiveDetails: [{ ...quest.objectiveDetails![0], description: 'Найти посылку на заправке' }] }} stageIndex={null} />)
    expect(await screen.findByText('Сохранено — видят все игроки')).toBeInTheDocument()
    expect(screen.getByText('исправлено вручную')).toBeInTheDocument()
  })

  it('«Вернуть исходный» removes the correction; an empty text is never sent', async () => {
    const { requests, wrapper } = ownerApp([{ id: 'b'.repeat(24), questId: 'q1', field: 'description', target: '', lang: 'ru', text: 'Прапор ждёт посылку.' }])
    render(<QuestTextEditor quest={{ ...quest, description: 'Прапор ждёт посылку.' }} stageIndex={null} />, { wrapper })
    await screen.findByRole('button', { name: /Вернуть исходный/ })
    fireEvent.change(screen.getByLabelText(/Описание квеста/), { target: { value: '   ' } })
    expect(screen.getAllByRole('button', { name: /Сохранить/ })[0]).toBeDisabled()
    // While the field is being edited there is only «Отменить»; after it, «Вернуть исходный» is back.
    expect(screen.queryByRole('button', { name: /Вернуть исходный/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    fireEvent.click(screen.getByRole('button', { name: /Вернуть исходный/ }))
    await waitFor(() => expect(requests.some(([method, path]) => method === 'POST' && path === `/v1/accounts/me/admin/quest-texts/${'b'.repeat(24)}/remove`)).toBe(true))
    expect(requests.some(([method]) => method === 'PUT')).toBe(false)
  })
})
