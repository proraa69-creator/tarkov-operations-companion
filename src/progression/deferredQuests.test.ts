import { afterEach, describe, expect, it } from 'vitest'
import type { Item, Quest } from '../domain/types'
import {
  clearAllDeferredQuests, deferQuest, deferredQuestRows, deferredQuestsKey, questRaidItems, readDeferredQuests, restoreDeferredQuests,
} from './deferredQuests'

const item = (id: string, category: Item['category'] = 'Бартер'): Item => ({ id, name: `Предмет ${id}`, shortName: id, category, description: '', prices: [], iconUrl: `https://assets.example/${id}.webp` })
const quest = (id: string, extra: Partial<Quest> = {}): Quest => ({ id, name: `Квест ${id}`, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], mapId: 'customs', ...extra })
const items = new Map([item('key-a', 'Ключ'), item('key-b', 'Ключ'), item('marker'), item('flash'), item('salewa', 'Медицина'), item('gpu')].map((entry) => [entry.id, entry]))

afterEach(() => localStorage.clear())

describe('«Отложенные квесты»: the store', () => {
  it('keeps each profile and mode apart and returns quests on «Вернуть»', () => {
    deferQuest('p1', 'pvp', 'q1', 1000)
    deferQuest('p1', 'pvp', 'q2', 2000)
    deferQuest('p1', 'pve', 'q3', 3000)
    expect([...readDeferredQuests('p1', 'pvp')]).toEqual([['q1', 1000], ['q2', 2000]])
    expect([...readDeferredQuests('p1', 'pve').keys()]).toEqual(['q3'])
    expect(readDeferredQuests('p1', 'seasonal').size).toBe(0)
    expect(readDeferredQuests('p2', 'pvp').size).toBe(0)
    // Put aside again: it keeps its first time.
    deferQuest('p1', 'pvp', 'q1', 5000)
    expect(readDeferredQuests('p1', 'pvp').get('q1')).toBe(1000)
    restoreDeferredQuests('p1', 'pvp', ['q1', 'unknown'])
    expect([...readDeferredQuests('p1', 'pvp').keys()]).toEqual(['q2'])
    restoreDeferredQuests('p1', 'pvp', ['q2'])
    expect(localStorage.getItem(deferredQuestsKey('p1', 'pvp'))).toBeNull()
  })

  it('reads a damaged value as nothing put aside and «Удалить все данные» clears every profile and mode', () => {
    localStorage.setItem(deferredQuestsKey('p1', 'pvp'), '{oops')
    expect(readDeferredQuests('p1', 'pvp').size).toBe(0)
    localStorage.setItem(deferredQuestsKey('p1', 'pve'), JSON.stringify({ q1: 'yesterday', q2: 7 }))
    expect([...readDeferredQuests('p1', 'pve').keys()]).toEqual(['q2'])
    deferQuest('p2', 'seasonal', 'q4')
    localStorage.setItem('tarkov-quest-checks-v1:p1:pvp', '{}')
    clearAllDeferredQuests()
    expect(readDeferredQuests('p2', 'seasonal').size).toBe(0)
    expect(readDeferredQuests('p1', 'pve').size).toBe(0)
    expect(localStorage.getItem('tarkov-quest-checks-v1:p1:pvp')).toBe('{}')
  })
})

describe('«Отложенные квесты»: what a quest needs in the raid', () => {
  it('puts the keys first, then what it places, marks or brings; never what it hands over or finds', () => {
    const needs: Quest['raidRequirements'] = [
      { itemId: 'salewa', count: 3, purpose: 'handover', mapIds: [] },
      { itemId: 'gpu', count: 1, purpose: 'find', mapIds: [] },
      { itemId: 'marker', count: 1, purpose: 'mark', mapIds: ['customs'] },
      { itemId: 'flash', count: 1, purpose: 'place', mapIds: ['customs'] },
      { itemId: 'key-b', count: 1, purpose: 'key', mapIds: ['customs'] },
      { itemId: 'missing-from-catalog', count: 1, purpose: 'bring', mapIds: [] },
    ]
    expect(questRaidItems(quest('q', { raidRequirements: needs, requiredItems: ['key-a', 'key-b', 'salewa'] }), items).map((entry) => entry.id))
      .toEqual(['key-b', 'key-a', 'marker', 'flash'])
    expect(questRaidItems(quest('q', { requiredItems: ['salewa'] }), items)).toEqual([])
  })

  it('lists only the quests still taken, the open map first, then the newest put aside', () => {
    const maps = [{ id: 'customs', name: 'Таможня' }, { id: 'woods', name: 'Лес' }]
    const current = [quest('a', { mapId: 'woods', requiredItems: ['key-a'] }), quest('b'), quest('c', { anyMap: true, mapId: undefined }), quest('d', { mapId: undefined, trader: 'Терапевт' })]
    const deferred = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['done-since', 5]])
    const rows = deferredQuestRows(current, deferred, { maps, itemsById: items, first: (entry) => entry.mapId === 'woods' })
    expect(rows.map(({ quest: entry }) => entry.id)).toEqual(['a', 'd', 'c', 'b'])
    expect(rows.map(({ detail }) => detail)).toEqual(['Прапор · Лес', 'Терапевт · У торговца', 'Прапор · Любая карта', 'Прапор · Таможня'])
    expect(rows[0]!.items.map((entry) => entry.id)).toEqual(['key-a'])
    expect(deferredQuestRows(current, new Map(), { maps, itemsById: items })).toEqual([])
  })
})
