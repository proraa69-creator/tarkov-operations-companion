/**
 * The quests of a mode against their catalog's chain (a player's ticket №37, 04.11.2026; owner: «если у человека есть
 * каратель часть 1, у него не должно быть части 3… это могут быть разные квесты, но если они идут по цепочке»;
 * docs/quests/quest-state-engine.md «The chain against the records»). The engine has no catalog at a write, so this works
 * on its layers with one, whenever a mode's records change: its output then follows everywhere.
 *
 * - A Tasks-table record the logs rule out goes: a quest the screen alone knows, while they hold a quest it needs open, or
 *   show that quest handed in after the reading.
 * - A quest the logs hold open goes on as handed in, when they show a later quest of its chain taken: the game gives no one
 *   that before the hand-in, which they missed.
 *
 * Measured on every player's logs that day: a later quest logged with a mandatory earlier one open in 86 cases against 6629
 * with it closed, once the quests below are set apart; an earlier one handed in within 30 days after the later was taken in
 * 17 of 3400 cases, 13 of them the two pairs of NOT_IN_THE_GAME.
 */
import type { Quest, QuestInputLayers, TaskProgressRecord } from '../domain/types'
import { isGunsmithQuest } from '../gunsmith/gunsmith'
import { isCompletionOnly, isLiveGameQuest, questRequirements } from '../progression/questBasics'

/** Hand-ins and readings may come from PCs whose clocks differ a little. */
const CLOCK_SLACK_MS = 5 * 60 * 1000

/**
 * Quests whose hand-ins the logs mostly miss: open in them with a later quest logged 15% of the time or more, three times
 * at least. Their being open says nothing about the quests after them.
 */
const LOGS_MISS_THE_HAND_IN: ReadonlySet<string> = new Set([
  '5d25b6be86f77444001e1b89', // Путь выживальщика. Запасливый 32 / 152
  '5d25aed386f77442734d25d2', // Путь выживальщика. Беззащитен, но опасен 21 / 80
  '5d25cf2686f77443e75488d4', // Путь выживальщика. Крепыш 16 / 62
  '5d25e2d886f77442734d335e', // Путь выживальщика. Контролёр 20 / 19
  '5d25d2c186f77443e35162e5', // Путь выживальщика. Хладнокровный 10 / 25
  '6a880f5d9438980c42076efe', // На свет. Ложный вызов 31 / 0
  '6a8814d20d25ca7b2908e13e', // На свет. Подрезать крылья 25 / 0
  '6a8820cb1f2b560baf0408a1', // На свет. Время разбрасывать камни 22 / 1
  '69788d4e963f08d9140bce19', // Профпригодность - Часть 1 [PVE ZONE] 17 / 2
  '69788c2bac719606e40b4e77', // Профпригодность - Часть 1 [PVP ZONE] 12 / 1
  '6978907718bd6d7cbd0e8b8e', // Профпригодность. Часть 2 [PVE ZONE] 4 / 13
  '697878057aa1273126030fb0', // Дела на Арене [PVE ZONE] 7 / 1
  '66058ccde8e4f17985230807', // Сделка с совестью. Часть 2 [PVP ZONE] 6 / 1
  '68342446a8d674b5740b31fc', // Сделка с совестью. Часть 2 [PVE ZONE] 6 / 3
  '68341eb25619c8e2a9031501', // Вперед, к вершинам! Часть 1 [PVE ZONE] 4 / 4
  '68341f6fe2e7ef70a3060a0a', // Вперед, к вершинам! Часть 2 [PVE ZONE] 5 / 1
  '6834202a186efa3c5b07f9a2', // Вперед, к вершинам! Часть 3 [PVE ZONE] 3 / 1
  '683421515619c8e2a9031511', // Вперед, к вершинам! Часть 4 [PVE ZONE] 3 / 1
])

/** Quests no log has ever named, held by players all the same: only the screen shows them, so the logs cannot rule them out. */
const LOGS_NEVER_NAME: ReadonlySet<string> = new Set([
  '673f2cd5d3346c2167020484', // Задержка отправления. Часть 2
  '673f4e956f1b89c7bc0f56ef', // Шиномонтажка
  '673f5a4976553f78350bdac1', // Шиномонтажка. Вторая попытка
  '6745fcded0fbbc74ca0f721d', // Скорая расплата
  '673f6027352b4da8e00322d2', // Неизбежный ответ
  '6740a02a69a58fceba0ff399', // Натуральный обмен
  '6744a728352b4da8e003eda9', // Поменять батарейку
  '63966faeea19ac7ed845db2c', // Источник информации
  '63966fccac6f8f3c677b9d89', // Контр-компромат
  '6834287b7559f4e6d50bc0fa', // Отложенная награда [PVE ZONE]
  'raidos-balance-fog-of-war', // Туман войны
])

/** Links of the catalog the logs contradict: the later quest taken, the earlier handed in days after it. */
const NOT_IN_THE_GAME: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['61904daa7d0d857927447b9c', new Set(['5d25cf2686f77443e75488d4'])], // Отшельник ← Путь выживальщика. Крепыш: 8 of 33
  ['666314b2a9290f9e0806cca3', new Set(['666314b0acf8442f8b0531a1'])], // Ад на земле. Часть 2 ← Часть 1: 5 of 40
])

/**
 * The Arena's line («[PVP ZONE]», «[PVE ZONE]»): a quest there the logs hold open is not taken as handed in by a later one.
 * They show almost no hand-ins of it at all («Профпригодность - Часть 1» 29 open against 3 closed, «Дела на Арене» 7 against 1),
 * so nothing says the game needs them closed rather than only taken, as the catalog of PvP says of «Обеспечить просмотры».
 */
const ARENA_LINE = /\[\s*(?:PVP|PVE)\s*ZONE\s*\]/i

/**
 * The titles the old reader made out of a quest's text on the Tasks screen or a lost number (src/import/questOcr.ts isTableRow
 * and the part's number), held by the screen far beyond their share in the logs. Their records from before this PC began the
 * mode's first sync with the mended reader (`tableSync.startedAt`, src/import/tableSync.ts) go, whenever the PC updated; that
 * read brings a real one back. A device with no reader has no such time and leaves them: the PC's copy decides there.
 */
const MISREAD_BEFORE_THE_MENDING: ReadonlySet<string> = new Set([
  '666314bf1cd52e3d040a2e78', // Серьёзные обвинения: screen 17, logs 5
  '5ac3460c86f7742880308185', // Садоводство. Часть 2: 24, 45
  '6573387d0b26ed4fde798de3', // Инвентаризация. Часть 2: 37, 19
  '6179acbdc760af5ad2053585', // Простая задача. Часть 2: 15, 17
  '64f3176921045e77405d63b5', // Фельдшер: 32, 213
  '6089743983426423753cd58a', // Безопасный коридор: 24, 114
  '626bdcc3a371ee3a7a3514c5', // Залётные: 15, 79
  '60896b7bfa70fc097863b8f5', // Документы: 18, 122
  '626bd75d5bef5d7d590bd415', // Совершенно секретно: 14, 97
  '67b45467814ab0ffa000c7e7', // Искусство взрывотехники: 12, 78
  '666314a1920800278d0f6746', // Специальное предложение: 7, 19
  '61958c366726521dd96828ec', // Подарки из Таркова: 9, 60
  '6740a3f4eca8acb2d2055159', // Палки в колёса: 5, 12
  '5ac3479086f7742880308199', // Свой человек: 6, 36
  '67af4c169d95ad16e004fd86', // Гарантия безопасности: 5, 29
  '64e7b99017ab941a6f7bf9d7', // Городской жандарм. Охранник супермаркета: 2, 7
  '697895b6c639962b2e0cf268', // Удержаться в лидерах [PVP ZONE]
  '69789660b2187365e70bb94a', // Удержаться в лидерах [PVE ZONE]: 6, 2
])

interface ChainIndex { byId: ReadonlyMap<string, Quest>; before: Map<string, Quest[]> }
const indexes = new WeakMap<readonly Quest[], ChainIndex>()

function chainIndex(quests: readonly Quest[]): ChainIndex {
  const known = indexes.get(quests)
  if (known) return known
  const index = { byId: new Map(quests.map((quest) => [quest.id, quest])), before: new Map<string, Quest[]>() }
  indexes.set(quests, index)
  return index
}

/**
 * The quests one must hand in before this one, however far back: its mandatory, completion-only prerequisites. Not the
 * «Оружейник» parts (their catalog chain does not hold: gunsmithFromLogs).
 */
function questsBefore(quest: Quest, index: ChainIndex): Quest[] {
  const known = index.before.get(quest.id)
  if (known) return known
  const before: Quest[] = []
  if (isLiveGameQuest(quest) && !isGunsmithQuest(quest)) {
    const seen = new Set([quest.id])
    const stack = [quest]
    while (stack.length) {
      const current = stack.pop()!
      for (const requirement of questRequirements(current)) {
        if (!isCompletionOnly(requirement) || seen.has(requirement.taskId) || NOT_IN_THE_GAME.get(current.id)?.has(requirement.taskId)) continue
        seen.add(requirement.taskId)
        const earlier = index.byId.get(requirement.taskId)
        if (!earlier || !isLiveGameQuest(earlier) || isGunsmithQuest(earlier)) continue
        before.push(earlier)
        stack.push(earlier)
      }
    }
  }
  index.before.set(quest.id, before)
  return before
}

/**
 * The quest that says a Tasks-table reading of this one at `readAt` cannot be: the logs hold it not handed in yet, or show its
 * hand-in after the reading (no one sees the next quest before that, and a record keeps the time of its first reading). A
 * mark of the player's own on it is no log record, so it rules nothing out.
 */
function questHoldingBack(quest: Quest, readAt: string, records: Record<string, TaskProgressRecord>, index: ChainIndex) {
  if (LOGS_NEVER_NAME.has(quest.id)) return undefined
  const read = Date.parse(readAt)
  return questsBefore(quest, index).find((before) => {
    const record = records[before.id]
    if (record?.source !== 'eft-log') return false
    if (record.status === 'active') return !LOGS_MISS_THE_HAND_IN.has(before.id)
    return record.status === 'completed' && Date.parse(record.updatedAt) > read + CLOCK_SLACK_MS
  })
}

/** The same for one quest and a catalog (the checks, src/quests/questChecks.ts). */
export function questHoldingBackIn(quest: Quest, readAt: string, records: Record<string, TaskProgressRecord>, quests: readonly Quest[]) {
  return questHoldingBack(quest, readAt, records, chainIndex(quests))
}

/** The rows of a frame read now that may count: not the quests whose earlier quest the logs hold open. */
export function rowsTheChainAllows<T extends { questId: string }>(matches: T[], records: Record<string, TaskProgressRecord>, quests: readonly Quest[], at: string): T[] {
  const index = chainIndex(quests)
  return matches.filter((match) => {
    const quest = index.byId.get(match.questId)
    return !quest || !questHoldingBack(quest, at, records, index)
  })
}

/**
 * The quests the logs hold open though they show a later quest of their chain taken or handed in, after they were taken:
 * the hand-in they missed. Otherwise «Текущие» shows them for good.
 */
export function handedInByLaterQuests(records: Record<string, TaskProgressRecord>, quests: readonly Quest[]): string[] {
  const index = chainIndex(quests)
  const closed = new Set<string>()
  for (const record of Object.values(records)) {
    if (record.source !== 'eft-log' || (record.status !== 'active' && record.status !== 'completed')) continue
    const quest = index.byId.get(record.taskId)
    if (!quest) continue
    for (const before of questsBefore(quest, index)) {
      const earlier = records[before.id]
      if (earlier?.source === 'eft-log' && earlier.status === 'active' && record.updatedAt > earlier.updatedAt && !ARENA_LINE.test(before.name)) closed.add(before.id)
    }
  }
  return [...closed]
}

/**
 * The layers with the chain applied (the same object when it changes nothing). A Tasks-table record goes from the table's
 * layer and from the account's copy, only where the screen decided: a mark or a log event of the quest itself stands. A
 * hand-in the logs missed goes in as the server's event, a moment after the quest was taken: any newer event of the game or
 * a mark decides over it, and it says nothing about when, so it rules out no reading.
 */
export function withQuestChain(layers: QuestInputLayers, records: Record<string, TaskProgressRecord>, quests: readonly Quest[], syncFrom?: string): QuestInputLayers {
  const index = chainIndex(quests)
  const closed = handedInByLaterQuests(records, quests)
  const handedIn = (taskId: string) => ({ taskId, status: 'completed' as const, at: new Date(Date.parse(records[taskId]!.updatedAt) + 1).toISOString() })
  // A quest made up for as handed in holds nothing back: a real quest beside the later one stays.
  const known = closed.length ? { ...records, ...Object.fromEntries(closed.map((taskId) => [taskId, { ...records[taskId]!, status: 'completed' as const, updatedAt: handedIn(taskId).at }])) } : records
  const goes = (taskId: string, record: TaskProgressRecord) => {
    if (record.status !== 'active' || record.source !== 'screen-scan' || records[taskId]?.source !== 'screen-scan') return false
    const quest = index.byId.get(taskId)
    if (!quest) return false
    return (syncFrom !== undefined && MISREAD_BEFORE_THE_MENDING.has(taskId) && record.updatedAt < syncFrom) || Boolean(questHoldingBack(quest, record.updatedAt, known, index))
  }
  const kept = (layer: Record<string, TaskProgressRecord> | undefined) => {
    if (!layer || !Object.entries(layer).some(([taskId, record]) => goes(taskId, record))) return layer
    return Object.fromEntries(Object.entries(layer).filter(([taskId, record]) => !goes(taskId, record)))
  }
  const table = kept(layers.table)
  const mirror = kept(layers.mirror)
  if (table === layers.table && mirror === layers.mirror && !closed.length) return layers
  const server = { ...layers.server }
  for (const taskId of closed) server[taskId] = { status: 'completed', at: handedIn(taskId).at }
  return { ...layers, table: table ?? {}, server, ...(mirror ? { mirror } : {}) }
}
