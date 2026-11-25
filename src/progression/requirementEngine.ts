import type { ModeProgress, Quest, TaskProgressRecord, TaskProgressStatus } from '../domain/types'
import { gunsmithSteps } from '../gunsmith/gunsmith'
import { inferChronology, traderKeyOf, type ChronologyBasis, type ChronologyResult } from './chronology'
import { isCompletionOnly, isLiveGameQuest, questFaction, questRequirements, TRACKED_SOURCES } from './questBasics'
import { prestigeMismatch } from './prestigeQuests'
import { visibleStoryObjectives } from './storyObjectives'
import { objectiveDone } from '../raidprep/objectives'

export { isLiveGameQuest, questFaction, questRequirements } from './questBasics'

export interface TaskAvailability {
  status: TaskProgressStatus
  blockers: string[]
  /**
   * Why a quest the logs do not mention has this status (src/progression/chronology.ts): `chain` — a quest in the logs
   * needs it; `line` / `stage` / `start` — it comes before what the logs show (probably completed).
   */
  basis?: 'chain' | ChronologyBasis
  /**
   * `prerequisite`: proven, not guessed — a quest the game reported as held or handed in needs this one completed (a
   * mandatory, completion-only requirement), and the game lets no one take a quest before that. Counted as completed.
   */
  proof?: 'prerequisite'
  /** The quest from the logs that dates this one. */
  anchorId?: string
  /** A line the quest waits for: its place among the trader's lines, the level it needs and the level the logs show. */
  line?: { order?: number; ll?: number; level: number; reached?: number }
}

/**
 * What the logs show about lines and stages (calculateAvailability), for the line conditions of each quest; `loyalty`: the
 * loyalty level the game's traders' screen showed for this character, by trader id (TraderLoyaltyKnown).
 */
export type AvailabilityContext = Pick<ChronologyResult, 'lineLevels' | 'traderStages' | 'historyBeforeLogs' | 'stages' | 'knownLevel'> & { loyalty?: TraderLoyaltyKnown }

/**
 * Trader loyalty levels the game showed for the mode's character (the traders' screen, src/gunsmith/traderLevels.ts), by
 * trader id. Only ever lifts a doubt: a quest the logs cannot place (history from before the logs) whose loyalty the screen
 * shows reached is offered, not «may be open». A lower reading locks nothing (an old or misread badge must not hide a
 * quest the player can take: owner, 02.11.2026 «не сделай систему хуже чем сейчас»).
 */
export type TraderLoyaltyKnown = ReadonlyMap<string, number>

export function evaluateTaskAvailability(quest: Quest, progress: ModeProgress, context?: AvailabilityContext): TaskAvailability {
  const explicit = progress.taskProgress[quest.id]
  if (explicit) return { status: explicit.status, blockers: [] }

  const blockers: string[] = []
  // the profile's level, or the one the quests in the logs prove
  if (Math.max(progress.playerLevel, context?.knownLevel ?? 0) < quest.level) blockers.push(`Нужен уровень ${quest.level}`)
  const faction = questFaction(quest.faction)
  if (progress.faction !== 'unknown' && faction && faction !== progress.faction) {
    blockers.push(`Задание доступно фракции ${quest.faction}`)
  }
  // «Новое начало» of another prestige (report №100): the game gives each only at its own prestige.
  const prestige = prestigeMismatch(quest, progress.prestige)
  if (prestige === 'after') blockers.push(`Нужен престиж ${quest.prestige}`)
  if (prestige === 'before') blockers.push(`Только на престиже ${quest.prestige}`)

  for (const requirement of questRequirements(quest)) {
    const prerequisite = progress.taskProgress[requirement.taskId]
    const normalized = prerequisite?.status === 'completed'
      ? 'complete'
      : prerequisite?.status === 'active'
        ? 'active'
        : prerequisite?.status === 'failed'
          ? 'failed'
          : undefined
    const allowed = new Set(requirement.allowedStatuses.length ? requirement.allowedStatuses : ['complete'])
    // «taken» opens the next one, and it stays open once the taken one is done: the game unlocks it when the first is started
    // («Задержка отправления. Часть 2» needs «Рука помощи» taken; a player who finished it had it locked here)
    if (allowed.has('active')) allowed.add('complete')
    if (!normalized || !allowed.has(normalized as 'complete' | 'failed' | 'active')) {
      blockers.push(`Не выполнено предыдущее задание: ${requirement.taskId}`)
    }
  }
  // The game's own conditions are out of the app's sight: a task given in a talk with the trader, or one behind a hidden
  // counter the line model below cannot read (no line data for it, or no logs to compare with), is offered only once the
  // logs have it (the explicit record above), never on a guess (owner, 12.10.2026: Mechanic closed, «АКС-74Н» offered).
  if (quest.gameConditions?.includes('dialogue')) blockers.push('Откроется после разговора с торговцем в игре')
  if (quest.gameConditions?.includes('progress') && !(context && quest.unlock?.lines?.length)) blockers.push('Откроется в игре по ходу заданий торговца')
  if (quest.gameConditions?.includes('badStanding')) blockers.push('Откроется только при отрицательной репутации у торговца')

  // A trader line at a level (src/data/questUnlock.ts): open once a quest of that level or above was taken. When the
  // player's history began before the logs, a line the logs say nothing about may be open: unknown, not locked — unless
  // the quest belongs to a later loyalty stage than the trader's quests in the logs.
  let unknown = false
  let waiting: TaskAvailability['line']
  for (const line of context ? quest.unlock?.lines ?? [] : []) {
    const reached = context!.lineLevels.get(line.id)
    if (reached && reached.level >= line.level) continue
    const stage = context!.traderStages.get(traderKeyOf(quest))
    if (context!.historyBeforeLogs && !reached && (!stage || (context!.stages.get(quest.id) ?? 1) <= stage.ll)) {
      unknown = true
      continue
    }
    waiting = { ...(line.order ? { order: line.order } : {}), ...(line.ll ? { ll: line.ll } : {}), level: line.level, ...(reached ? { reached: reached.level } : {}) }
    blockers.push(`Откроется на ${line.level}-м уровне ветки${line.order ? ` ${line.order}` : ''} торговца`)
  }

  // Loyalty the logs do not show yet (a quest that needs LL4 while the trader's quests in the logs are of LL3 at most):
  // the player may have it from before the logs.
  if (context?.historyBeforeLogs && !blockers.length) {
    const own = quest.traderLoyalty?.needed.filter((entry) => !quest.traderId || entry.traderId === quest.traderId) ?? []
    const stage = context.traderStages.get(traderKeyOf(quest))?.ll ?? 1
    if (own.some((entry) => entry.level > stage && (context.loyalty?.get(entry.traderId) ?? 0) < entry.level)) unknown = true
  }

  if (blockers.length) return { status: 'locked', blockers, ...(waiting ? { line: waiting } : {}) }
  return unknown ? { status: 'unknown', blockers: [] } : { status: 'available', blockers: [] }
}


export function calculateAvailability(quests: Quest[], progress: ModeProgress, loyalty?: TraderLoyaltyKnown) {
  const verified: ModeProgress = {
    ...progress,
    taskProgress: Object.fromEntries(Object.entries(progress.taskProgress).filter(([, record]) => TRACKED_SOURCES.has(record.source))),
  }
  // Logs reliably expose currently held quests, but older completed rows are
  // often absent in PvE. A current/completed quest proves every mandatory,
  // completion-only prerequisite in its chain. Alternative groups are skipped.
  // Not into the «Оружейник» chain: its parts come from the logs only (gunsmithFromLogs below).
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const steps = gunsmithSteps(quests, () => undefined)
  const gunsmith = new Set(steps.map((step) => step.quest.id))
  const logged = { ...verified.taskProgress }
  const queue = Object.values(verified.taskProgress)
    .filter((record) => record.status === 'active' || record.status === 'completed')
    .map((record) => record.taskId)
  const visited = new Set<string>()
  while (queue.length) {
    const taskId = queue.shift()!
    if (visited.has(taskId)) continue
    visited.add(taskId)
    const quest = byId.get(taskId)
    if (!quest) continue
    for (const requirement of questRequirements(quest)) {
      const completionOnly = requirement.allowedStatuses.length === 0 || requirement.allowedStatuses.every((status) => status === 'complete')
      if (requirement.group || !completionOnly || verified.taskProgress[requirement.taskId] || gunsmith.has(requirement.taskId)) continue
      verified.taskProgress[requirement.taskId] = {
        taskId: requirement.taskId,
        status: 'completed',
        source: 'inferred',
        updatedAt: progress.lastLogSyncAt ?? new Date(0).toISOString(),
        inferredFromTaskId: taskId,
      }
      queue.push(requirement.taskId)
    }
  }
  // The chronology against the quest grid (src/progression/chronology.ts): what comes before the quests in the logs.
  const chronology = inferChronology(quests, verified.taskProgress, {
    playerLevel: progress.playerLevel,
    faction: progress.faction,
    exclude: gunsmith,
  })
  for (const [taskId, mark] of chronology.completed) {
    verified.taskProgress[taskId] = {
      taskId,
      status: 'completed',
      source: 'inferred',
      updatedAt: progress.lastLogSyncAt ?? new Date(0).toISOString(),
      inferredFromTaskId: mark.anchorId,
    }
  }
  const availability = new Map(quests.map((quest) => {
    const result = evaluateTaskAvailability(quest, verified, loyalty ? { ...chronology, loyalty } : chronology)
    const mark = chronology.completed.get(quest.id)
    const inferred = verified.taskProgress[quest.id]
    if (mark) return [quest.id, { ...result, basis: mark.basis, anchorId: mark.anchorId }]
    if (inferred?.source === 'inferred') return [quest.id, { ...result, basis: 'chain' as const, proof: 'prerequisite' as const, ...(inferred.inferredFromTaskId ? { anchorId: inferred.inferredFromTaskId } : {}) }]
    return [quest.id, result]
  }))
  gunsmithFromLogs(byId, steps, logged, availability)
  return availability
}

/**
 * «Оружейник» from the game logs only (owner, 11.10.2026: «не бери это правило по квестам за основу, лучше читай логи
 * квестов оружейника»). BSG rebuilt the chain and kept the old tasks' ids (the old «Часть 1…25» are now the weapon parts
 * and «Мастер. Часть 1…13»), so a part held now proves nothing about the parts before it: «Мастер. Часть 13» and
 * «Часть 10» can both be taken while «Часть 11» is locked. A part shows what the logs say about it. One the logs do not
 * mention, for a player whose quests began before the oldest log (a logged quest needs one the logs never saw — the game
 * keeps its logs a few weeks), is «нет в логах» (unknown) rather than a guess; it is locked only when the logs show the
 * part before it held or failed right now and no logged quest needs it. A player whose whole history is in the logs (a
 * new account, a wipe) gets the usual available / locked.
 */
function gunsmithFromLogs(byId: Map<string, Quest>, steps: ReturnType<typeof gunsmithSteps>, logged: Record<string, TaskProgressRecord>, availability: Map<string, TaskAvailability>) {
  const tracked = (taskId: string) => {
    const record = logged[taskId]
    return record && TRACKED_SOURCES.has(record.source) ? record : undefined
  }
  const held = Object.values(logged).filter((record) => TRACKED_SOURCES.has(record.source) && (record.status === 'active' || record.status === 'completed'))
  const needed = new Set(held.flatMap((record) => questRequirements(byId.get(record.taskId) ?? {}).filter(isCompletionOnly).map((requirement) => requirement.taskId)))
  const olderThanLogs = [...needed].some((taskId) => byId.has(taskId) && !tracked(taskId))
  if (!olderThanLogs) return
  const locked = new Set<string>()
  // in chain order: a part's previous parts are decided before it
  for (const { quest } of steps) {
    if (tracked(quest.id)) continue
    const before = questRequirements(quest).filter(isCompletionOnly).map((requirement) => requirement.taskId)
    const blocked = before.some((taskId) => locked.has(taskId) || tracked(taskId)?.status === 'active' || tracked(taskId)?.status === 'failed')
    if (blocked && !needed.has(quest.id)) {
      locked.add(quest.id)
      availability.set(quest.id, { status: 'locked', blockers: availability.get(quest.id)?.blockers ?? [] })
    } else availability.set(quest.id, { status: 'unknown', blockers: [] })
  }
}

/**
 * A completion the game itself reported (a handed-in quest in the logs after the mode's floor, a manual mark), or one it
 * proves: a mandatory prerequisite of a quest the game reports as held or handed in (`proof: 'prerequisite'`). Not one
 * the chronology guesses (`line` / `stage` / `start` and its own chains): those stay «вероятно выполнено» in the lists but
 * are never counted (owner, 15.10.2026: PvE «154 выполнено» in the game, 226 in the app — the chronology's guesses). The
 * game keeps its logs a few weeks, so without the proven prerequisites an older player would count almost nothing.
 */
export function provenCompleted(availability: TaskAvailability | undefined) {
  return availability?.status === 'completed' && (!availability.basis || availability.proof === 'prerequisite')
}

/** Completed trader quests, as the game reports them (provenCompleted). */
export function completedQuestStats(quests: Quest[], availability: Map<string, TaskAvailability>) {
  const live = quests.filter((quest) => isLiveGameQuest(quest))
  const done = live.filter((quest) => provenCompleted(availability.get(quest.id)))
  const kappa = live.filter((quest) => quest.kappa)
  const kappaDone = kappa.filter((quest) => provenCompleted(availability.get(quest.id)))
  return { completed: done.length, total: live.length, kappaCompleted: kappaDone.length, kappaTotal: kappa.length }
}

export function isStoryQuest(quest: { kind?: string }) {
  return quest.kind === 'story'
}

export function isCurrentQuestStatus(status?: TaskProgressStatus) {
  return status === 'active'
}

export function isCurrentQuest(quest: { id: string; kind?: string }, status?: TaskProgressStatus) {
  if (quest.id.startsWith('wiki:')) return false
  return isCurrentQuestStatus(status)
}

export function isTrackedQuest(quest: { id: string }, progress: ModeProgress) {
  const record = progress.taskProgress[quest.id]
  return Boolean(record && TRACKED_SOURCES.has(record.source))
}

/**
 * A current quest: taken by the logs, the screen or the player — or one of the BTR driver's the player is on by his own ticks
 * (opensByItself).
 */
export function isCurrentTrackedQuest(quest: { id: string } & Partial<Pick<Quest, 'traderId' | 'requirements' | 'previous' | 'level' | 'faction' | 'gameConditions' | 'unlock' | 'prestige' | 'objectiveDetails'>>, progress: ModeProgress) {
  const record = progress.taskProgress[quest.id]
  if (record) return record.status === 'active' && TRACKED_SOURCES.has(record.source)
  return opensByItself(quest, progress)
}

/**
 * Traders whose quests the game takes without a line in its logs: the BTR driver. His quests open at PMC level 20 with
 * Mechanic's «Рука помощи» taken, and the player takes each from him (wikiwiki.jp BTR Driver, tarkov.dev). On the server,
 * 25.11.2026, the logs named a start of his «Органолептический анализ. Часть 2» for 143 players, «Похмельное утро» for 23,
 * «Честный отзыв» for 4, «Задержка отправления. Часть 2» for 3; a hand-in of any of his once in all, a failure of
 * «Шиномонтажка» 29 times. The rest is the screen and the players' marks.
 */
export const UNLOGGED_START_TRADERS: ReadonlySet<string> = new Set(['656f0f98d80a697f855d34b1'])

/**
 * A BTR driver's quest no record speaks of is current only when the player's own ticks show he is on it: an objective of it
 * ticked or counted (by hand, on another device or by the logs) and a required one still open. The app never ASSUMES he took
 * it from the game's conditions alone — the game logs almost none of the driver's hand-ins and he takes each quest from him in
 * a raid, which nothing the app reads shows, so a condition met is not a quest taken. A tick is a confirmation like a screen
 * reading or a mark, trusted on its own and not re-checked against the chain (the record branch above trusts those the same
 * way). Without one it is only open, «Доступные», like any trader's quest not taken yet: a Tasks-table reading, a mark or
 * «В текущие» makes it current.
 *
 * Until 25.11.2026 every open one was current by itself (owner, 08.11: «он должен сам добавляться в приложение»). Open is not
 * taken, and the driver's hand-ins are logged almost never, so a quest done long ago stayed current for good — on the maps, in
 * «Приоритет карт», «Текущие задания» and the raid briefing. On the server that day 381 profiles had «Рука помощи» done and
 * 234 of them not one confirmation of any driver's quest (no log, screen, tick or mark), yet saw his quests counted — the
 * player of reports 229 and 230 (02.11: «у меня нету квеста БТРа») among them. Of the driver's quests the logs that day named
 * only a handful of starts (3 of «Задержка отправления. Часть 2», 4 of «Честный отзыв») and 29 failures of «Шиномонтажка», no
 * hand-in; 130 (profile, mode, quest) pairs held one by hand ticks alone, no task record — those are the players really on
 * one, and the tick keeps them.
 */
export function opensByItself(quest: { id: string } & Partial<Pick<Quest, 'traderId' | 'objectiveDetails'>>, progress: ModeProgress) {
  if (!quest.traderId || !UNLOGGED_START_TRADERS.has(quest.traderId) || progress.taskProgress[quest.id]) return false
  return onItByTicks(quest, progress)
}

/** An objective of the quest ticked or counted (by hand, on another device or by the logs) and a required one still open. */
function onItByTicks(quest: { id: string; objectiveDetails?: Quest['objectiveDetails'] }, progress: ModeProgress) {
  const ticked = Object.values(progress.objectiveProgress ?? {}).some((objective) => objective.taskId === quest.id && (objective.current > 0 || Boolean(objective.completedAt)))
  if (!ticked) return false
  const objectives = (quest.objectiveDetails ?? []).filter((objective) => objective.id)
  const required = objectives.filter((objective) => !objective.optional)
  return (required.length ? required : objectives).some((objective) => !objectiveDone(progress, quest.id, objective.id))
}

/**
 * The stage a story chapter is at: the saved one, or the stage of an open objective the game's pane showed when that is
 * further on (owner, 31.10.2026: the game and «Квесты» said «Найти вход в портовый Терминал», the map still showed «Тур»
 * on Эпицентр — the saved stage only moves on after a confirmed reading, the shown objectives are the game itself).
 */
export function currentStoryStageIndex(quest: Quest, progress: ModeProgress) {
  const explicit = progress.taskProgress[quest.id]?.currentStageIndex
  const saved = typeof explicit === 'number' && explicit >= 0 ? explicit : 0
  const shown = visibleStoryObjectives(quest, progress)
    .filter((objective) => !objective.completed && !objective.optional && objective.stageIndex != null)
    .map((objective) => objective.stageIndex!)
  return shown.length ? Math.max(saved, Math.min(...shown)) : saved
}

