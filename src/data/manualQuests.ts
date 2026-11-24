import type { Quest, RaidMode } from '../domain/types'
import registry from './manualQuests.json'

/**
 * Quests changed by hand (owner, 23.11.2026: «Все квесты, которые мы обновляем вот так вручную, вносим изменения, помечай. И при
 * обновлениях из базы их не трогай. То есть они уже у нас обновленные. Их не надо обновлять»), listed in manualQuests.json with
 * the date and what each fix changed. The fixes themselves stay where they are made (src/data/questCorrections.ts,
 * src/data/stalePlaces.ts, the tables of src/data/catalogSource.ts and src/data/mapMarkerAdapter.ts, the scripts' own lists)
 * and apply on every catalog build, the server's quest base and the app's own fetch alike, so an update of the base never
 * undoes them. This list marks the quests (`manualCorrection`) and tells the data generators to keep their entries as they are
 * (scripts/manualQuests.mjs).
 */
export interface ManualQuestFix {
  date: string
  what: string
  source: string
  /** The game's ids of the objectives the fix is written under (src/data/objectiveGameIds.ts). */
  objectives?: readonly string[]
}

export interface ManualQuest {
  name: string
  /** The modes the fixes are for; every mode when absent. */
  modes?: readonly RaidMode[]
  fixes: readonly ManualQuestFix[]
}

export const MANUAL_QUESTS: Readonly<Record<string, ManualQuest>> = registry.quests as Record<string, ManualQuest>

/** The registered quest `id` in `mode` (no mode: registered for every mode). */
export function manualQuest(id: string, mode?: RaidMode): ManualQuest | undefined {
  const entry = Object.prototype.hasOwnProperty.call(MANUAL_QUESTS, id) ? MANUAL_QUESTS[id] : undefined
  if (!entry) return undefined
  if (entry.modes && (!mode || !entry.modes.includes(mode))) return undefined
  return entry
}

/** The last fix's date and what the fixes changed, as the quest's mark. */
function markOf(entry: ManualQuest): NonNullable<Quest['manualCorrection']> {
  const fixes = [...entry.fixes].sort((a, b) => a.date.localeCompare(b.date))
  return { source: [...new Set(fixes.map((fix) => fix.source))].join('; '), checkedAt: fixes.at(-1)?.date ?? '', changes: fixes.map((fix) => `${fix.date}: ${fix.what}`) }
}

/**
 * The catalog's quests with the registered ones marked. A quest a pinned correction has marked already
 * (src/data/questCorrections.ts) keeps that mark with the registry's list of changes beside it.
 */
export function markManualQuests(quests: Quest[], mode?: RaidMode): Quest[] {
  return quests.map((quest) => {
    const entry = manualQuest(quest.id, mode)
    if (!entry) return quest
    const mark = markOf(entry)
    return { ...quest, manualCorrection: quest.manualCorrection ? { ...quest.manualCorrection, changes: mark.changes } : mark }
  })
}

/** A registered fix the built catalog no longer matches: its quest is gone, or the objective it is written under. */
export interface UnmatchedManualFix { questId: string; name: string; date: string; objectiveId?: string }

/**
 * The registered fixes the catalog of `mode` no longer matches (the game changed the quest): each must be looked at again,
 * since a fix by an objective id that the data has no more does nothing (the server's quest base lists them, server/src/services/questBase.ts).
 */
export function unmatchedManualFixes(quests: readonly Quest[], mode: RaidMode): UnmatchedManualFix[] {
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  return Object.keys(MANUAL_QUESTS).flatMap((questId): UnmatchedManualFix[] => {
    const entry = manualQuest(questId, mode)
    if (!entry) return []
    const quest = byId.get(questId)
    const last = [...entry.fixes].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date ?? ''
    if (!quest) return [{ questId, name: entry.name, date: last }]
    const objectives = new Set((quest.objectiveDetails ?? []).flatMap((objective) => [objective.id, objective.gameId ?? '']))
    return entry.fixes.flatMap((fix) => (fix.objectives ?? []).filter((id) => !objectives.has(id)).map((objectiveId) => ({ questId, name: entry.name, date: fix.date, objectiveId })))
  })
}
