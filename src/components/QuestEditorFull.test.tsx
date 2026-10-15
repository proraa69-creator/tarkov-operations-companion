import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item, MapMarker, Quest } from '../domain/types'
import { useQuestPointOverrides, withQuestPointOverrides } from '../data/questPointOverrides'
import { questWithRequirements, useQuestRequirementOverrides } from '../data/questRequirementOverrides'
import { QuestEditorPanel, useQuestPointEditor } from './QuestPointEditor'
import { searchCatalogItems } from './QuestRequirementsEditor'
import { MapMarkerTooltip } from './MapMarkerTooltip'
import { QuestCuratedRequirements } from './QuestCuratedInfo'
import { setRenderLanguage, uiText } from '../i18n/renderText'

const KEY = '5780cf7f2459777de4559322'
const GPU = '57347ca924597744596b4e71'
const item = (id: string, name: string, category: Item['category'], shortName = name): Item => ({ id, name, shortName, category, description: '', prices: [], iconUrl: `https://img/${id}.webp` })
const items = [item(KEY, 'Ключ от комнаты 314 общежития', 'Ключ', '314'), item(GPU, 'Видеокарта', 'Бартер', 'GPU'), item('a'.repeat(24), 'Ключ-карта красная', 'Ключ', 'Red')]
const quest: Quest = {
  id: 'q1', name: 'Посылка', trader: 'Прапор', description: 'Найти посылку', level: 1, kappa: false, rewards: [], objectives: ['Сдать видеокарту'], mapIds: ['customs'],
  objectiveDetails: [{ id: 'o1', type: 'giveItem', description: 'Сдать видеокарту', count: 1, itemIds: [GPU] }],
  raidRequirements: [{ itemId: GPU, count: 1, purpose: 'handover', mapIds: [], foundInRaid: true, objectiveId: 'o1' }],
}
const point: MapMarker = { id: 'quest-zone-q1-a', mapId: 'customs', type: 'quest', layerId: 'quest.zone', title: 'Посылка', description: 'Сдать видеокарту', position: [10, 20], questId: 'q1', objectiveId: 'o1', source: 'json.tarkov.dev/tasks' }

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'tarkovDesktop'); setRenderLanguage('ru') })

/** The owner app signed in to the owner's account, against a tiny in-memory server for points and requirements. */
function ownerApp() {
  const points: Array<Record<string, unknown>> = []
  const requirements: Array<Record<string, unknown>> = []
  const requests: Array<[string, string, unknown]> = []
  let next = 0
  const newId = () => (++next).toString(16).padStart(24, '0')
  const serviceRequest = vi.fn(async (method: string, path: string, body?: unknown) => {
    requests.push([method, path, body])
    const input = (body ?? {}) as Record<string, unknown>
    if (path.endsWith('/quest-points') && method === 'PUT') {
      const at = points.findIndex((row) => (input.id && row.id === input.id) || (!input.id && input.markerId && row.markerId === input.markerId))
      const saved = { ...input, id: at >= 0 ? points[at].id : newId(), updatedAt: `t${next++}` }
      if (at >= 0) points[at] = saved; else points.push(saved)
      return { override: saved, overrides: points }
    }
    if (path.includes('/quest-points/') && path.endsWith('/remove')) { points.splice(points.findIndex((row) => path.includes(String(row.id))), 1); return { overrides: points } }
    if (path.endsWith('/quest-points')) return { overrides: points }
    if (path.endsWith('/quest-requirements') && method === 'PUT') {
      const at = requirements.findIndex((row) => (input.id && row.id === input.id) || (!input.id && row.itemId === input.itemId && row.kind === input.kind))
      const saved = { op: 'add', count: 1, ...input, id: at >= 0 ? requirements[at].id : newId(), position: at >= 0 ? requirements[at].position : requirements.length }
      if (at >= 0) requirements[at] = saved; else requirements.push(saved)
      return { override: saved, overrides: requirements }
    }
    if (path.endsWith('/quest-requirements/order')) {
      const ids = input.ids as string[]
      ids.forEach((id, index) => { const row = requirements.find((entry) => entry.id === id); if (row) row.position = index })
      return { overrides: requirements }
    }
    if (path.includes('/quest-requirements/') && path.endsWith('/remove')) { requirements.splice(requirements.findIndex((row) => path.includes(String(row.id))), 1); return { overrides: requirements } }
    if (path.endsWith('/quest-requirements')) return { overrides: requirements }
    return { overrides: [] }
  })
  Object.assign(window, { tarkovDesktop: { edition: 'owner', serviceRequest } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  return { requests, points, requirements, wrapper }
}

/** The constructor as the Maps page mounts it, over the data merged like DataProvider does. */
function Constructor() {
  const pointOverrides = useQuestPointOverrides(true)
  const requirementOverrides = useQuestRequirementOverrides(true)
  const markers = withQuestPointOverrides([point], pointOverrides, [quest])
  const merged = questWithRequirements(quest, requirementOverrides.filter((entry) => entry.questId === quest.id))
  const state = useQuestPointEditor({ mapId: 'customs', floor: 'Основной', baseFloor: 'Основной', quests: [merged], markers, initialQuestId: 'q1' })
  return <>
    <QuestEditorPanel state={state} maps={[]} markers={markers} quests={[merged]} items={items} onPick={vi.fn()} onFocus={vi.fn()} onSelectMap={vi.fn()} />
    <div data-testid="tooltip"><MapMarkerTooltip marker={markers[0]} typeLabel="Квест" color="#fff" floor="Основной" /></div>
    <div data-testid="detail"><QuestCuratedRequirements quest={merged} items={items} /></div>
  </>
}

describe('the quest constructor as one editor (owner, 15.10.2026: «добавь полное редактирование квеста»)', () => {
  it('has «Точки», «Тексты» and «Требования» for the picked quest', async () => {
    const { wrapper } = ownerApp()
    render(<Constructor />, { wrapper })
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Точки', 'Тексты', 'Требования'])
    fireEvent.click(screen.getByRole('tab', { name: 'Тексты' }))
    expect(await screen.findByLabelText('Цель 1')).toHaveValue('Сдать видеокарту')
  })

  it('a point gets a description for players and a note for the owner; players see the description, never the note; «Отменить» undoes it', async () => {
    const { requests, points, wrapper } = ownerApp()
    render(<Constructor />, { wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'Описание для игроков' }))
    const form = screen.getByRole('form', { name: 'Описание точки' })
    expect(within(form).getByText('Описание для игроков')).toBeInTheDocument()
    expect(within(form).getByText('Заметка для себя')).toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText('Заголовок точки'), { target: { value: 'Склад у заправки' } })
    fireEvent.change(within(form).getByLabelText('Где и что искать'), { target: { value: '  За красной дверью, на второй полке  ' } })
    fireEvent.change(within(form).getByLabelText('Заметка для себя'), { target: { value: 'по баг-репорту' } })
    fireEvent.click(within(form).getByRole('button', { name: /Сохранить/ }))
    await screen.findByText('Сохранено — видят все игроки')
    expect(requests.find(([method]) => method === 'PUT')).toEqual(['PUT', '/v1/accounts/me/admin/quest-points', {
      questId: 'q1', markerId: point.id, mapId: 'customs', x: 20, z: 10, kind: 'describe', objectiveId: 'o1',
      title: 'Склад у заправки', description: 'За красной дверью, на второй полке', note: 'по баг-репорту',
    }])
    // The map tooltip every player sees: «Где искать», no note.
    const tooltip = screen.getByTestId('tooltip')
    await waitFor(() => expect(tooltip).toHaveTextContent('Где искать: Склад у заправки — За красной дверью, на второй полке'))
    expect(tooltip).not.toHaveTextContent('по баг-репорту')

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    await waitFor(() => expect(points).toHaveLength(0))
    expect(requests.at(-1)?.[1]).toMatch(/\/quest-points\/[a-f0-9]{24}\/remove$/)
  })

  it('«Требования»: picks a key from the catalog, edits, reorders, hides an original and removes', async () => {
    const { requests, requirements, wrapper } = ownerApp()
    render(<Constructor />, { wrapper })
    fireEvent.click(screen.getByRole('tab', { name: 'Требования' }))
    const list = screen.getByRole('list', { name: 'Требования квеста' })
    expect(within(list).getByText('Видеокарта')).toBeInTheDocument()
    expect(within(list).getByText(/из каталога/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Добавить требование/ }))
    fireEvent.change(screen.getByLabelText('Найти предмет'), { target: { value: 'ключ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ключи' }))
    const results = within(screen.getByRole('list', { name: 'Предметы каталога' })).getAllByRole('button')
    expect(results.map((row) => row.querySelector('strong')?.textContent)).toEqual(['Ключ от комнаты 314 общежития', 'Ключ-карта красная'])
    expect(results[0].querySelector('img')).toHaveAttribute('src', `https://img/${KEY}.webp`)
    fireEvent.click(results[0])
    const form = screen.getByRole('form', { name: 'Требование' })
    expect(within(form).getByLabelText('Что сделать')).toHaveValue('key')
    fireEvent.change(within(form).getByLabelText('Привязка'), { target: { value: `p:${point.id}` } })
    fireEvent.change(within(form).getByLabelText('Комментарий'), { target: { value: 'Дверь на 3 этаже' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }))
    await screen.findByText('Сохранено — видят все игроки')
    expect(requests.find(([method, path]) => method === 'PUT' && path.endsWith('/quest-requirements'))?.[2]).toEqual({
      questId: 'q1', op: 'add', itemId: KEY, kind: 'key', count: 1, comment: 'Дверь на 3 этаже', pointId: point.id, objectiveId: 'o1',
    })
    // The player's quest page marks it as added by Raid OS.
    await waitFor(() => expect(screen.getByTestId('detail')).toHaveTextContent('Ключ от комнаты 314 общежития'))
    expect(screen.getByTestId('detail')).toHaveTextContent('Raid OS')
    expect(screen.getByTestId('detail')).toHaveTextContent('Дверь на 3 этаже')

    // «Скрыть» the catalog's hand-over, then show it again.
    fireEvent.click(within(list).getAllByRole('button', { name: 'Скрыть требование' })[0])
    await waitFor(() => expect(requirements.some((row) => row.op === 'hide' && row.itemId === GPU && row.kind === 'handover')).toBe(true))
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Требования квеста' })).getByText(/скрыто/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Показать снова' }))
    await waitFor(() => expect(requirements.some((row) => row.op === 'hide')).toBe(false))

    const rowOf = (text: string) => within(screen.getByRole('list', { name: 'Требования квеста' })).getAllByRole('listitem').find((row) => row.textContent?.includes(text))!
    const keyRow = () => rowOf('Ключ от комнаты 314 общежития')
    // A second one, then it goes first.
    fireEvent.click(screen.getByRole('button', { name: /Добавить требование/ }))
    fireEvent.change(screen.getByLabelText('Найти предмет'), { target: { value: 'GPU' } })
    fireEvent.click(within(screen.getByRole('list', { name: 'Предметы каталога' })).getAllByRole('button')[0])
    fireEvent.change(within(screen.getByRole('form', { name: 'Требование' })).getByLabelText('Что сделать'), { target: { value: 'use' } })
    fireEvent.click(within(screen.getByRole('form', { name: 'Требование' })).getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(requirements).toHaveLength(2))
    await waitFor(() => expect(within(rowOf('Использовать')).getByRole('button', { name: 'Выше' })).toBeEnabled())
    fireEvent.click(within(rowOf('Использовать')).getByRole('button', { name: 'Выше' }))
    await waitFor(() => expect(requests.some(([, path]) => path.endsWith('/quest-requirements/order'))).toBe(true))
    expect(requests.find(([, path]) => path.endsWith('/quest-requirements/order'))?.[2]).toEqual({ questId: 'q1', ids: [requirements[1].id, requirements[0].id] })
    fireEvent.click(within(rowOf('Использовать')).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(requirements).toHaveLength(1))
    fireEvent.click(within(keyRow()).getByRole('button', { name: 'Изменить' }))
    const edit = screen.getByRole('form', { name: 'Требование' })
    fireEvent.change(within(edit).getByLabelText('Количество'), { target: { value: '2' } })
    fireEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(requirements[0].count).toBe(2))
    fireEvent.click(within(keyRow()).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(requirements).toHaveLength(0))
  })

  it('the picker searches the catalog by name or short name, filtered to keys or other items', () => {
    expect(searchCatalogItems(items, 'gpu', 'all').map((entry) => entry.id)).toEqual([GPU])
    expect(searchCatalogItems(items, 'ключ', 'items')).toEqual([])
    expect(searchCatalogItems(items, 'ключ 314', 'keys').map((entry) => entry.id)).toEqual([KEY])
    expect(searchCatalogItems(items, 'к', 'all')).toEqual([])
  })

  it('speaks English', () => {
    setRenderLanguage('en')
    expect(['Описание для игроков', 'Заметка для себя', 'Требования', 'Добавить требование', 'Где искать', 'Нужен ключ', 'Ключи', 'Отменить: описание точки'].map((text) => uiText(text)))
      .toEqual(['Description for players', 'Note to self', 'Requirements', 'Add requirement', 'Where to look', 'Key needed', 'Keys', 'Undo: описание точки'])
  })
})
