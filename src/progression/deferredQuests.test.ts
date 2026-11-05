import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Item, Quest } from '../domain/types'
import {
  applyRemoteDeferredQuests, clearDeferredQuests, DEFERRED_QUESTS_EVENT, deferredSyncEntries, clearAllDeferredQuests, deferQuest, deferQuests, deferralDue, deferralTermText, deferredQuestRows, deferredQuestsKey, questRaidItems,
  readDeferredQuests, restoreDeferredQuests, settleDeferredQuests, useDeferredQuests,
} from './deferredQuests'

const DAY = 24 * 60 * 60 * 1000

const item = (id: string, category: Item['category'] = 'Бартер'): Item => ({ id, name: `Предмет ${id}`, shortName: id, category, description: '', prices: [], iconUrl: `https://assets.example/${id}.webp` })
const quest = (id: string, extra: Partial<Quest> = {}): Quest => ({ id, name: `Квест ${id}`, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], mapId: 'customs', ...extra })
const items = new Map([item('key-a', 'Ключ'), item('key-b', 'Ключ'), item('marker'), item('flash'), item('salewa', 'Медицина'), item('gpu')].map((entry) => [entry.id, entry]))

afterEach(() => localStorage.clear())

// Owner, 04.11.2026; a player's report: «все равно показывается даже с учетом того что на ПК они закрыты».
describe('«Отложенные квесты»: one list on every device of the account', () => {
  const iso = (ms: number) => new Date(ms).toISOString()
  const T = Date.parse('2026-11-04T10:00:00.000Z')
  /** The server: the newest per quest, as server/src/services/userDataStore.ts keeps it. */
  const server = () => {
    const kept = new Map<string, ReturnType<typeof deferredSyncEntries>[number]>()
    return {
      exchange: (device: string) => {
        for (const quest of deferredSyncEntries(device, 'pvp')) if (!kept.has(quest.taskId) || quest.at > kept.get(quest.taskId)!.at) kept.set(quest.taskId, quest)
        applyRemoteDeferredQuests(device, 'pvp', [...kept.values()])
      },
    }
  }

  it('put aside on the PC, gone from the phone with its term; «Вернуть» on the phone brings it back on the PC', () => {
    const cloud = server()
    deferQuests('pc', 'pvp', ['q1'], { days: 2 }, T)
    deferQuest('pc', 'pvp', 'q2', T + 1)
    cloud.exchange('pc')
    cloud.exchange('phone')
    expect([...readDeferredQuests('phone', 'pvp')]).toEqual([['q1', { at: T, until: T + 2 * DAY }], ['q2', { at: T + 1 }]])
    restoreDeferredQuests('phone', 'pvp', ['q1'], T + 10)
    cloud.exchange('phone')
    cloud.exchange('pc')
    expect([...readDeferredQuests('pc', 'pvp').keys()]).toEqual(['q2'])
    // And it stays back: the PC sends what it knows and nothing returns.
    cloud.exchange('pc')
    cloud.exchange('phone')
    expect([...readDeferredQuests('phone', 'pvp').keys()]).toEqual(['q2'])
  })

  it('the newest choice wins whichever device spoke last', () => {
    const cloud = server()
    deferQuest('pc', 'pvp', 'q1', T)
    cloud.exchange('pc')
    cloud.exchange('phone')
    // The phone returns it first, then the PC, not having heard, puts it aside again later.
    restoreDeferredQuests('phone', 'pvp', ['q1'], T + 10)
    restoreDeferredQuests('pc', 'pvp', ['q1'], T + 5)
    deferQuests('pc', 'pvp', ['q1'], { level: 20 }, T + 20)
    cloud.exchange('phone')
    cloud.exchange('pc')
    cloud.exchange('phone')
    expect([...readDeferredQuests('phone', 'pvp')]).toEqual([['q1', { at: T + 20, level: 20 }]])
    expect([...readDeferredQuests('pc', 'pvp')]).toEqual([['q1', { at: T + 20, level: 20 }]])
  })

  it('what this device already holds goes up at the first exchange: nothing is lost by the update', () => {
    localStorage.setItem(deferredQuestsKey('pc', 'pvp'), JSON.stringify({ q1: T, q2: { at: T, loyalty: { traderId: 'prapor', trader: 'Прапор', level: 2 } } }))
    expect(deferredSyncEntries('pc', 'pvp')).toEqual([
      { taskId: 'q1', status: 'deferred', at: iso(T) },
      { taskId: 'q2', status: 'deferred', at: iso(T), loyalty: { traderId: 'prapor', trader: 'Прапор', level: 2 } },
    ])
  })

  it('tells the lists only when they changed, and a quest another device returned lets go of its «Избранное»', () => {
    deferQuest('pc', 'pvp', 'q1', T)
    const heard = vi.fn()
    window.addEventListener(DEFERRED_QUESTS_EVENT, heard)
    try {
      applyRemoteDeferredQuests('pc', 'pvp', [{ taskId: 'q1', status: 'deferred', at: iso(T) }])
      applyRemoteDeferredQuests('pc', 'pvp', [])
      expect(heard).not.toHaveBeenCalled()
      applyRemoteDeferredQuests('pc', 'pvp', [{ taskId: 'q1', status: 'returned', at: iso(T + 1) }])
      expect(heard).toHaveBeenCalledTimes(1)
      expect(readDeferredQuests('pc', 'pvp').size).toBe(0)
    } finally { window.removeEventListener(DEFERRED_QUESTS_EVENT, heard) }
  })

  it('a reset of the mode: nothing older stays or comes back, here or on a device that slept through it; a newer choice does', () => {
    deferQuest('pc', 'pvp', 'q1', T)
    deferQuest('pc', 'pve', 'q9', T)
    deferQuest('phone', 'pvp', 'q2', T)
    clearDeferredQuests('pc', 'pvp', T + 10)
    expect(readDeferredQuests('pc', 'pvp').size).toBe(0)
    expect(readDeferredQuests('pc', 'pve').size).toBe(1)
    expect(deferredSyncEntries('pc', 'pvp')).toEqual([])
    // The server still has it (the reset is on its way): it does not come back here.
    applyRemoteDeferredQuests('pc', 'pvp', [{ taskId: 'q1', status: 'deferred', at: iso(T) }])
    expect(readDeferredQuests('pc', 'pvp').size).toBe(0)
    // The phone hears of the reset: what it held from before goes.
    applyRemoteDeferredQuests('phone', 'pvp', [], iso(T + 10))
    expect(readDeferredQuests('phone', 'pvp').size).toBe(0)
    applyRemoteDeferredQuests('phone', 'pvp', [{ taskId: 'q3', status: 'deferred', at: iso(T + 20) }], iso(T + 10))
    expect([...readDeferredQuests('phone', 'pvp').keys()]).toEqual(['q3'])
  })

  it('«Удалить все данные» takes the notes too', () => {
    restoreDeferredQuests('pc', 'pvp', ['q1'], T)
    deferQuest('pc', 'pvp', 'q1', T)
    restoreDeferredQuests('pc', 'pvp', ['q1'], T + 1)
    clearAllDeferredQuests()
    expect(deferredSyncEntries('pc', 'pvp')).toEqual([])
    expect(localStorage.length).toBe(0)
  })
})

describe('«Отложенные квесты»: the store', () => {
  it('keeps each profile and mode apart and returns quests on «Вернуть»', () => {
    deferQuest('p1', 'pvp', 'q1', 1000)
    deferQuest('p1', 'pvp', 'q2', 2000)
    deferQuest('p1', 'pve', 'q3', 3000)
    expect([...readDeferredQuests('p1', 'pvp')]).toEqual([['q1', { at: 1000 }], ['q2', { at: 2000 }]])
    // Without a term the entry stays the bare time, as before terms.
    expect(JSON.parse(localStorage.getItem(deferredQuestsKey('p1', 'pvp'))!)).toEqual({ q1: 1000, q2: 2000 })
    expect([...readDeferredQuests('p1', 'pve').keys()]).toEqual(['q3'])
    expect(readDeferredQuests('p1', 'seasonal').size).toBe(0)
    expect(readDeferredQuests('p2', 'pvp').size).toBe(0)
    // Put aside again: it keeps its first time.
    deferQuest('p1', 'pvp', 'q1', 5000)
    expect(readDeferredQuests('p1', 'pvp').get('q1')).toEqual({ at: 1000 })
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

describe('«Отложить квест»: for days or until a level', () => {
  afterEach(() => vi.useRealTimers())

  it('stores the term, a new term replaces the old one, and the old entries still read', () => {
    localStorage.setItem(deferredQuestsKey('p1', 'pvp'), JSON.stringify({ old: 500, broken: { until: 9 } }))
    deferQuests('p1', 'pvp', ['a', 'b'], { days: 3 }, 1000)
    deferQuests('p1', 'pvp', ['c'], { level: 20 }, 2000)
    expect(Object.fromEntries(readDeferredQuests('p1', 'pvp'))).toEqual({ old: { at: 500 }, a: { at: 1000, until: 1000 + 3 * DAY }, b: { at: 1000, until: 1000 + 3 * DAY }, c: { at: 2000, level: 20 } })
    // put aside again from the Overview: the new term
    deferQuests('p1', 'pvp', ['a'], { level: 15 }, 3000)
    expect(readDeferredQuests('p1', 'pvp').get('a')).toEqual({ at: 3000, level: 15 })
    // the other modes keep nothing of it
    expect(readDeferredQuests('p1', 'pve').size).toBe(0)
  })

  it('a term comes at its time or at the level; none never does', () => {
    expect(deferralDue({ at: 0, until: 100 }, 99, 79)).toBe(false)
    expect(deferralDue({ at: 0, until: 100 }, 100, 1)).toBe(true)
    expect(deferralDue({ at: 0, level: 20 }, Infinity, 19)).toBe(false)
    expect(deferralDue({ at: 0, level: 20 }, 0, 20)).toBe(true)
    expect(deferralDue({ at: 0 }, Infinity, 79)).toBe(false)
  })

  // Owner, 03.11.2026: «уровень лояльности расходится в блоках» — a trader's offer waits for his loyalty, not the level.
  it('until a trader\'s loyalty: stored with the trader, due at that loyalty only; a damaged one reads without it', () => {
    const therapist = { traderId: 't1', trader: 'Терапевт', level: 2 }
    deferQuests('p1', 'pve', ['q'], { loyalty: therapist }, 1000)
    expect(JSON.parse(localStorage.getItem(deferredQuestsKey('p1', 'pve'))!)).toEqual({ q: { at: 1000, loyalty: therapist } })
    const entry = readDeferredQuests('p1', 'pve').get('q')!
    expect(entry).toEqual({ at: 1000, loyalty: therapist })
    expect(deferralDue(entry, Infinity, 79)).toBe(false)
    expect(deferralDue(entry, 0, 1, new Map([['t1', 1]]))).toBe(false)
    expect(deferralDue(entry, 0, 1, new Map([['t1', 2]]))).toBe(true)
    expect(deferralDue(entry, 0, 1, new Map([['t2', 4]]))).toBe(false)
    expect(deferralTermText(entry, 'ru')).toBe('до лояльности 2 · Терапевт')
    localStorage.setItem(deferredQuestsKey('p1', 'pve'), JSON.stringify({ q: { at: 5, loyalty: { trader: 'Терапевт', level: 2 } } }))
    expect(readDeferredQuests('p1', 'pve').get('q')).toEqual({ at: 5 })
  })

  it('says the term in the app\'s language', () => {
    expect(deferralTermText({ at: 0, level: 20 }, 'ru')).toBe('до 20 уровня')
    expect(deferralTermText({ at: 0, level: 20 }, 'en')).toBe('until level 20')
    const until = Date.UTC(2026, 10, 6, 12, 30)
    expect(deferralTermText({ at: 0, until }, 'ru')).toBe(`до ${new Date(until).toLocaleString('ru', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`)
    expect(deferralTermText({ at: 0, until }, 'en')).toMatch(/^until Nov \d/)
    expect(deferralTermText({ at: 0 }, 'ru')).toBe('')
    expect(deferralTermText(undefined, 'en')).toBe('')
  })

  it('brings a quest back by itself when its days are over, and leaves the store', () => {
    vi.useFakeTimers({ now: 10 * DAY })
    deferQuests('p1', 'pvp', ['timed'], { days: 2 })
    deferQuest('p1', 'pvp', 'kept')
    const { result } = renderHook(() => useDeferredQuests('p1', 'pvp', 1))
    expect([...result.current.keys()]).toEqual(['timed', 'kept'])
    act(() => { vi.advanceTimersByTime(2 * DAY - 1000) })
    expect(result.current.has('timed')).toBe(true)
    act(() => { vi.advanceTimersByTime(2000) })
    expect([...result.current.keys()]).toEqual(['kept'])
    expect([...readDeferredQuests('p1', 'pvp').keys()]).toEqual(['kept'])
  })

  it('brings a quest back once the level of its mode reaches the term, never on another mode\'s level', () => {
    deferQuests('p1', 'pvp', ['flea'], { level: 15 })
    deferQuests('p1', 'pve', ['flea'], { level: 30 })
    const { result, rerender } = renderHook(({ level }) => ({ pvp: useDeferredQuests('p1', 'pvp', level), pve: useDeferredQuests('p1', 'pve', 20) }), { initialProps: { level: 12 } })
    expect(result.current.pvp.has('flea')).toBe(true)
    rerender({ level: 15 })
    expect(result.current.pvp.has('flea')).toBe(false)
    expect(readDeferredQuests('p1', 'pvp').size).toBe(0)
    // PvE: 20 is below its own term
    expect(result.current.pve.has('flea')).toBe(true)
    // a lower level later (a prestige) does not put it aside again
    rerender({ level: 1 })
    expect(result.current.pvp.has('flea')).toBe(false)
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

  it('a quest done while put aside leaves its own mode\'s list only, and tells the other devices', () => {
    deferQuest('p1', 'pvp', 'done', 10)
    deferQuest('p1', 'pvp', 'open', 10)
    deferQuest('p1', 'pve', 'done', 10)
    settleDeferredQuests('p1', (mode, questId) => mode === 'pvp' && questId === 'done')
    expect([...readDeferredQuests('p1', 'pvp').keys()]).toEqual(['open'])
    expect([...readDeferredQuests('p1', 'pve').keys()]).toEqual(['done'])
    expect(deferredSyncEntries('p1', 'pvp').find((entry) => entry.taskId === 'done')?.status).toBe('returned')
  })

  it('lists only the quests still taken, the open map first, then the newest put aside', () => {
    const maps = [{ id: 'customs', name: 'Таможня' }, { id: 'woods', name: 'Лес' }]
    const current = [quest('a', { mapId: 'woods', requiredItems: ['key-a'] }), quest('b'), quest('c', { anyMap: true, mapId: undefined }), quest('d', { mapId: undefined, trader: 'Терапевт' })]
    const deferred = new Map([['a', { at: 1 }], ['b', { at: 2 }], ['c', { at: 3, level: 20 }], ['d', { at: 4 }], ['done-since', { at: 5 }]])
    const rows = deferredQuestRows(current, deferred, { maps, itemsById: items, first: (entry) => entry.mapId === 'woods' })
    expect(rows.map(({ quest: entry }) => entry.id)).toEqual(['a', 'd', 'c', 'b'])
    expect(rows.map(({ detail }) => detail)).toEqual(['Прапор · Лес', 'Терапевт · У торговца', 'Прапор · Любая карта', 'Прапор · Таможня'])
    expect(rows.map(({ place }) => place)).toEqual(['Лес', 'У торговца', 'Любая карта', 'Таможня'])
    expect(rows[0]!.items.map((entry) => entry.id)).toEqual(['key-a'])
    expect(rows[2]!.entry).toEqual({ at: 3, level: 20 })
    expect(deferredQuestRows(current, new Map(), { maps, itemsById: items })).toEqual([])
  })
})
