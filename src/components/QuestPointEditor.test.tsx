import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameMap, MapMarker, Quest } from '../domain/types'
import { constructorQuests, firstQuestPoint, QuestEditorButton, QuestEditorPanel, type QuestPointEditorState } from './QuestPointEditor'

const quest = (id: string, name: string, trader: string): Quest => ({ id, name, trader, description: '', level: 1, kappa: false, rewards: [], objectives: [] })
const quests = [quest('a', 'Посылка', 'Прапор'), quest('b', 'Аптекарь', 'Терапевт'), quest('c', 'Бизнес', 'Прапор'), quest('d', 'Аренда', 'Барахольщик')]
/** Points per quest per map: «Аптекарь» is plotted on this map (Таможня), «Бизнес» only on Развязке. */
const counts = new Map([['b', new Map([['customs', 2]])], ['c', new Map([['interchange', 3]])]])

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'tarkovDesktop') })

function editorState(extra: Partial<QuestPointEditorState> = {}): QuestPointEditorState {
  return {
    enabled: true, active: true, setActive: vi.fn(), questId: '', quest: undefined, pick: vi.fn(), goal: '', setGoal: vi.fn(), adding: false, setAdding: vi.fn(),
    note: '', setNote: vi.fn(), busy: false, error: '', points: [], hidden: [], pointCounts: counts, overrides: [], move: vi.fn(), add: vi.fn(), hide: vi.fn(),
    reset: vi.fn(), overrideOf: vi.fn(), canDrag: vi.fn(), mapId: 'customs', floor: 'Основной', baseFloor: 'Основной', editingQuest: '', shows: () => true,
    ...extra,
  } as unknown as QuestPointEditorState
}

describe('quest constructor «Редактировать квесты» (owner, 13.10.2026: «нажимаю справа список квестов, либо нахожу в поиске»)', () => {
  it('lists every quest, the ones plotted on this map first, then by trader and name; a search narrows it', () => {
    expect(constructorQuests(quests, '', 'customs', counts).map((entry) => entry.id)).toEqual(['b', 'd', 'c', 'a'])
    expect(constructorQuests(quests, 'бизн', 'customs', counts).map((entry) => entry.id)).toEqual(['c'])
    expect(constructorQuests(quests, 'б', 'customs', counts).map((entry) => entry.id)).toHaveLength(4)
  })

  it('the right panel shows the list with where each quest is plotted; a click picks it', () => {
    const onPick = vi.fn()
    render(<QuestEditorPanel state={editorState()} maps={[] as GameMap[]} markers={[]} quests={quests} onPick={onPick} onFocus={vi.fn()} onSelectMap={vi.fn()} />)
    const rows = within(screen.getByRole('list', { name: 'Квесты' })).getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual([
      'АптекарьТерапевт · здесь точек: 2', 'АрендаБарахольщик · без точек', 'БизнесПрапор · точек на других картах: 3', 'ПосылкаПрапор · без точек',
    ])
    fireEvent.click(rows[2])
    expect(onPick).toHaveBeenCalledWith(quests[2])
  })

  it('the map button is «Редактировать квесты», only in the owner app', () => {
    const setActive = vi.fn()
    const view = render(<QuestEditorButton state={editorState({ active: false, setActive })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать квесты' }))
    expect(setActive).toHaveBeenCalledWith(true)
    view.rerender(<QuestEditorButton state={editorState({ enabled: false })} />)
    expect(screen.queryByRole('button', { name: 'Редактировать квесты' })).toBeNull()
  })

  it('finds the first plotted point of a quest on a map, never the «any map» placeholder', () => {
    const markers = [
      { id: 'x', questId: 'b', mapId: 'customs', type: 'quest', layerId: 'quest.zone', source: 'quest-any-map', position: [0, 0] },
      { id: 'y', questId: 'b', mapId: 'customs', type: 'quest', layerId: 'quest.zone', source: 'json.tarkov.dev/tasks', position: [1, 1] },
    ] as unknown as MapMarker[]
    expect(firstQuestPoint(markers, 'b', 'customs')?.id).toBe('y')
    expect(firstQuestPoint(markers, 'b', 'interchange')).toBeUndefined()
  })
})
