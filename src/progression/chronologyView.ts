import type { Quest } from '../domain/types'
import { sortQuestsChronologically } from './questChronology'

/**
 * A trader's quests laid out the way the game gives them now (owner, 12.10.2026: «полную хронологию выставить по
 * уровням»): the first dialogue, then each loyalty level — its line («ветка») level by level, then the quests of that
 * loyalty that open by chains or loyalty alone — and last the quests outside the stages (story, events, other traders'
 * chains). src/progression/chronology.ts dates them against the logs.
 */
export interface ChronologyStep {
  /** Line level («Уровень 2»); undefined for a plain list. */
  level?: number
  quests: Quest[]
}

export interface ChronologyGroup {
  key: string
  kind: 'start' | 'line' | 'stage' | 'other'
  /** Loyalty level of the group (lines: tarkov.help's level of the line). */
  ll?: number
  /** Line: its place among the trader's lines. */
  order?: number
  steps: ChronologyStep[]
}

/** The groups of one trader's quests (`quests`: the trader's live quests), in order. `stages`: chronologyStages of all quests. */
export function traderChronologyGroups(quests: Quest[], stages: ReadonlyMap<string, number>, all: Quest[] = quests): ChronologyGroup[] {
  const sorted = sortQuestsChronologically(quests, all)
  const start = sorted.filter((quest) => quest.unlock?.dialogue)
  const lines = new Map<string, { order?: number; ll?: number; byLevel: Map<number, Quest[]> }>()
  const rest: Quest[] = []
  for (const quest of sorted) {
    if (quest.unlock?.dialogue) continue
    const line = quest.unlock?.lines?.[0]
    if (!line) { rest.push(quest); continue }
    const entry = lines.get(line.id) ?? { order: line.order, ll: line.ll, byLevel: new Map<number, Quest[]>() }
    entry.byLevel.set(line.level, [...(entry.byLevel.get(line.level) ?? []), quest])
    lines.set(line.id, entry)
  }
  const groups: ChronologyGroup[] = []
  if (start.length) groups.push({ key: 'start', kind: 'start', ll: 1, steps: [{ quests: start }] })
  const lineGroups = [...lines].map(([id, line]): ChronologyGroup => ({
    key: `line:${id}`,
    kind: 'line',
    ...(line.ll ? { ll: line.ll } : {}),
    ...(line.order ? { order: line.order } : {}),
    steps: [...line.byLevel].sort(([a], [b]) => a - b).map(([level, entries]) => ({ level, quests: entries })),
  }))
  const byStage = new Map<number, Quest[]>()
  const other: Quest[] = []
  for (const quest of rest) {
    const stage = stages.get(quest.id)
    if (stage) byStage.set(stage, [...(byStage.get(stage) ?? []), quest])
    else other.push(quest)
  }
  const levels = [...new Set([...lineGroups.map((group) => group.ll ?? 9), ...byStage.keys()])].sort((a, b) => a - b)
  for (const ll of levels) {
    groups.push(...lineGroups.filter((group) => (group.ll ?? 9) === ll).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)))
    const plain = byStage.get(ll)
    if (plain?.length) groups.push({ key: `stage:${ll}`, kind: 'stage', ll, steps: [{ quests: plain }] })
  }
  if (other.length) groups.push({ key: 'other', kind: 'other', steps: [{ quests: other }] })
  return groups
}
