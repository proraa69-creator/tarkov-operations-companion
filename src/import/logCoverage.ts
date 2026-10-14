import { useMemo } from 'react'
import type { Quest, RaidMode } from '../domain/types'
import { isGunsmithQuest } from '../gunsmith/gunsmith'
import { questFaction, questRequirements } from '../progression/requirementEngine'
import type { ModeLogScanResult } from './eftLogTimeline'
import type { ParsedTaskEvent } from './logParser'

/**
 * Whether the game's logs hold a mode's whole quest history (owner, 14.10.2026: «если логи всех квестов обнаружены, что бы
 * приложение перестало сканировать квесты через экран»). Then the logs are the truth about that mode's trader quests and
 * the screen's Tasks table has nothing to add: the quest scanner passes it over, and the tip that asks to open «Задания»
 * and scroll through it is not shown (src/components/StoryScreenScanner.tsx, src/onboarding/QuestSyncTip.tsx).
 *
 * The logs show quests as chat notifications only — type 10 accepted, 11 failed, 12 handed in — and the game deletes old
 * logs, oldest first. A history since the last reset reaches back to the profile's start when:
 *   - every quest handed in or failed was accepted in these logs too, and
 *   - every quest accepted has its prerequisites (the catalog's task requirements) in these logs too. Starter quests have
 *     none; a history whose beginning was deleted shows a quest taken after one the logs never saw done.
 * Prerequisites the logs can never show are left out, so the check is never impossible to pass: story chapters (the game
 * does not log them), the «Оружейник» chain (its catalog order is not the game's: src/progression/requirementEngine.ts),
 * quests the catalog does not know. Alternatives count as one: a requirement allowing several statuses (done or failed),
 * requirements of one `group`, and the USEC and BEAR versions of a quest. An empty history holds nothing: false.
 */

/** A quest event of the logs: its quest and what happened (accepted «active», «failed», «completed»). */
export interface LoggedQuestEvent { taskId: string; status: ParsedTaskEvent['status'] }

type CoverageQuest = Pick<Quest, 'id' | 'name' | 'normalizedName' | 'requirements' | 'previous' | 'kind' | 'storyChapterId' | 'faction'> & Partial<Pick<Quest, 'objectiveDetails'>>

/** A quest whose events the logs can show: a trader quest of the game (not a story chapter, not a wiki-only page). */
function inLogs(quest: CoverageQuest) {
  return !quest.id.startsWith('wiki:') && quest.kind !== 'story' && !quest.storyChapterId && !isGunsmithQuest(quest)
}

export function logsCoverQuestHistory(history: readonly LoggedQuestEvent[], quests: readonly CoverageQuest[]): boolean {
  if (!history.length) return false
  const accepted = new Set<string>(), completed = new Set<string>(), failed = new Set<string>()
  for (const event of history) {
    if (event.status === 'active') accepted.add(event.taskId)
    else if (event.status === 'completed') completed.add(event.taskId)
    else if (event.status === 'failed') failed.add(event.taskId)
  }
  // Handed in or failed without the acceptance: the acceptance was in a log the game deleted.
  for (const taskId of [...completed, ...failed]) if (!accepted.has(taskId)) return false
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const logged = (taskId: string, statuses: readonly string[]) => statuses.some((status) => (
    status === 'complete' ? completed.has(taskId) : status === 'failed' ? failed.has(taskId) : accepted.has(taskId)
  ))
  for (const taskId of accepted) {
    const quest = byId.get(taskId)
    if (!quest || !inLogs(quest)) continue
    /** Alternatives: met when any of them is. */
    const groups = new Map<string, boolean>()
    for (const requirement of questRequirements(quest)) {
      const prerequisite = byId.get(requirement.taskId)
      if (!prerequisite || !inLogs(prerequisite)) continue
      const met = logged(requirement.taskId, requirement.allowedStatuses.length ? requirement.allowedStatuses : ['complete'])
      const group = requirement.group ? `group:${requirement.group}` : questFaction(prerequisite.faction) ? 'faction' : null
      if (group) groups.set(group, (groups.get(group) ?? false) || met)
      else if (!met) return false
    }
    for (const met of groups.values()) if (!met) return false
  }
  return true
}

/**
 * A mode's logged quest history as the desktop app's log scan carries it: the acceptances since the last reset and every
 * quest's latest status. Nothing for a mode the logs did not see, and nothing from an older app (no `acceptedByMode`).
 */
export function loggedQuestHistory(scan: Pick<ModeLogScanResult, 'eventsByMode' | 'acceptedByMode'> | undefined, mode: RaidMode): LoggedQuestEvent[] {
  const accepted = scan?.acceptedByMode?.[mode]
  if (!scan || !accepted) return []
  return [...accepted.map((taskId) => ({ taskId, status: 'active' as const })), ...(scan.eventsByMode[mode] ?? [])]
}

/** The logs of this mode hold its whole quest history (see logsCoverQuestHistory). */
export function logsCoverMode(scan: Pick<ModeLogScanResult, 'eventsByMode' | 'acceptedByMode'> | undefined, mode: RaidMode, quests: readonly CoverageQuest[]) {
  return logsCoverQuestHistory(loggedQuestHistory(scan, mode), quests)
}

const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

/** Each mode on its own: PvP, PvE and the season never share a quest history. */
export function logsCoverModes(scan: Pick<ModeLogScanResult, 'eventsByMode' | 'acceptedByMode'> | undefined, quests: readonly CoverageQuest[]): Record<RaidMode, boolean> {
  return Object.fromEntries(MODES.map((mode) => [mode, logsCoverMode(scan, mode, quests)])) as Record<RaidMode, boolean>
}

/** logsCoverModes, worked out again only when the log scan or the catalog changes. */
export function useLogsCoverModes(scan: Pick<ModeLogScanResult, 'eventsByMode' | 'acceptedByMode'> | undefined, quests: readonly CoverageQuest[] | undefined) {
  return useMemo(() => logsCoverModes(scan, quests ?? []), [scan, quests])
}
