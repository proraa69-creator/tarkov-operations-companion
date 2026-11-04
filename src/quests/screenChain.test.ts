import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { ModeProgress, Quest, QuestInputLayers, TaskProgressRecord } from '../domain/types'
import { calculateAvailability, isCurrentTrackedQuest } from '../progression/requirementEngine'
import { emptyQuestInputs } from './questEngine'
import { commitQuestInputs } from './questInputs'
import { earlierChainParts, partHoldingBack, rowsTheChainAllows, withoutScreenQuestsAheadOfChain } from './screenChain'

/** A player's ticket №37, 04.11.2026: «Каратель. Часть 3» from the screen, the logs holding Part 1, Part 2 unknown. */
const quest = (id: string, name: string, needs: string[] = [], extra: Partial<Quest> = {}): Quest => ({
  id, name, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [],
  requirements: needs.map((taskId) => ({ taskId, allowedStatuses: ['complete'] })), ...extra,
})
const P1 = quest('p1', 'Каратель. Часть 1')
const P2 = quest('p2', 'Каратель. Часть 2', ['p1'])
const P3 = quest('p3', 'Каратель. Часть 3', ['p2'])
const BARE = quest('bare', 'Инвентаризация')
const BARE2 = quest('bare2', 'Инвентаризация. Часть 2', ['bare'])
const OTHER = quest('other', 'Городской жандарм. Часть 1', ['p3'])
const NEXT = quest('light2', 'На свет. Подрезать крылья', ['light1'])
const LIGHT = quest('light1', 'На свет. Ложный вызов')
const GUN1 = quest('gun1', 'Оружейник - Мастер. Часть 11')
const GUN2 = quest('gun2', 'Оружейник - Мастер. Часть 13', ['gun1'])
const OR = quest('or', 'Выбор. Часть 2', [], { requirements: [{ taskId: 'or1', allowedStatuses: ['complete'], group: 'a' }, { taskId: 'taken', allowedStatuses: ['active'] }] })
const OR1 = quest('or1', 'Выбор. Часть 1')
const TAKEN = quest('taken', 'Выбор. Часть 3')
const quests = [P3, P2, P1, BARE, BARE2, OTHER, LIGHT, NEXT, GUN1, GUN2, OR, OR1, TAKEN]
const byId = new Map(quests.map((entry) => [entry.id, entry]))

const at = (day: number, minute = 0) => `2026-10-${String(day).padStart(2, '0')}T12:${String(minute).padStart(2, '0')}:00.000Z`
const screen = (taskId: string, when: string): TaskProgressRecord => ({ taskId, status: 'active', source: 'screen-scan', updatedAt: when })
const log = (taskId: string, status: TaskProgressRecord['status'], when: string): TaskProgressRecord => ({ taskId, status, source: 'eft-log', updatedAt: when })
const records = (...list: TaskProgressRecord[]) => Object.fromEntries(list.map((record) => [record.taskId, record]))
const heldBack = (entry: Quest, readAt: string, ...list: TaskProgressRecord[]) => partHoldingBack(entry, readAt, records(...list), byId)?.id

describe('what a quest needs handed in first, of its own numbered chain', () => {
  it('reaches back through the parts no record knows; other names, alternatives and «taken» conditions are not its chain', () => {
    expect(earlierChainParts(P3, byId).map((entry) => entry.id).sort()).toEqual(['p1', 'p2'])
    expect(earlierChainParts(BARE2, byId).map((entry) => entry.id)).toEqual(['bare'])
    expect(earlierChainParts(OTHER, byId)).toEqual([])
    expect(earlierChainParts(OR, byId)).toEqual([])
  })

  it('nothing for a quest without a number («На свет» never logs a hand-in) or a part of «Оружейник»', () => {
    expect(earlierChainParts(NEXT, byId)).toEqual([])
    expect(earlierChainParts(GUN2, byId)).toEqual([])
  })

  it('in every language the catalog names it', () => {
    const first = quest('en1', 'Первая задача', [], { nameEn: 'Easy Job - Part 1' })
    const second = quest('en2', 'Задача другая. Часть 2', ['en1'], { nameEn: 'Easy Job - Part 2' })
    expect(earlierChainParts(second, new Map([[first.id, first], [second.id, second]])).map((entry) => entry.id)).toEqual(['en1'])
  })

  it('a chain that loops ends', () => {
    const a = quest('a', 'Круг. Часть 1', ['b'])
    const b = quest('b', 'Круг. Часть 2', ['a'])
    expect(earlierChainParts(a, new Map([[a.id, a], [b.id, b]])).map((entry) => entry.id)).toEqual(['b'])
  })
})

describe('when the logs rule a reading out', () => {
  it('an earlier part they hold open, however long ago it was taken', () => {
    expect(heldBack(P3, at(20), log('p1', 'active', at(1)))).toBe('p1')
    expect(heldBack(P2, at(20), log('p1', 'active', at(1)))).toBe('p1')
    // Taken after the reading: the same.
    expect(heldBack(P3, at(1), log('p2', 'active', at(20)))).toBe('p2')
  })

  it('an earlier part handed in after the reading, past the clocks\' slack; not one handed in before it', () => {
    expect(heldBack(P3, at(10), log('p2', 'completed', at(11)))).toBe('p2')
    expect(heldBack(P3, at(10), log('p2', 'completed', at(10, 6)))).toBe('p2')
    expect(heldBack(P3, at(10), log('p2', 'completed', at(10, 4)))).toBeUndefined()
    expect(heldBack(P3, at(10), log('p2', 'completed', at(9)))).toBeUndefined()
  })

  it('nothing else: no record of the part, a failure, the screen\'s own word or the player\'s mark', () => {
    expect(heldBack(P3, at(10))).toBeUndefined()
    expect(heldBack(P3, at(10), log('p2', 'failed', at(11)))).toBeUndefined()
    expect(heldBack(P3, at(10), screen('p2', at(5)))).toBeUndefined()
    expect(heldBack(P3, at(10), { taskId: 'p2', status: 'active', source: 'manual-fix', updatedAt: at(5) })).toBeUndefined()
  })

  it('the rows of a frame read now: only those', () => {
    const rows = [{ questId: 'p3' }, { questId: 'p1' }, { questId: 'unknown' }, { questId: 'light2' }]
    const allowed = rowsTheChainAllows(rows, records(log('p2', 'active', at(1)), log('light1', 'active', at(1))), quests, at(10))
    expect(allowed.map((row) => row.questId)).toEqual(['p1', 'unknown', 'light2'])
  })
})

describe('the layers without the records the logs rule out', () => {
  const layersOf = (partial: Partial<QuestInputLayers>): QuestInputLayers => ({ ...emptyQuestInputs(), ...partial })
  const progressOf = (layers: QuestInputLayers): ModeProgress => commitQuestInputs({ ...createModeProgress(), playerLevel: 1 }, 'pve', layers)
  const held = layersOf({ log: { p1: { status: 'active', at: at(1) } }, table: { p3: screen('p3', at(5)) } })

  it('the ticket: the false part goes from «Текущие» and proves nothing; the part the logs hold stays', () => {
    const before = progressOf(held)
    expect(isCurrentTrackedQuest(P3, before)).toBe(true)
    expect(calculateAvailability(quests, before).get('p2')?.status).toBe('completed')
    const after = progressOf(withoutScreenQuestsAheadOfChain(held, before.taskProgress, quests))
    expect(after.questInputs!.table).toEqual({})
    expect(after.taskProgress.p3).toBeUndefined()
    expect(isCurrentTrackedQuest(P3, after)).toBe(false)
    expect(isCurrentTrackedQuest(P1, after)).toBe(true)
    const availability = calculateAvailability(quests, after)
    expect(availability.get('p1')?.status).toBe('active')
    expect(availability.get('p2')?.status).toBe('locked')
    expect(availability.get('p3')?.status).toBe('locked')
  })

  it('a copy from another PC goes too, the records of its logs stay', () => {
    const layers = layersOf({ log: { p1: { status: 'active', at: at(1) } }, mirror: { p3: { ...screen('p3', at(5)), origin: 'server' }, bare2: log('bare2', 'active', at(5)) } })
    const progress = progressOf(layers)
    expect(progress.taskProgress.p3).toBeDefined()
    const kept = withoutScreenQuestsAheadOfChain(layers, progress.taskProgress, quests)
    expect(Object.keys(kept.mirror!)).toEqual(['bare2'])
  })

  it('handed in afterwards it does not come back; read again after the hand-in it does', () => {
    const layers = layersOf({ log: { p2: { status: 'completed', at: at(10) } }, table: { p3: screen('p3', at(5)) } })
    expect(withoutScreenQuestsAheadOfChain(layers, progressOf(layers).taskProgress, quests).table).toEqual({})
    const read = layersOf({ log: { p2: { status: 'completed', at: at(10) } }, table: { p3: screen('p3', at(11)) } })
    expect(withoutScreenQuestsAheadOfChain(read, progressOf(read).taskProgress, quests)).toBe(read)
  })

  it('a mark of the player\'s own stands, on the quest or on the part before it', () => {
    const onQuest = layersOf({ log: { p1: { status: 'active', at: at(1) } }, table: { p3: screen('p3', at(5)) }, manual: { p3: { status: 'active', at: at(6) } } })
    expect(withoutScreenQuestsAheadOfChain(onQuest, progressOf(onQuest).taskProgress, quests)).toBe(onQuest)
    const onPart = layersOf({ log: { p1: { status: 'active', at: at(1) } }, table: { p3: screen('p3', at(5)) }, manual: { p1: { status: 'completed', at: at(6) } } })
    expect(withoutScreenQuestsAheadOfChain(onPart, progressOf(onPart).taskProgress, quests)).toBe(onPart)
  })

  it('the same object when nothing goes: quests without a number, «Оружейник», an unknown quest', () => {
    const layers = layersOf({
      log: { light1: { status: 'active', at: at(1) }, gun1: { status: 'active', at: at(1) } },
      table: { light2: screen('light2', at(5)), gun2: screen('gun2', at(5)), unknown: screen('unknown', at(5)), p1: screen('p1', at(5)) },
    })
    expect(withoutScreenQuestsAheadOfChain(layers, progressOf(layers).taskProgress, quests)).toBe(layers)
  })
})
