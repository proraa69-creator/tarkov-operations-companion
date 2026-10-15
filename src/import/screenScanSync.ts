import type { ModeProgress, Quest, TaskProgressRecord, TaskRequirement } from '../domain/types'
import { latinize } from './modeSelectScreen'
import { ocrKey, type QuestRowStatus } from './questOcr'
import { reconcileWithSession, type QuestScanSession } from './questSession'
import { questRequirements } from '../progression/requirementEngine'

/** Screens that mention quests but are not the Tasks list: messenger, trading, flea market. */
const NOT_TASKS_SCREEN = /сообщени[яй]|отправить|барахолк|купить|продать/

/** The game's Tasks menu (the table or a story chapter), in the Russian or the English game. */
export function isTasksMenuText(text: string) {
  return isRussianTasksMenu(text) || isEnglishTasksMenu(text)
}

// The English game (owner's PvE screenshots, 14.10.2026: Character → Tasks → Story / Side / Operational). Its bottom bar
// always says MESSENGER and FLEA MARKET, so a frame needs two of the strong marks, as with the Russian bar.
const NOT_TASKS_SCREEN_EN = /messenger|flea\s*market|\bbuy\b|\bsell\b|\bdeal\b/
/** A trader's own Tasks tab and the trading screen: quests taken and not taken alike, no status on their rows. */
const TRADER_SCREEN_EN = /show\s+(?:completed|locked)|loyalty\s+level|current\s+(?:attitude|standing)|\(\s*you\s*\)/
const STRONG_EN = [
  /any\s+location/,
  // «active!», which OCR often reads «activel».
  /\bactive[!l1|]?(?![a-z])/,
  /class\s+task\s+location|trader\s+type\s+class/,
  /task\s+items\s+in\s+stash|items\s+on\s+character/,
  /main\s+objectives|optional\s+objectives/,
  // The story banner's «CHAPTER», also read in Cyrillic look-alikes («СНАРТЕВ»).
  /\bchapt/,
]
const WEAK_EN = [/\btasks?\b/, /\bprogress\b/, /\bstatus\b/, /\blocation\b/, /\bstory\b/, /\bobjectives?\b/, /related\s+items/]

function isEnglishTasksMenu(text: string) {
  const lower = latinize(text).toLowerCase()
  if (TRADER_SCREEN_EN.test(lower)) return false
  const strong = STRONG_EN.filter((pattern) => pattern.test(lower)).length
  if (!strong) return false
  if (NOT_TASKS_SCREEN_EN.test(lower) && strong < 2) return false
  return strong + WEAK_EN.filter((pattern) => pattern.test(lower)).length >= 2
}

/**
 * The Russian counterpart of TRADER_SCREEN_EN (audit P13): a trader's own «Задания» tab and the trading screen — the
 * standing «Текущее отношение», the player's name marked «(вы)» («ву»: the Russian model's other reading), the loyalty
 * groups «Уровень лояльности N», «Показать выполненные / заблокированные». They list quests not taken yet beside the
 * taken ones, without a status on their rows: never the table of current quests.
 */
const TRADER_SCREEN_RU = /текущее\s+отношени|уровень\s+лояльност|показ[а-яё]*\s+(?:выполненн|заблокированн|завершенн|завершённ)|\(\s*(?:вы|ву)\s*\)|следующ[а-яё]*\s+ул\b/

function isRussianTasksMenu(text: string) {
  const lower = text.toLowerCase()
  if (TRADER_SCREEN_RU.test(lower)) return false
  const folded = `${lower}\n${ocrKey(text)}`
  // A Tasks screen always shows the quest table or the story detail pane.
  const strong = [
    /любаялокац/,
    /любая\s+локац/,
    /активно/,
    /побочн/,
    /сюжетн/,
    /оперативн/,
    /главн(ые|ая)\s*задач/,
    /(?<![а-яё])[а-яё]{0,4}ные\s*задач/,
    /иональн[а-яё]*\s*задач/,
    /класс\s+задание\s+локация/,
  ].filter((pattern) => pattern.test(folded)).length
  if (!strong) return false
  if (NOT_TASKS_SCREEN.test(lower) && strong < 2) return false
  const weak = [
    /задан(ия|ие|и)/,
    /задачи/,
    /сдать/,
    /наград/,
    /принят/,
    /завершить/,
    // Not «лояльност»: loyalty is the traders' screen's word (TRADER_SCREEN_RU), the Tasks table never shows it.
    /история/,
    /связанные\s*предмет/,
  ].filter((pattern) => pattern.test(folded)).length
  return strong + weak >= 2
}

/**
 * The rows of a table frame that may count as current. A row whose status cell was not read counts only on a frame with
 * two or more status cells read — the Tasks table itself. A trader's own Tasks tab shows the status of the open quest
 * only and lists quests not taken yet beside it (audit P13): there only the rows with a status read count.
 */
export function tableMatches<T extends { status?: QuestRowStatus }>(text: string, matches: T[]): T[] {
  return tableRowCount(text) >= 2 ? matches : matches.filter((match) => match.status !== undefined)
}

/** The table's status cell, Russian and English (questOcr.ts rowStatus); not the trader tab's «ЗАВЕРШИТЬ» / «COMPLETE» button. */
const STATUS_CELL = /активно|выполнено|доступно|провалено|заблокировано|\bactive[!l1|]?(?![a-z])|\bcompleted?!|\bavailable\b|\bfailed\b|\blocked\b/i
const STATUS_CELLS = new RegExp(STATUS_CELL.source, 'gi')

/**
 * Rows of the Tasks table on a frame: lines with a status cell beside a title. A lone status word is no row — the story
 * chapter's «АКТИВНО» / «ACTIVE» label, a button. The story pane shows one status at most, the table one per row.
 */
export function tableRowLines(text: string) {
  return text.split(/\r?\n/).filter((line) => {
    const lower = line.toLowerCase()
    return STATUS_CELL.test(lower) && lower.replace(STATUS_CELLS, ' ').replace(/[^a-zа-яё]+/g, '').length >= 3
  })
}

export function tableRowCount(text: string) {
  return tableRowLines(text).length
}

export interface ScreenScanOptions {
  previousSeenIds?: string[]
  /**
   * Live watch: a quest not tracked yet must be seen in two consecutive frames before it is added — unless its own row
   * reads «активно!» / «active!» (audit step 16): the status cell beside the title is the game saying so, and a
   * scrolled position no longer costs two readings (about 7 s) before its rows count.
   */
  requireConfirmation?: boolean
  /** Live watch session: a whole current list read twice ends the OCR quests it no longer shows (questSession.ts). */
  session?: QuestScanSession
  now?: number
}

/** A row of the Tasks table: the quest, the stage its title named (if any) and the status cell (if read). */
export interface ScreenScanMatch { questId: string; stageIndex?: number; status?: QuestRowStatus }

/**
 * One Tasks-table frame applied to a mode's records. Story chapters are not read here (the story pane has its reader,
 * storyScan.ts). A record changes only when its status does or it is new (audit P5f): a row read again as it is stored
 * keeps its record — its time included — so a frame showing nothing new changes nothing (the same object comes back),
 * and the app does not write and re-render its profiles every few seconds while the table is open.
 */
export function applyScreenScanProgress(
  progress: ModeProgress,
  matches: ScreenScanMatch[],
  quests: Quest[],
  options?: ScreenScanOptions,
): ModeProgress {
  if (!matches.length && !options?.session) return progress
  const nowMs = options?.now ?? Date.now()
  const now = new Date(nowMs).toISOString()
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const previous = new Set((options?.previousSeenIds ?? []).filter(Boolean))
  const traderRow = (match: ScreenScanMatch) => Boolean(match.questId) && !match.questId.startsWith('wiki:') && byId.get(match.questId)?.kind !== 'story'
  const current = matches.filter((match) => traderRow(match) && isCurrentRow(match.status))
  const seen = new Set(current.map((match) => match.questId))
  let taskProgress = progress.taskProgress
  const write = (taskId: string, record: TaskProgressRecord | undefined) => {
    if (taskProgress === progress.taskProgress) taskProgress = { ...progress.taskProgress }
    if (record) taskProgress[taskId] = record
    else delete taskProgress[taskId]
  }

  for (const match of matches) {
    if (match.status !== 'failed' || !traderRow(match)) continue
    const record = taskProgress[match.questId]
    if (record?.status === 'active' && record.source === 'screen-scan') write(match.questId, undefined)
  }

  for (const match of current) {
    const taskId = match.questId
    const record = taskProgress[taskId]
    // Messages / reward screens repeat finished quest names, so only a table row with an explicit
    // «активно!» / «выполнено!» status can bring back a quest the scanner itself moved to completed.
    if (record?.status === 'completed') {
      const tableRow = match.status === 'active' || match.status === 'ready'
      if (record.source !== 'screen-scan' || !tableRow) continue
    }
    if (record?.status === 'active') {
      // Already current, from the logs or an earlier frame: the status did not change. Only a stage the row names
      // moves a record the scanner owns.
      const stageIndex = typeof match.stageIndex === 'number' ? match.stageIndex : record.currentStageIndex
      if (record.source === 'screen-scan' && stageIndex !== record.currentStageIndex) write(taskId, { ...record, currentStageIndex: stageIndex, updatedAt: now })
      continue
    }
    if (options?.requireConfirmation && !previous.has(taskId) && match.status !== 'active') continue
    const stageIndex = typeof match.stageIndex === 'number' ? match.stageIndex : record?.currentStageIndex
    write(taskId, { taskId, status: 'active', source: 'screen-scan', updatedAt: now, currentStageIndex: stageIndex })
  }

  // Quests that are complete-prerequisites of something now on screen are no longer current («Завершить» → the next
  // quest of the chain appears): their Tasks-table record goes. Not «completed»: a chain is inference, and inference never
  // decides a status (src/quests/questEngine.ts) — the lists show such a quest as «вероятно выполнено», uncounted.
  // A row counts once its quest is current — confirmed by two frames, or known from the logs.
  const confirmed = new Set([...seen].filter((taskId) => taskProgress[taskId]?.status === 'active'))
  const prerequisites = new Set<string>()
  for (const taskId of confirmed) collectCompletePrerequisites(taskId, byId, confirmed, prerequisites, new Set())

  // Unseen quests stay current: switching trader tabs, scrolling or closing the menu must not drop them.
  for (const [taskId, record] of Object.entries(taskProgress)) {
    if (record.source !== 'screen-scan' || record.status !== 'active') continue
    if (seen.has(taskId) || byId.get(taskId)?.kind === 'story') continue
    if (confirmed.size && prerequisites.has(taskId)) write(taskId, undefined)
  }

  // Keep active rows discovered in EFT logs. OCR only sees the currently visible page of the
  // table, so deleting log rows here truncated long PvE task lists after the very first frame.

  const next = taskProgress === progress.taskProgress ? progress : { ...progress, taskProgress }
  return options?.session ? reconcileWithSession(next, options.session, quests) : next
}

/** Rows marked «доступно» / «заблокировано» / «провалено» are listed but not being done. */
function isCurrentRow(status?: QuestRowStatus) {
  return status === undefined || status === 'active' || status === 'ready'
}

function collectCompletePrerequisites(
  taskId: string,
  byId: Map<string, Quest>,
  seen: Set<string>,
  completed: Set<string>,
  visiting: Set<string>,
) {
  if (visiting.has(taskId)) return
  visiting.add(taskId)
  const quest = byId.get(taskId)
  if (!quest) return
  for (const requirement of completeOnlyRequirements(quest)) {
    if (seen.has(requirement.taskId) || requirement.taskId.startsWith('wiki:')) continue
    completed.add(requirement.taskId)
    collectCompletePrerequisites(requirement.taskId, byId, seen, completed, visiting)
  }
}

function completeOnlyRequirements(quest: Quest): TaskRequirement[] {
  return questRequirements(quest).filter((requirement) => (
    !requirement.group
    && requirement.allowedStatuses.length === 1
    && requirement.allowedStatuses[0] === 'complete'
  ))
}
