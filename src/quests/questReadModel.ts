/**
 * The read side of the quest-state engine (docs/quests/quest-state-engine.md «Everything reads from it»): the engine's
 * decisions with the catalog's checks, and the lists' availability built on them — once per input set and catalog, in
 * WeakMap caches every component shares (a re-render, or a reading that changed no decision, computes nothing).
 */
import type { ModeProgress, Quest, RaidMode } from '../domain/types'
import { calculateAvailability, type TaskAvailability } from '../progression/requirementEngine'
import type { QuestResolution } from './questEngine'
import { questFloor, resolveMode } from './questInputs'

const availabilityCache = new WeakMap<object, WeakMap<readonly Quest[], { level: number; faction: string; value: Map<string, TaskAvailability> }>>()

/**
 * The lists' availability of one mode (requirementEngine.ts calculateAvailability over the engine's decisions), once per
 * decision set, catalog, level and faction.
 */
export function questAvailabilityOf(quests: readonly Quest[], progress: ModeProgress): Map<string, TaskAvailability> {
  let byCatalog = availabilityCache.get(progress.taskProgress)
  if (!byCatalog) { byCatalog = new WeakMap(); availabilityCache.set(progress.taskProgress, byCatalog) }
  const kept = byCatalog.get(quests)
  if (kept && kept.level === progress.playerLevel && kept.faction === progress.faction) return kept.value
  const value = calculateAvailability(quests as Quest[], progress)
  byCatalog.set(quests, { level: progress.playerLevel, faction: progress.faction, value })
  return value
}

const resolutionCache = new WeakMap<object, WeakMap<readonly Quest[], QuestResolution>>()

/** The engine's full answer for one mode (states, conflicts, diagnostics) with the catalog's checks, once per input set. */
export function questResolutionOf(progress: ModeProgress, mode: RaidMode, quests: readonly Quest[]): QuestResolution {
  const key = progress.questInputs ?? progress.taskProgress
  let byCatalog = resolutionCache.get(key)
  if (!byCatalog) { byCatalog = new WeakMap(); resolutionCache.set(key, byCatalog) }
  const kept = byCatalog.get(quests)
  if (kept && kept.diagnostics.floor === questFloor(progress)) return kept
  const value = resolveMode(progress, mode, quests)
  byCatalog.set(quests, value)
  return value
}

