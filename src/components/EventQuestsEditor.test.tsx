import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameMap, Item, Quest, Trader } from '../domain/types'
import { BALANCE_SHIFT_QUEST_IDS, SCOURGE_QUEST_IDS } from '../data/curatedQuests'
import type { EventQuestDefinition } from '../data/eventQuestDefinitions'
import { cleanDefinition, definitionProblem, EventQuestsEditor, eventQuestRows, localDateTime, newEventQuest, newEventQuestId } from './EventQuestsEditor'
import { setRenderLanguage, uiText } from '../i18n/renderText'

const THERAPIST = '54cb57776803fa99248b456e'
const ROUBLES = '5449016a4bdc2d6f028b456f'
const traders: Trader[] = [{ id: THERAPIST, name: 'Терапевт', role: '', loyalty: 1, accent: '' }, { id: '54cb50c76803fa8b248b4571', name: 'Прапор', role: '', loyalty: 1, accent: '' }]
const items: Item[] = [{ id: ROUBLES, name: 'Рубли', shortName: 'RUB', category: 'Бартер', description: '', prices: [] }]
const maps = [{ id: 'the-lab', name: 'Лаборатория' }, { id: 'factory', name: 'Завод' }] as GameMap[]
const quests = [{ id: SCOURGE_QUEST_IDS.simpleTask, name: 'Простая задача в непростом месте', trader: 'Терапевт', description: '', level: 1, kappa: false, rewards: [], objectives: [] }] as Quest[]

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'tarkovDesktop'); setRenderLanguage('ru'); vi.restoreAllMocks() })

/** The owner app against a tiny in-memory event quest server. */
function ownerApp() {
  const stored: EventQuestDefinition[] = []
  const requests: Array<[string, string, unknown]> = []
  const serviceRequest = vi.fn(async (method: string, path: string, body?: unknown) => {
    requests.push([method, path, body])
    if (path.endsWith('/event-quests') && method === 'PUT') {
      const input = body as EventQuestDefinition
      const at = stored.findIndex((entry) => entry.id === input.id)
      const saved = { ...input, createdAt: at >= 0 ? stored[at].createdAt : `2026-10-16T12:0${stored.length}:00.000Z`, updatedAt: '2026-10-16T13:00:00.000Z' }
      if (at >= 0) stored[at] = saved; else stored.push(saved)
      return { quest: saved, quests: stored }
    }
    if (path.endsWith('/remove')) { stored.splice(stored.findIndex((entry) => path.includes(entry.id)), 1); return { quests: stored } }
    return { quests: stored }
  })
  Object.assign(window, { tarkovDesktop: { edition: 'owner', serviceRequest } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { stored, requests, wrapper }
}

const editor = <EventQuestsEditor quests={quests} items={items} traders={traders} maps={maps} onClose={vi.fn()} />

describe('«Ивент-квесты» in the owner app', () => {
  it('the owner renames a built-in quest (as «???» was); the built-in quest is marked edited and «Вернуть исходный» brings it back', async () => {
    const { requests, stored, wrapper } = ownerApp()
    render(editor, { wrapper })
    const list = await screen.findByRole('list', { name: 'Ивент-квесты' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(7))
    expect(within(list).getByText('Продление операции')).toBeInTheDocument()
    expect(within(list).getAllByText(/исходный/)).toHaveLength(7)

    fireEvent.click(screen.getByRole('button', { name: 'Изменить: Продление операции' }))
    expect(screen.getByLabelText('Торговец')).toHaveValue(THERAPIST)
    expect(screen.getByLabelText('Окончание ивента')).toHaveValue(localDateTime('2026-10-26T07:00:00.000Z'))
    fireEvent.change(screen.getByLabelText('Название (RU)'), { target: { value: 'Нарушить координацию' } })
    fireEvent.change(screen.getByLabelText('Название (EN)'), { target: { value: 'Disrupt the Coordination' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(stored).toHaveLength(1))
    const [method, path, body] = requests.find(([verb]) => verb === 'PUT')!
    expect([method, path]).toEqual(['PUT', '/v1/accounts/me/admin/event-quests'])
    const sent = body as EventQuestDefinition
    expect(sent.id).toBe(SCOURGE_QUEST_IDS.coordination)
    expect(sent.name).toEqual({ ru: 'Нарушить координацию', en: 'Disrupt the Coordination' })
    expect(sent.after).toEqual([SCOURGE_QUEST_IDS.simpleTask])
    expect(sent.objectives).toEqual([{ type: 'shoot', text: { ru: 'Устранить любую цель на локации Лаборатория', en: 'Eliminate any target in The Lab' }, count: 6, maps: ['the-lab'], targets: ['Any'] }])
    expect(sent.endsAt).toBe('2026-10-26T07:00:00.000Z')

    expect(await screen.findByText('Нарушить координацию')).toBeInTheDocument()
    expect(screen.getByText(/Сохранено — видят все игроки/)).toBeInTheDocument()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть исходный: Нарушить координацию' }))
    await waitFor(() => expect(requests.some(([verb, url]) => verb === 'POST' && url === `/v1/accounts/me/admin/event-quests/${SCOURGE_QUEST_IDS.coordination}/remove`)).toBe(true))
    expect(await screen.findByText('Продление операции')).toBeInTheDocument()
  })

  it('«Добавить квест» makes a new quest of the same series, with a reward from the catalog; «Удалить» asks first', async () => {
    const { requests, stored, wrapper } = ownerApp()
    render(editor, { wrapper })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Добавить квест' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Добавить квест' }))
    expect(screen.getByLabelText('Серия (RU)')).toHaveValue('Вторжение Scourge')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByText('Укажите название квеста (RU).')).toBeInTheDocument()
    expect(requests.some(([verb]) => verb === 'PUT')).toBe(false)

    fireEvent.change(screen.getByLabelText('Название (RU)'), { target: { value: 'Зелёный коридор' } })
    fireEvent.change(screen.getByLabelText('Тип цели 1'), { target: { value: 'extract' } })
    fireEvent.change(screen.getByLabelText('Текст цели 1 (RU)'), { target: { value: 'Выжить и выйти с локации Лаборатория' } })
    fireEvent.click(screen.getByRole('button', { name: 'Лаборатория' }))
    const reward = screen.getByText('Награда').parentElement!
    fireEvent.click(within(reward).getByRole('button', { name: 'Добавить предмет' }))
    fireEvent.change(screen.getByLabelText('Найти предмет'), { target: { value: 'Рубли' } })
    fireEvent.click(screen.getByRole('button', { name: /Рубли/ }))
    fireEvent.change(screen.getByLabelText('Количество: Рубли'), { target: { value: '150000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(stored).toHaveLength(1))
    const sent = stored[0]
    expect(sent.id).toMatch(/^raidos-event-[a-z0-9]{10}$/)
    expect(sent.after).toEqual([SCOURGE_QUEST_IDS.soulJob])
    expect(sent.objectives).toEqual([{ type: 'extract', text: { ru: 'Выжить и выйти с локации Лаборатория', en: '' }, maps: ['the-lab'] }])
    expect(sent.rewards).toEqual([[ROUBLES, 150000]])

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить: Зелёный коридор' }))
    expect(confirm).toHaveBeenCalled()
    expect(requests.some(([verb]) => verb === 'POST')).toBe(false)
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить: Зелёный коридор' }))
    await waitFor(() => expect(stored).toHaveLength(0))
  })

  it('has its English', async () => {
    ownerApp()
    setRenderLanguage('en')
    expect(uiText('Ивент-квесты')).toBe('Event quests')
    expect(uiText('Текст цели 2')).toBe('Objective 2 text')
    expect(uiText('Добавить квест')).toBe('Add quest')
    expect(uiText('Ивент до (ваше время; пусто — без окончания)')).toBe('Event until (your time; empty: no end)')
  })
})

describe('the editor\'s helpers', () => {
  it('ids, the list, a new quest, the cleaned definition and what is missing', () => {
    expect(newEventQuestId(() => 0)).toBe('raidos-event-aaaaaaaaaa')
    const rows = eventQuestRows([])
    expect(rows.map((row) => row.definition.id)).toEqual([
      BALANCE_SHIFT_QUEST_IDS.fogOfWar, SCOURGE_QUEST_IDS.hiddenRoute, SCOURGE_QUEST_IDS.simpleTask, SCOURGE_QUEST_IDS.coordination,
      SCOURGE_QUEST_IDS.informationTrail, SCOURGE_QUEST_IDS.deanon, SCOURGE_QUEST_IDS.soulJob,
    ])
    const fresh = newEventQuest(rows, 'raidos-event-x1y2z3')
    expect(fresh.trader).toBe(THERAPIST)
    expect(definitionProblem(cleanDefinition(fresh))).toBe('Укажите название квеста (RU).')
    const clean = cleanDefinition({ ...fresh, name: { ru: ' Новый ', en: '' }, objectives: [{ type: 'visit', text: { ru: 'Найти', en: '' }, items: [ROUBLES], targets: ['Any'], count: 1 }] })
    expect(clean.name).toEqual({ ru: 'Новый', en: '' })
    expect(clean.objectives).toEqual([{ type: 'visit', text: { ru: 'Найти', en: '' } }])
    expect(definitionProblem(clean)).toBeUndefined()
    expect(localDateTime(undefined)).toBe('')
  })
})
