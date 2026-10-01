import type { HideoutStation, Item, ModeProgress, Quest, TaskProgressStatus } from '../domain/types'
import { findCollectorQuest } from '../kappa/collector'
import { calculateAvailability, isLiveGameQuest, questFaction, type TaskAvailability } from '../progression/requirementEngine'

/** Where a «keep» need comes from. The Collector task is listed as Kappa, not as an ordinary quest. */
export type KeepSource = 'quest' | 'hideout' | 'kappa'

export interface KeepReason {
  kind: KeepSource
  /** Quest id or hideout station id. */
  id: string
  name: string
  count: number
  foundInRaid: boolean
  trader?: string
  /** Hideout level the items are for. */
  level?: number
  status?: TaskProgressStatus
  /** The quest is required for Kappa. */
  kappaRequired?: boolean
}

export interface KeepRow {
  item: Item
  need: number
  /** Part of `need` that must be found in raid. */
  needFoundInRaid: number
  have: number
  remaining: number
  reasons: KeepReason[]
}

export interface KeepListInput {
  quests: Quest[]
  hideout: HideoutStation[]
  items: Item[]
  progress: Pick<ModeProgress, 'taskProgress' | 'hideoutLevels' | 'itemCounts' | 'faction' | 'playerLevel' | 'lastLogSyncAt'>
  /** Quest availability of this mode; computed from `progress` when absent. */
  availability?: Map<string, TaskAvailability>
  /** Items ticked on the Collector checklist of this mode: they count as had for the Kappa part. */
  collectorCollected?: string[]
}

/** Roubles, dollars, euros: handing over money is not an item to keep. */
const CURRENCY_IDS = new Set(['5449016a4bdc2d6f028b456f', '5696686a4bdc2da3298b456a', '569668774bdc2da2298b4568'])
const ITEM_PURPOSES = new Set(['handover', 'find', 'place', 'mark', 'bring'])

export function isCurrencyItem(item: Pick<Item, 'id' | 'types'> | undefined) {
  return Boolean(item && (CURRENCY_IDS.has(item.id) || item.types?.includes('money')))
}

/**
 * Items still needed for open quests (active, available or not yet unlocked), unbuilt hideout levels and the Collector,
 * for one mode. Completed / failed quests (from the logs, manual marks or the proven prerequisite chain) drop out.
 */
export function computeKeepList(input: KeepListInput): KeepRow[] {
  const { quests, hideout, items, progress } = input
  const byId = new Map(items.map((item) => [item.id, item]))
  const availability = input.availability ?? calculateAvailability(quests, progress as ModeProgress)
  const collector = findCollectorQuest(quests)
  const rows = new Map<string, KeepReason[]>()
  const add = (itemId: string, reason: KeepReason) => {
    const item = byId.get(itemId)
    if (!item || isCurrencyItem(item) || reason.count <= 0) return
    const list = rows.get(itemId) ?? []
    list.push(reason)
    rows.set(itemId, list)
  }

  for (const quest of quests) {
    if (!isLiveGameQuest(quest)) continue
    const status = availability.get(quest.id)?.status ?? progress.taskProgress[quest.id]?.status
    if (status === 'completed' || status === 'failed') continue
    const faction = questFaction(quest.faction)
    if (faction && progress.faction !== 'unknown' && faction !== progress.faction) continue
    const kind: KeepSource = collector && quest.id === collector.id ? 'kappa' : 'quest'
    for (const [itemId, need] of questItemNeeds(quest)) {
      add(itemId, { kind, id: quest.id, name: quest.name, count: need.count, foundInRaid: need.foundInRaid, trader: quest.trader, status, kappaRequired: quest.kappa })
    }
  }

  for (const station of hideout) {
    const built = progress.hideoutLevels[station.id] ?? 0
    for (const level of station.levels ?? []) {
      if (level.level <= built) continue
      for (const requirement of level.itemRequirements ?? []) {
        add(requirement.itemId, { kind: 'hideout', id: station.id, name: station.name, level: level.level, count: Math.max(1, requirement.count), foundInRaid: Boolean(requirement.foundInRaid) })
      }
    }
  }

  const collected = new Set(input.collectorCollected ?? [])
  return [...rows.entries()].map(([itemId, reasons]) => {
    const item = byId.get(itemId)!
    const need = reasons.reduce((sum, reason) => sum + reason.count, 0)
    const needFoundInRaid = reasons.filter((reason) => reason.foundInRaid).reduce((sum, reason) => sum + reason.count, 0)
    const kappaNeed = reasons.filter((reason) => reason.kind === 'kappa').reduce((sum, reason) => sum + reason.count, 0)
    const counted = Math.max(0, Math.round(progress.itemCounts?.[itemId] ?? 0))
    const have = Math.min(need, Math.max(counted, collected.has(itemId) ? kappaNeed : 0))
    return { item, need, needFoundInRaid, have, remaining: Math.max(0, need - have), reasons: sortReasons(reasons) }
  }).sort((a, b) => Number(b.remaining > 0) - Number(a.remaining > 0) || b.remaining - a.remaining || a.item.name.localeCompare(b.item.name, 'ru'))
}

/**
 * How many of each item one quest takes. An objective that accepts any of several items (e.g. «3 of any medical item»)
 * is not a reason to keep a specific item. «Find» and «hand over» of the same item are one need, not two.
 */
export function questItemNeeds(quest: Quest) {
  const perItem = new Map<string, { handover: number; find: number; carry: number; foundInRaid: boolean }>()
  const seen = new Set<string>()
  for (const requirement of quest.raidRequirements ?? []) {
    if (!ITEM_PURPOSES.has(requirement.purpose) || !requirement.itemId) continue
    if ((requirement.alternatives ?? 1) > 1) continue
    // One objective lists an item once; the same objective read twice (cached + live) must not double it.
    const key = `${requirement.objectiveId ?? ''}:${requirement.purpose}:${requirement.itemId}`
    if (requirement.objectiveId && seen.has(key)) continue
    seen.add(key)
    const entry = perItem.get(requirement.itemId) ?? { handover: 0, find: 0, carry: 0, foundInRaid: false }
    const count = Math.max(1, Math.round(requirement.count) || 1)
    if (requirement.purpose === 'handover') entry.handover += count
    else if (requirement.purpose === 'find') entry.find += count
    else entry.carry += count
    if (requirement.foundInRaid && (requirement.purpose === 'handover' || requirement.purpose === 'find')) entry.foundInRaid = true
    perItem.set(requirement.itemId, entry)
  }
  const result = new Map<string, { count: number; foundInRaid: boolean }>()
  for (const [itemId, entry] of perItem) result.set(itemId, { count: Math.max(entry.handover, entry.find) + entry.carry, foundInRaid: entry.foundInRaid })
  return result
}

function sortReasons(reasons: KeepReason[]) {
  const order: Record<KeepSource, number> = { quest: 0, kappa: 1, hideout: 2 }
  const statusOrder = (status?: TaskProgressStatus) => status === 'active' ? 0 : status === 'available' ? 1 : 2
  return [...reasons].sort((a, b) => order[a.kind] - order[b.kind] || statusOrder(a.status) - statusOrder(b.status) || (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name, 'ru'))
}

export interface KeepFilter {
  foundInRaidOnly?: boolean
  kinds?: KeepSource[]
  search?: string
  hideDone?: boolean
}

/** Filters rows; with a source filter, need / remaining are recounted for the chosen sources only. */
export function filterKeepRows(rows: KeepRow[], filter: KeepFilter): KeepRow[] {
  const kinds = filter.kinds?.length ? new Set(filter.kinds) : null
  const query = filter.search?.trim().toLowerCase() ?? ''
  return rows.flatMap((row) => {
    let reasons = kinds ? row.reasons.filter((reason) => kinds.has(reason.kind)) : row.reasons
    if (filter.foundInRaidOnly) reasons = reasons.filter((reason) => reason.foundInRaid)
    if (!reasons.length) return []
    if (query && !`${row.item.name} ${row.item.shortName}`.toLowerCase().includes(query)) return []
    const need = reasons.reduce((sum, reason) => sum + reason.count, 0)
    const needFoundInRaid = reasons.filter((reason) => reason.foundInRaid).reduce((sum, reason) => sum + reason.count, 0)
    const have = Math.min(row.have, need)
    const next = reasons === row.reasons ? row : { ...row, reasons, need, needFoundInRaid, have, remaining: Math.max(0, need - have) }
    if (filter.hideDone && next.remaining === 0) return []
    return [next]
  })
}

/** Short summary for the in-raid item card: «НЕ ПРОДАВАТЬ · нужно N · квест X (FIR)». */
export interface KeepBadge {
  need: number
  remaining: number
  foundInRaid: boolean
  kind: KeepSource
  reason: string
  /** Further reasons not named in the badge. */
  more: number
}

export function keepBadge(row: KeepRow | undefined): KeepBadge | undefined {
  if (!row || row.remaining <= 0) return undefined
  const first = row.reasons[0]
  return {
    need: row.need,
    remaining: row.remaining,
    foundInRaid: row.needFoundInRaid > 0,
    kind: first.kind,
    reason: first.kind === 'hideout' ? `${first.name} ур. ${first.level}` : first.name,
    more: row.reasons.length - 1,
  }
}
