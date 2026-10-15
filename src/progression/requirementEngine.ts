import type { ModeProgress, Quest, TaskProgressRecord, TaskProgressStatus } from '../domain/types'
import { gunsmithSteps } from '../gunsmith/gunsmith'
import { inferChronology, traderKeyOf, type ChronologyBasis, type ChronologyResult } from './chronology'
import { isCompletionOnly, isLiveGameQuest, questFaction, questRequirements, TRACKED_SOURCES } from './questBasics'

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

/** What the logs show about lines and stages (calculateAvailability), for the line conditions of each quest. */
export type AvailabilityContext = Pick<ChronologyResult, 'lineLevels' | 'traderStages' | 'historyBeforeLogs' | 'stages' | 'knownLevel'>

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
    if (!normalized || !allowed.has(normalized as 'complete' | 'failed' | 'active')) {
      blockers.push(`Не выполнено предыдущее задание: ${requirement.taskId}`)
    }
  }
  // The game's own conditions are out of the app's sight: a task given in a talk with the trader, or one behind a hidden
  // counter the line model below cannot read (no line data for it, or no logs to compare with), is offered only once the
  // logs have it (the explicit record above), never on a guess (owner, 12.10.2026: Mechanic closed, «АКС-74Н» offered).
  if (quest.gameConditions?.includes('dialogue')) blockers.push('Откроется после разговора с торговцем в игре')
  if (quest.gameConditions?.includes('progress') && !(context && quest.unlock?.lines?.length)) blockers.push('Откроется в игре по ходу заданий торговца')

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
    const own = quest.traderLoyalty?.needed.filter((entry) => !quest.traderId || entry.traderId === quest.traderId).map((entry) => entry.level) ?? []
    const stage = context.traderStages.get(traderKeyOf(quest))?.ll ?? 1
    if (own.some((level) => level > stage)) unknown = true
  }

  if (blockers.length) return { status: 'locked', blockers, ...(waiting ? { line: waiting } : {}) }
  return unknown ? { status: 'unknown', blockers: [] } : { status: 'available', blockers: [] }
}


export function calculateAvailability(quests: Quest[], progress: ModeProgress) {
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
    const result = evaluateTaskAvailability(quest, verified, chronology)
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

/** Current = accepted in the game (logged «задание принято») and not handed in or failed since. */
export function isCurrentTrackedQuest(quest: { id: string }, progress: ModeProgress) {
  const record = progress.taskProgress[quest.id]
  return record?.status === 'active' && TRACKED_SOURCES.has(record.source)
}

export function currentStoryStageIndex(quest: Quest, progress: ModeProgress) {
  const explicit = progress.taskProgress[quest.id]?.currentStageIndex
  if (typeof explicit === 'number' && explicit >= 0) return explicit
  return 0
}

