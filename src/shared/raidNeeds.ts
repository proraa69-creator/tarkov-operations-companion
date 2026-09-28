export interface RaidRequirementLine {
  itemId: string
  count: number
  purpose: string
  questName?: string
}

export interface AggregatedRaidNeed {
  itemId: string
  count: number
  lines: Array<{ purpose: string; count: number; questNames: string[] }>
  fromRaidListOnly: boolean
}

/** Collapse duplicate raid items into one row with a total ×count. */
export function aggregateRaidNeeds(
  requirements: RaidRequirementLine[],
  raidItemIds: string[] = [],
): AggregatedRaidNeed[] {
  const byItem = new Map<string, {
    count: number
    lines: Map<string, { purpose: string; count: number; quests: Set<string> }>
  }>()

  for (const requirement of requirements) {
    if (!requirement.itemId) continue
    const entry = byItem.get(requirement.itemId) ?? { count: 0, lines: new Map() }
    const amount = Math.max(1, Math.round(requirement.count) || 1)
    entry.count += amount
    const line = entry.lines.get(requirement.purpose) ?? {
      purpose: requirement.purpose,
      count: 0,
      quests: new Set<string>(),
    }
    line.count += amount
    if (requirement.questName) line.quests.add(requirement.questName)
    entry.lines.set(requirement.purpose, line)
    byItem.set(requirement.itemId, entry)
  }

  for (const itemId of raidItemIds) {
    if (!itemId || byItem.has(itemId)) continue
    byItem.set(itemId, { count: 1, lines: new Map() })
  }

  return [...byItem.entries()].map(([itemId, entry]) => ({
    itemId,
    count: Math.max(1, entry.count),
    lines: [...entry.lines.values()].map((line) => ({
      purpose: line.purpose,
      count: line.count,
      questNames: [...line.quests],
    })),
    fromRaidListOnly: entry.lines.size === 0,
  }))
}

export function formatItemCountLabel(name: string, count: number) {
  return count > 1 ? `${name} ×${count}` : name
}
