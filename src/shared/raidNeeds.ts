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

/** Catalog item fields the ammo-pack grouping reads (`Item` in src/domain/types.ts). */
export interface RaidNeedItem {
  id: string
  name: string
  types?: string[]
  caliber?: string
}

/** A quest raid requirement: the items one objective accepts share its `objectiveId`, `alternatives` = their number. */
export interface ObjectiveRaidRequirement extends RaidRequirementLine {
  objectiveId?: string
  alternatives?: number
}

/**
 * One row for the items one objective accepts interchangeably: `ammo-pack` — packs of one caliber («Любая пачка
 * патронов 7.62x51»), `any-of` — anything else (the two ELCAN SpecterDR colours): the row shows one, the rest go to
 * the row's hover card.
 */
export interface AlternativeGroup {
  /** Item id of the merged row: `ammo-pack:<caliber>` or `any-of:<objectiveId>`. */
  id: string
  kind: 'ammo-pack' | 'any-of'
  /** `ammo-pack` only. */
  caliber?: string
  /** The items the objective accepts, in catalog order. */
  itemIds: string[]
}
/** @deprecated the ammo-pack case of AlternativeGroup. */
export type AmmoPackGroup = AlternativeGroup

export const AMMO_PACK_GROUP_PREFIX = 'ammo-pack:'
export const ANY_OF_GROUP_PREFIX = 'any-of:'

/** tarkov.dev `properties.caliber` codes of the common cartridges; anything else is read from the item name. */
const CALIBER_CODES: Record<string, string> = {
  '556x45NATO': '5.56x45', '545x39': '5.45x39', '762x39': '7.62x39', '762x51': '7.62x51', '762x54R': '7.62x54R',
  '9x19PARA': '9x19', '9x18PM': '9x18', '9x21': '9x21', '9x39': '9x39', '46x30': '4.6x30', '57x28': '5.7x28',
  '127x55': '12.7x55', '68x51': '6.8x51', '762x25TT': '7.62x25', '12g': '12/70', '20g': '20/70', '23x75': '23x75',
}

/** tarkov.dev gives ammo packs the item type `ammoBox`; demo and older cached items only have the name. */
export function isAmmoPack(item: RaidNeedItem): boolean {
  if (item.types?.length) return item.types.includes('ammoBox')
  return /^пачка патронов\s|\bammo pack\b/i.test(item.name)
}

/** «7.62x51»: the item's caliber field when it has one, otherwise the size in its name (packs carry no caliber field). */
export function ammoCaliber(item: RaidNeedItem): string | undefined {
  const field = item.caliber?.trim().replace(/[×х]/g, 'x')
  if (field) {
    const code = CALIBER_CODES[field.replace(/^caliber/i, '')]
    if (code) return code
    if (/^\d+(?:\.\d+)?x\d+\S*$/.test(field)) return field
  }
  const size = item.name.match(/(\d+(?:[.,]\d+)?)\s*[xх×]\s*(\d+(?:[.,]\d+)?)(?:\s*(?:мм|mm))?(\s*R\b)?/i)
  if (size) return `${size[1].replace(',', '.')}x${size[2].replace(',', '.')}${size[3] ? 'R' : ''}`
  return item.name.match(/\b\d{2}\/\d{2}\b/)?.[0]
}

/** «Любая пачка патронов 7.62x51» / «Any 7.62x51 ammo pack». */
export function ammoPackGroupLabel(caliber: string, locale: 'ru' | 'en' = 'ru') {
  return locale === 'en' ? `Any ${caliber} ammo pack` : `Любая пачка патронов ${caliber}`
}

/**
 * The items one objective accepts interchangeably become one line with the objective's count (not one line per
 * variant): «Сорвать сделку» accepts any 7.62x51 pack (tarkov.dev lists all eight as alternatives) → `ammo-pack:7.62x51`;
 * a hidden scope accepts either ELCAN SpecterDR colour → `any-of:<objectiveId>`. Single items are returned unchanged.
 */
export function groupAlternatives<T extends ObjectiveRaidRequirement>(
  requirements: T[],
  itemById: (id: string) => RaidNeedItem | undefined,
): { requirements: T[]; groups: Map<string, AlternativeGroup> } {
  const byObjective = new Map<string, T[]>()
  for (const requirement of requirements) {
    if ((requirement.alternatives ?? 1) < 2 || !requirement.objectiveId) continue
    const key = `${requirement.objectiveId}:${requirement.purpose}`
    byObjective.set(key, [...(byObjective.get(key) ?? []), requirement])
  }

  const replaced = new Map<T, T>()
  const dropped = new Set<T>()
  const groups = new Map<string, AlternativeGroup>()
  for (const alternatives of byObjective.values()) {
    if (new Set(alternatives.map((requirement) => requirement.itemId)).size < 2) continue
    const calibers = new Set(alternatives.map((requirement) => {
      const item = itemById(requirement.itemId)
      return item && isAmmoPack(item) ? ammoCaliber(item) : undefined
    }))
    const [caliber] = calibers
    const ammo = calibers.size === 1 && caliber
    const id = ammo ? `${AMMO_PACK_GROUP_PREFIX}${caliber}` : `${ANY_OF_GROUP_PREFIX}${alternatives[0].objectiveId}`
    const group = groups.get(id) ?? (ammo ? { id, kind: 'ammo-pack' as const, caliber, itemIds: [] } : { id, kind: 'any-of' as const, itemIds: [] })
    for (const requirement of alternatives) if (!group.itemIds.includes(requirement.itemId)) group.itemIds.push(requirement.itemId)
    groups.set(id, group)
    // One line per objective: its count is how many it takes, not one per accepted variant.
    const [first, ...rest] = alternatives
    replaced.set(first, { ...first, itemId: id })
    for (const requirement of rest) dropped.add(requirement)
  }

  return {
    requirements: requirements.flatMap((requirement) => dropped.has(requirement) ? [] : [replaced.get(requirement) ?? requirement]),
    groups,
  }
}
