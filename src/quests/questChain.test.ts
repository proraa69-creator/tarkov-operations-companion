import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { ModeProgress, Quest, QuestInputLayers, TaskProgressRecord } from '../domain/types'
import { calculateAvailability, isCurrentTrackedQuest } from '../progression/requirementEngine'
import { emptyQuestInputs } from './questEngine'
import { commitQuestInputs } from './questInputs'
import { handedInByLaterQuests, questHoldingBackIn, rowsTheChainAllows, withQuestChain } from './questChain'

/** A player's ticket №37, 04.11.2026: «Каратель. Часть 3» from the screen, the logs holding Part 1, Part 2 unknown. */
const quest = (id: string, name: string, needs: string[] = [], extra: Partial<Quest> = {}): Quest => ({
  id, name, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [],
  requirements: needs.map((taskId) => ({ taskId, allowedStatuses: ['complete'] })), ...extra,
})
const P1 = quest('p1', 'Каратель. Часть 1')
const P2 = quest('p2', 'Каратель. Часть 2', ['p1'])
const P3 = quest('p3', 'Каратель. Часть 3', ['p2'])
const OTHER = quest('other', 'Городской жандарм', ['p3'])
// The real ids of the lists: «На свет» never logs a hand-in; «Источник информации» is in no log; Отшельник's link does not hold.
const LIGHT1 = quest('6a880f5d9438980c42076efe', 'На свет. Ложный вызов')
const LIGHT2 = quest('6a8814d20d25ca7b2908e13e', 'На свет. Подрезать крылья', [LIGHT1.id])
const SOURCE = quest('63966faeea19ac7ed845db2c', 'Источник информации', ['p1'])
const TOUGH = quest('5d25cf2686f77443e75488d4', 'Путь выживальщика. Крепыш')
const HERMIT = quest('61904daa7d0d857927447b9c', 'Отшельник', [TOUGH.id])
const GUN1 = quest('gun1', 'Оружейник - Мастер. Часть 11')
const GUN2 = quest('gun2', 'Оружейник - Мастер. Часть 13', ['gun1'])
const AFTER_GUN = quest('aftergun', 'Свой человек', ['gun1'])
const CHOICE = quest('choice', 'Выбор', [], { requirements: [{ taskId: 'p1', allowedStatuses: ['complete'], group: 'a' }, { taskId: 'p2', allowedStatuses: ['active'] }] })
const OBVIOUS = quest('666314bf1cd52e3d040a2e78', 'Серьёзные обвинения')
const quests = [P3, P2, P1, OTHER, LIGHT1, LIGHT2, SOURCE, TOUGH, HERMIT, GUN1, GUN2, AFTER_GUN, CHOICE, OBVIOUS]

const at = (day: number, minute = 0) => `2026-10-${String(day).padStart(2, '0')}T12:${String(minute).padStart(2, '0')}:00.000Z`
const screen = (taskId: string, when: string): TaskProgressRecord => ({ taskId, status: 'active', source: 'screen-scan', updatedAt: when })
const log = (taskId: string, status: TaskProgressRecord['status'], when: string): TaskProgressRecord => ({ taskId, status, source: 'eft-log', updatedAt: when })
const records = (...list: TaskProgressRecord[]) => Object.fromEntries(list.map((record) => [record.taskId, record]))
const heldBack = (entry: Quest, readAt: string, ...list: TaskProgressRecord[]) => questHoldingBackIn(entry, readAt, records(...list), quests)?.id
const layersOf = (partial: Partial<QuestInputLayers>): QuestInputLayers => ({ ...emptyQuestInputs(), ...partial })
const progressOf = (layers: QuestInputLayers): ModeProgress => commitQuestInputs({ ...createModeProgress(), playerLevel: 1 }, 'pve', layers)

describe('when the logs rule a Tasks-table reading out', () => {
  it('a quest it needs, of any name and however far back, that they hold open', () => {
    expect(heldBack(P3, at(20), log('p1', 'active', at(1)))).toBe('p1')
    expect(heldBack(OTHER, at(20), log('p1', 'active', at(1)))).toBe('p1')
    // Taken after the reading: the same.
    expect(heldBack(P3, at(1), log('p2', 'active', at(20)))).toBe('p2')
  })

  it('a quest it needs handed in after the reading, past the clocks\' slack; not one handed in before it', () => {
    expect(heldBack(P3, at(10), log('p2', 'completed', at(11)))).toBe('p2')
    expect(heldBack(P3, at(10), log('p2', 'completed', at(10, 6)))).toBe('p2')
    expect(heldBack(P3, at(10), log('p2', 'completed', at(10, 4)))).toBeUndefined()
    expect(heldBack(P3, at(10), log('p2', 'completed', at(9)))).toBeUndefined()
  })

  it('nothing else: no record of it, a failure, the screen\'s own word, the player\'s mark, a condition that is no completion', () => {
    expect(heldBack(P3, at(10))).toBeUndefined()
    expect(heldBack(P3, at(10), log('p2', 'failed', at(11)))).toBeUndefined()
    expect(heldBack(P3, at(10), screen('p2', at(5)))).toBeUndefined()
    expect(heldBack(P3, at(10), { taskId: 'p2', status: 'active', source: 'manual-fix', updatedAt: at(5) })).toBeUndefined()
    expect(heldBack(CHOICE, at(10), log('p1', 'active', at(1)), log('p2', 'active', at(1)))).toBeUndefined()
  })

  it('not by a quest whose hand-ins the logs miss, not of a quest no log names, not over a link that does not hold, not «Оружейник»', () => {
    expect(heldBack(LIGHT2, at(10), log(LIGHT1.id, 'active', at(1)))).toBeUndefined()
    // Its hand-in logged after the reading is still a fact.
    expect(heldBack(LIGHT2, at(10), log(LIGHT1.id, 'completed', at(11)))).toBe(LIGHT1.id)
    expect(heldBack(SOURCE, at(10), log('p1', 'active', at(1)))).toBeUndefined()
    expect(heldBack(HERMIT, at(10), log(TOUGH.id, 'completed', at(11)))).toBeUndefined()
    expect(heldBack(GUN2, at(10), log('gun1', 'active', at(1)))).toBeUndefined()
    expect(heldBack(AFTER_GUN, at(10), log('gun1', 'active', at(1)))).toBeUndefined()
  })

  it('a chain that loops ends', () => {
    const a = quest('a', 'Круг. Часть 1', ['b'])
    const b = quest('b', 'Круг. Часть 2', ['a'])
    expect(questHoldingBackIn(a, at(10), records(log('b', 'active', at(1))), [a, b])?.id).toBe('b')
  })

  it('the rows of a frame read now: only those', () => {
    const rows = [{ questId: 'p3' }, { questId: 'p1' }, { questId: 'unknown' }, { questId: LIGHT2.id }]
    const allowed = rowsTheChainAllows(rows, records(log('p2', 'active', at(1)), log(LIGHT1.id, 'active', at(1))), quests, at(10))
    expect(allowed.map((row) => row.questId)).toEqual(['p1', 'unknown', LIGHT2.id])
  })
})

describe('a quest the logs hold open past a later one', () => {
  it('counts as handed in: taken or handed in after it, however far down its chain', () => {
    expect(handedInByLaterQuests(records(log('p1', 'active', at(1)), log('p2', 'active', at(2))), quests)).toEqual(['p1'])
    expect(handedInByLaterQuests(records(log('p1', 'active', at(1)), log('p3', 'completed', at(2))), quests)).toEqual(['p1'])
    expect(handedInByLaterQuests(records(log(LIGHT1.id, 'active', at(1)), log(LIGHT2.id, 'active', at(2))), quests)).toEqual([LIGHT1.id])
  })

  it('not on the screen\'s or a mark\'s word, not taken again after the later one, not over a link that does not hold, not «Оружейник»', () => {
    expect(handedInByLaterQuests(records(log('p1', 'active', at(1)), screen('p2', at(2))), quests)).toEqual([])
    expect(handedInByLaterQuests(records(log('p1', 'active', at(1)), { taskId: 'p2', status: 'active', source: 'manual-fix', updatedAt: at(2) }), quests)).toEqual([])
    expect(handedInByLaterQuests(records(log('p1', 'active', at(3)), log('p2', 'active', at(2))), quests)).toEqual([])
    expect(handedInByLaterQuests(records(log('p1', 'active', at(1)), log('p2', 'failed', at(2))), quests)).toEqual([])
    expect(handedInByLaterQuests(records(log(TOUGH.id, 'active', at(1)), log(HERMIT.id, 'active', at(2))), quests)).toEqual([])
    expect(handedInByLaterQuests(records(log('gun1', 'active', at(1)), log('gun2', 'active', at(2)), log('aftergun', 'active', at(2))), quests)).toEqual([])
    const fitness = quest('fit1', 'Профпригодность - Часть 1 [PVE ZONE]')
    const deal = quest('deal', 'Сделка с совестью. Часть 1 [PVE ZONE]', ['fit1'])
    expect(handedInByLaterQuests(records(log('fit1', 'active', at(1)), log('deal', 'active', at(2))), [fitness, deal])).toEqual([])
  })

  it('goes from «Текущие» and stays gone at the next scan; a newer event of the game or a mark decides over it', () => {
    const held = layersOf({ log: { p1: { status: 'active', at: at(1) }, p2: { status: 'active', at: at(2) } } })
    const before = progressOf(held)
    expect(isCurrentTrackedQuest(P1, before)).toBe(true)
    const chained = withQuestChain(held, before.taskProgress, quests)
    expect(chained.server.p1).toEqual({ status: 'completed', at: '2026-10-01T12:00:00.001Z' })
    const after = progressOf(chained)
    expect(after.taskProgress.p1).toMatchObject({ status: 'completed', source: 'eft-log', origin: 'server' })
    expect(isCurrentTrackedQuest(P1, after)).toBe(false)
    expect(isCurrentTrackedQuest(P2, after)).toBe(true)
    expect(withQuestChain(chained, after.taskProgress, quests)).toBe(chained)
    // Taken again (a new prestige).
    const again = { ...chained, log: { ...chained.log, p1: { status: 'active' as const, at: at(9) } } }
    expect(progressOf(again).taskProgress.p1).toMatchObject({ status: 'active' })
    // «Отменить»: a mark, newer than it.
    const marked = { ...chained, manual: { p1: { status: 'active' as const, at: at(9) } } }
    const undone = progressOf(marked)
    expect(undone.taskProgress.p1).toMatchObject({ status: 'active', source: 'manual-fix' })
    expect(withQuestChain(marked, undone.taskProgress, quests)).toBe(marked)
  })

  it('rules out no reading of another quest after it: its time is only a moment after it was taken', () => {
    const sibling = quest('sibling', 'Сосед', ['p1'])
    const catalog = [...quests, sibling]
    const layers = layersOf({ log: { p1: { status: 'active', at: at(1) }, p2: { status: 'active', at: at(20) } }, table: { sibling: screen('sibling', at(10)) } })
    const chained = withQuestChain(layers, progressOf(layers).taskProgress, catalog)
    expect(chained.table).toEqual(layers.table)
    expect(chained.server.p1).toMatchObject({ status: 'completed' })
    expect(withQuestChain(chained, progressOf(chained).taskProgress, catalog)).toBe(chained)
  })
})

describe('the layers with the chain applied', () => {
  const held = layersOf({ log: { p1: { status: 'active', at: at(1) } }, table: { p3: screen('p3', at(5)) } })

  it('the ticket: the false part goes from «Текущие» and proves nothing; the part the logs hold stays', () => {
    const before = progressOf(held)
    expect(isCurrentTrackedQuest(P3, before)).toBe(true)
    expect(calculateAvailability(quests, before).get('p2')?.status).toBe('completed')
    const after = progressOf(withQuestChain(held, before.taskProgress, quests))
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
    const layers = layersOf({ log: { p1: { status: 'active', at: at(1) } }, mirror: { p3: { ...screen('p3', at(5)), origin: 'server' }, choice: log('choice', 'active', at(5)) } })
    const kept = withQuestChain(layers, { ...progressOf(layers).taskProgress }, quests)
    expect(Object.keys(kept.mirror!)).toEqual(['choice'])
  })

  it('handed in afterwards it does not come back; read again after the hand-in it does', () => {
    const layers = layersOf({ log: { p2: { status: 'completed', at: at(10) } }, table: { p3: screen('p3', at(5)) } })
    expect(withQuestChain(layers, progressOf(layers).taskProgress, quests).table).toEqual({})
    const read = layersOf({ log: { p2: { status: 'completed', at: at(10) } }, table: { p3: screen('p3', at(11)) } })
    expect(withQuestChain(read, progressOf(read).taskProgress, quests)).toBe(read)
  })

  it('a title the old reader invented is read again: its record from before this PC\'s first sync goes, whenever the PC updated; one read since stays', () => {
    const before = layersOf({ table: { [OBVIOUS.id]: screen(OBVIOUS.id, at(5)) } })
    expect(withQuestChain(before, progressOf(before).taskProgress, quests, at(6)).table).toEqual({})
    const after = layersOf({ table: { [OBVIOUS.id]: screen(OBVIOUS.id, at(6)) } })
    expect(withQuestChain(after, progressOf(after).taskProgress, quests, at(6))).toBe(after)
    // A device with no reader (the phone) has no such time: the PC's copy decides there, or a real one would never come back.
    expect(withQuestChain(before, progressOf(before).taskProgress, quests)).toBe(before)
    // By the logs it is not the reader's.
    const logged = layersOf({ log: { [OBVIOUS.id]: { status: 'active', at: at(5) } } })
    expect(withQuestChain(logged, progressOf(logged).taskProgress, quests, at(6))).toBe(logged)
  })

  // A player, 13.11.2026: «Отмечает у меня квесты либо которые я сделал» — the screen read as current a quest whose later
  // quest the logs show taken; the reading held it in «Текущие» for days.
  it('read as current though the logs show a later quest of its chain taken or handed in: handed in, gone from «Текущие»', () => {
    const layers = layersOf({ log: { p3: { status: 'active', at: at(10) } }, table: { p1: screen('p1', at(11)), p2: screen('p2', at(11)) } })
    const before = progressOf(layers)
    expect(isCurrentTrackedQuest(P2, before)).toBe(true)
    const chained = withQuestChain(layers, before.taskProgress, quests)
    expect(chained.table).toEqual({})
    const after = progressOf(chained)
    expect(after.taskProgress.p1?.status).toBe('completed')
    expect(after.taskProgress.p2?.status).toBe('completed')
    expect(isCurrentTrackedQuest(P2, after)).toBe(false)
    expect(isCurrentTrackedQuest(P3, after)).toBe(true)
    // A handed-in later quest says the same; the player's own mark still decides over it.
    const done = layersOf({ log: { other: { status: 'completed', at: at(10) } }, table: { p3: screen('p3', at(11)) }, manual: { p3: { status: 'active', at: at(12) } } })
    expect(progressOf(withQuestChain(done, progressOf(done).taskProgress, quests)).taskProgress.p3?.status).toBe('active')
  })

  it('a mark of the player\'s own stands, on the quest or on the one before it', () => {
    const onQuest = layersOf({ log: { p1: { status: 'active', at: at(1) } }, table: { p3: screen('p3', at(5)) }, manual: { p3: { status: 'active', at: at(6) } } })
    expect(withQuestChain(onQuest, progressOf(onQuest).taskProgress, quests, at(6))).toBe(onQuest)
    const onPart = layersOf({ log: { p1: { status: 'active', at: at(1) } }, table: { p3: screen('p3', at(5)) }, manual: { p1: { status: 'completed', at: at(6) } } })
    expect(withQuestChain(onPart, progressOf(onPart).taskProgress, quests, at(6))).toBe(onPart)
  })

  it('the same object when nothing changes: a chain the logs miss, «Оружейник», a quest no log names, an unknown quest', () => {
    const layers = layersOf({
      log: { [LIGHT1.id]: { status: 'active', at: at(1) }, gun1: { status: 'active', at: at(1) }, p1: { status: 'active', at: at(1) } },
      table: { [LIGHT2.id]: screen(LIGHT2.id, at(5)), gun2: screen('gun2', at(5)), unknown: screen('unknown', at(5)), [SOURCE.id]: screen(SOURCE.id, at(5)) },
    })
    expect(withQuestChain(layers, progressOf(layers).taskProgress, quests)).toBe(layers)
  })
})
