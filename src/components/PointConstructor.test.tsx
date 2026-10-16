import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item, MapMarker, Quest } from '../domain/types'
import { useQuestPointOverrides, withQuestPointOverrides } from '../data/questPointOverrides'
import { QuestEditorPanel, useQuestPointEditor } from './QuestPointEditor'
import { PointMenu, PointSettingsWindow, type PointEmblem } from './PointConstructor'
import { EditableText, QuestSheetEditProvider } from './QuestSheetEditing'
import { PointHintLine } from './QuestCuratedInfo'

const ITEM = 'f'.repeat(24)
const items: Item[] = [{ id: ITEM, name: 'Флешка с данными', shortName: 'Флешка', category: 'Бартер', description: '', prices: [], iconUrl: 'https://img/flash.webp' }]
const quest: Quest = {
  id: 'q1', name: 'Выживший', trader: 'Прапор', description: 'Описание', level: 1, kappa: false, rewards: [],
  objectives: ['Найти тайник', 'Заложить маяк', 'Выжить и выйти'], objectiveIds: ['o1', 'o2', 'o3'],
  objectiveDetails: [
    { id: 'o1', type: 'visit', description: 'Найти тайник', count: 1 },
    { id: 'o2', type: 'plantItem', description: 'Заложить маяк', count: 1 },
    { id: 'o3', type: 'extract', description: 'Выжить и выйти', count: 1 },
  ],
}
const original: MapMarker = { id: 'quest-zone-q1-a', mapId: 'customs', type: 'quest', layerId: 'quest.zone', title: 'Выживший', description: 'Найти тайник', position: [10, 20], questId: 'q1', objectiveId: 'o1', source: 'json.tarkov.dev/tasks' }
const emblems: PointEmblem[] = [
  { id: 'quest.zone', label: 'Квест', icon: null }, { id: 'quest.item', label: 'Квестовый предмет', icon: null },
  { id: 'extract.pmc', label: 'Выход ЧВК', icon: null }, { id: 'transit', label: 'Переход', icon: null }, { id: 'loot.valuable', label: 'Драгоценности', icon: null },
]
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3])

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'tarkovDesktop') })

/** The owner app against a tiny in-memory server for points, photos and texts. */
function ownerApp() {
  const points: Array<Record<string, unknown>> = []
  const texts: Array<Record<string, unknown>> = []
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
    if (path.endsWith('/quest-point-photos') && method === 'POST') return { photo: { id: 'a'.repeat(24), mime: 'image/png', size: 24, width: 2, height: 3 } }
    if (path.startsWith('/v1/me/quest-point-photos/')) return { mime: 'image/png', data: 'iVBORw0KGgo=', width: 2, height: 3 }
    if (path.endsWith('/quest-texts') && method === 'PUT') { texts.push({ ...input, id: newId() }); return { overrides: texts } }
    if (path.endsWith('/quest-texts')) return { overrides: texts }
    return { overrides: [] }
  })
  Object.assign(window, { tarkovDesktop: { edition: 'owner', serviceRequest } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  return { requests, points, wrapper }
}
const pointWrites = (requests: Array<[string, string, unknown]>) => requests.filter(([method, path]) => method === 'PUT' && path.endsWith('/quest-points')).map(([, , body]) => body as Record<string, unknown>)

/**
 * The constructor as the Maps page mounts it: the right panel, the point menu and the point window. «click map» stands
 * for a click on the map while placing; «right-click …» for the right click on a point.
 */
function Constructor({ initialQuestId }: { initialQuestId?: string }) {
  const overrides = useQuestPointOverrides(true)
  const markers = withQuestPointOverrides([original], overrides, [quest])
  const state = useQuestPointEditor({ mapId: 'customs', floor: 'Основной', baseFloor: 'Основной', quests: [quest], markers, initialQuestId })
  if (!state.active) state.setActive(true)
  return <>
    <QuestEditorPanel state={state} maps={[]} markers={markers} quests={[quest]} items={items} onPick={(picked) => state.pick(picked.id)} onFocus={vi.fn()} onSelectMap={vi.fn()} />
    <button type="button" onClick={() => void state.add(5, 6)}>click map</button>
    {state.drafts.map((draft) => <button key={draft.id} type="button" onClick={() => state.openMenu({ draft }, 40, 40)}>right-click draft</button>)}
    {markers.map((marker) => <button key={marker.id} type="button" onClick={() => state.openMenu({ marker }, 40, 40)}>right-click {marker.id}</button>)}
    <div data-testid="markers">{markers.map((marker) => `${marker.id}:${marker.layerId}:${marker.objectiveId ?? ''}:${marker.description}`).join('|')}</div>
    <PointMenu state={state} emblems={emblems} />
    <PointSettingsWindow state={state} emblems={emblems} quests={[quest]} items={items} markers={markers} />
  </>
}

describe('the point constructor on the map (owner, 16.10.2026: «ставлю точку, она пустая. жму правой кнопкой. открывается окно»)', () => {
  it('BUG: with a quest and an objective picked, a placed point is saved for that objective, not the first one', async () => {
    const { requests, wrapper } = ownerApp()
    render(<Constructor initialQuestId="q1" />, { wrapper })
    fireEvent.change(await screen.findByLabelText('Цель / этап'), { target: { value: 'o:o3' } })
    fireEvent.click(screen.getByRole('button', { name: /Добавить точку/ }))
    fireEvent.click(screen.getByRole('button', { name: 'click map' }))
    await waitFor(() => expect(pointWrites(requests)).toHaveLength(1))
    expect(pointWrites(requests)[0]).toMatchObject({ questId: 'q1', kind: 'add', objectiveId: 'o3', x: 5, z: 6 })
    await waitFor(() => expect(screen.getByTestId('markers')).toHaveTextContent(':o3:Выжить и выйти'))
  })

  it('a point placed with no quest is empty and unsaved; its right-click menu sets an emblem; saved as a free point for every player', async () => {
    const { requests, points, wrapper } = ownerApp()
    render(<Constructor />, { wrapper })
    fireEvent.click(await screen.findByRole('button', { name: /Поставить точку/ }))
    fireEvent.click(screen.getByRole('button', { name: 'click map' }))
    fireEvent.click(await screen.findByRole('button', { name: 'right-click draft' }))
    expect(pointWrites(requests)).toHaveLength(0)
    const menu = screen.getByRole('menu', { name: 'Меню точки' })
    expect(within(menu).getByRole('menuitem', { name: /Редактировать/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Удалить точку/ })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Переход' }))
    const dialog = screen.getByRole('dialog', { name: 'Настройки точки' })
    expect(within(dialog).getByRole('radio', { name: /Переход/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(dialog).queryByLabelText('Найти квест для точки')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Заголовок точки'), { target: { value: 'Переход на Развязку' } })
    fireEvent.change(within(dialog).getByLabelText('Где и что искать'), { target: { value: 'У ворот' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Сохранить/ }))
    await waitFor(() => expect(pointWrites(requests)).toHaveLength(1))
    const body = pointWrites(requests)[0]
    expect(body).toEqual({ mapId: 'customs', x: 5, z: 6, kind: 'add', icon: 'transit', title: 'Переход на Развязку', description: 'У ворот' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('button', { name: 'right-click draft' })).toBeNull()
    // The saved free point: drawn with its emblem; its menu deletes it.
    const free = `owner-quest-${String(points[0].id)}`
    await waitFor(() => expect(screen.getByTestId('markers')).toHaveTextContent(`${free}:transit::У ворот`))
    fireEvent.click(screen.getByRole('button', { name: `right-click ${free}` }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Удалить точку/ }))
    await waitFor(() => expect(points).toHaveLength(0))
  })

  it('«Квест»: finds the quest in our list, attaches the point to the chosen objective; adds a catalog item and a photo', async () => {
    const { requests, wrapper } = ownerApp()
    render(<Constructor />, { wrapper })
    fireEvent.click(await screen.findByRole('button', { name: /Поставить точку/ }))
    fireEvent.click(screen.getByRole('button', { name: 'click map' }))
    fireEvent.click(await screen.findByRole('button', { name: 'right-click draft' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Редактировать/ }))
    const dialog = screen.getByRole('dialog', { name: 'Настройки точки' })
    // Without a quest a quest point is refused.
    fireEvent.click(within(dialog).getByRole('button', { name: /Сохранить/ }))
    expect(await within(dialog).findByText('Выберите квест для точки квеста.')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Найти квест для точки'), { target: { value: 'выжив' } })
    fireEvent.click(within(within(dialog).getByRole('list', { name: 'Найденные квесты' })).getByRole('button', { name: /Выживший/ }))
    fireEvent.change(within(dialog).getByLabelText('Цель / этап точки'), { target: { value: 'o:o2' } })
    // A catalog item with its picture.
    fireEvent.click(within(dialog).getByRole('button', { name: /Добавить предмет/ }))
    fireEvent.change(within(dialog).getByLabelText('Найти предмет'), { target: { value: 'флешка' } })
    const result = within(within(dialog).getByRole('list', { name: 'Предметы каталога' })).getByRole('button')
    expect(result.querySelector('img')).toHaveAttribute('src', 'https://img/flash.webp')
    fireEvent.click(result)
    expect(within(within(dialog).getByRole('list', { name: 'Предметы точки' })).getByText('Флешка с данными')).toBeInTheDocument()
    // A photo of the place.
    fireEvent.change(within(dialog).getByLabelText('Фото места'), { target: { files: [new File([PNG], 'place.png', { type: 'image/png' })] } })
    await waitFor(() => expect(requests.some(([method, path]) => method === 'POST' && path === '/v1/accounts/me/admin/quest-point-photos')).toBe(true))
    expect(await within(dialog).findByRole('list', { name: 'Фото точки' })).toBeInTheDocument()
    const upload = requests.find(([method, path]) => method === 'POST' && path.endsWith('/quest-point-photos'))![2] as { data: string }
    expect(upload.data).toBe(btoa(String.fromCharCode(...PNG)))
    fireEvent.click(within(dialog).getByRole('button', { name: /Сохранить/ }))
    await waitFor(() => expect(pointWrites(requests)).toHaveLength(1))
    expect(pointWrites(requests)[0]).toEqual({ questId: 'q1', mapId: 'customs', x: 5, z: 6, kind: 'add', icon: 'quest.zone', objectiveId: 'o2', itemIds: [ITEM], photoIds: ['a'.repeat(24)] })
    await waitFor(() => expect(screen.getByTestId('markers')).toHaveTextContent(':o2:Заложить маяк'))
  })

  it('right-click «Редактировать» on an original point moves it to another objective and keeps its quest; «Удалить» hides it', async () => {
    const { requests, wrapper } = ownerApp()
    render(<Constructor initialQuestId="q1" />, { wrapper })
    fireEvent.click(await screen.findByRole('button', { name: `right-click ${original.id}` }))
    const menu = screen.getByRole('menu', { name: 'Меню точки' })
    expect(within(menu).queryByRole('menuitem', { name: 'Переход' })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Редактировать/ }))
    const dialog = screen.getByRole('dialog', { name: 'Настройки точки' })
    expect(within(dialog).getByText('Выживший')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Найти квест для точки')).toBeNull()
    expect(within(dialog).getByLabelText('Цель / этап точки')).toHaveValue('o:o1')
    fireEvent.change(within(dialog).getByLabelText('Цель / этап точки'), { target: { value: 'o:o3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Сохранить/ }))
    await waitFor(() => expect(pointWrites(requests)).toHaveLength(1))
    expect(pointWrites(requests)[0]).toEqual({ questId: 'q1', markerId: original.id, mapId: 'customs', x: 20, z: 10, kind: 'describe', objectiveId: 'o3' })
    await waitFor(() => expect(screen.getByTestId('markers')).toHaveTextContent(`${original.id}:quest.zone:o3:`))
    fireEvent.click(screen.getByRole('button', { name: `right-click ${original.id}` }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Скрыть точку/ }))
    await waitFor(() => expect(pointWrites(requests).at(-1)).toMatchObject({ kind: 'hide', markerId: original.id }))
  })
})

describe('the quest window\'s pencils (owner, 16.10.2026: «кнопка карандаша, справа от каждой надписи»)', () => {
  it('a pencil to the right of a line edits it in place and saves it for every player; players get the plain text', async () => {
    const { requests, wrapper } = ownerApp()
    const view = render(<QuestSheetEditProvider questId="q1" enabled><h2><EditableText field="name" value="Выживший" /></h2><EditableText field="objective" target="o2" value="Заложить маяк" /></QuestSheetEditProvider>, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'Изменить: название квеста' }))
    const field = screen.getByLabelText(/Название квеста/)
    expect(field).toHaveValue('Выживший')
    fireEvent.change(field, { target: { value: 'Выживший любой ценой' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(requests.find(([method]) => method === 'PUT')).toEqual(['PUT', '/v1/accounts/me/admin/quest-texts', { questId: 'q1', field: 'name', target: '', lang: 'ru', text: 'Выживший любой ценой' }]))
    await waitFor(() => expect(screen.queryByLabelText(/Название квеста/)).toBeNull())
    expect(screen.getByRole('button', { name: 'Изменить: цель' })).toBeInTheDocument()
    view.rerender(<QuestSheetEditProvider questId="q1" enabled={false}><h2><EditableText field="name" value="Выживший" /></h2></QuestSheetEditProvider>)
    expect(screen.queryByRole('button', { name: /Изменить/ })).toBeNull()
    expect(screen.getByRole('heading')).toHaveTextContent('Выживший')
  })

  it('a point line «Где искать» shows its items and photos to players; the owner\'s pencil opens the point', async () => {
    const { requests, wrapper } = ownerApp()
    const onEdit = vi.fn()
    render(<PointHintLine hint={{ title: 'Склад', text: 'За дверью', items: [{ itemId: ITEM, name: 'Флешка с данными', iconUrl: 'https://img/flash.webp' }], photoIds: ['b'.repeat(24)] }} onEdit={onEdit} />, { wrapper })
    expect(screen.getByText('Флешка с данными')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Фото: где искать' })).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')
    expect(requests.some(([method, path]) => method === 'GET' && path === `/v1/me/quest-point-photos/${'b'.repeat(24)}`)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Изменить точку' }))
    expect(onEdit).toHaveBeenCalled()
  })
})
