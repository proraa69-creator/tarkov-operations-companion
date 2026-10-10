/**
 * The «Цели» of the quest card under the map (Maps → «Квесты на карте»), grouped the way they are done (owner,
 * 10.10.2026): what to do in the raid, what to plant, what to find, and what is handed over to the trader — and, when
 * the quest's objectives are on different maps, the map of each one («Потрошитель»: Завод, Маяк, Резерв…).
 * Built from the catalog's structured objectives (`objectiveDetails`); quests without them keep the plain text list.
 */
import type { Item, ModeProgress, Quest, QuestObjective } from '../domain/types'
import { canonicalMapId, mapDisplayName } from '../data/mapIds'
import { objectiveDone } from '../raidprep/objectives'

export type SheetGroupKind = 'raid' | 'place' | 'find' | 'handover' | 'other'

export interface SheetObjective {
  id: string
  /** The catalog's text; a hand-over shows `item` instead when the item is known. */
  text: string
  /** Hand-over of one known item: its name (shown as «Сдать торговцу: <item>»). */
  item?: string
  count?: number
  foundInRaid?: boolean
  optional?: boolean
  /** Where it is done: map names, «Любая карта», or null (at the trader, in the menu). */
  where: string | null
  /** On the map being viewed. */
  here: boolean
  done: boolean
}

export interface SheetGroup { kind: SheetGroupKind; title: string; objectives: SheetObjective[] }

export interface SheetObjectives {
  groups: SheetGroup[]
  /** The objectives are on more than one map (or some on any map): every in-raid line names its map. */
  showWhere: boolean
}

const KIND_BY_TYPE: Record<string, SheetGroupKind> = {
  plantItem: 'place',
  plantQuestItem: 'place',
  findItem: 'find',
  findQuestItem: 'find',
  giveItem: 'handover',
  giveQuestItem: 'handover',
  shoot: 'raid',
  visit: 'raid',
  mark: 'raid',
  extract: 'raid',
  useItem: 'raid',
}

const ORDER: SheetGroupKind[] = ['raid', 'place', 'find', 'handover', 'other']
export const ANY_MAP = 'Любая карта'
const MAX_MAP_NAMES = 3

function kindOf(objective: QuestObjective): SheetGroupKind {
  const kind = KIND_BY_TYPE[objective.type]
  if (kind) return kind
  // Menu conditions (trader level, skill, weapon build…) have no map; one that names a map is done in the raid.
  return objective.mapIds?.length ? 'raid' : 'other'
}

function whereOf(kind: SheetGroupKind, mapIds: string[], maps: Array<{ id: string; name: string }>): string | null {
  if (kind === 'handover' || kind === 'other') return mapIds.length ? namesOf(mapIds, maps) : null
  return mapIds.length ? namesOf(mapIds, maps) : ANY_MAP
}

function namesOf(mapIds: string[], maps: Array<{ id: string; name: string }>) {
  const names = mapIds.map((id) => mapDisplayName(id, maps))
  return names.length > MAX_MAP_NAMES ? `${names.slice(0, MAX_MAP_NAMES).join(', ')} +${names.length - MAX_MAP_NAMES}` : names.join(', ')
}

function titleOf(kind: SheetGroupKind, objectives: SheetObjective[]) {
  if (kind === 'raid') return 'В рейде'
  if (kind === 'place') return 'Заложить'
  if (kind === 'find') return objectives.every((objective) => objective.foundInRaid) ? 'Найти в рейде' : 'Найти'
  if (kind === 'handover') return 'Сдать торговцу'
  return 'Вне рейда'
}

/** Null when the quest has no structured objectives (the card then lists the plain texts as before). */
export function sheetObjectives(
  quest: Quest,
  options: { mapId: string; maps: Array<{ id: string; name: string }>; itemsById: Map<string, Item>; progress?: ModeProgress },
): SheetObjectives | null {
  const details = quest.objectiveDetails ?? []
  if (!details.length) return null
  const mapId = canonicalMapId(options.mapId)
  const grouped = new Map<SheetGroupKind, SheetObjective[]>()
  for (const objective of details) {
    const kind = kindOf(objective)
    const mapIds = [...new Set((objective.mapIds ?? []).map(canonicalMapId).filter(Boolean))]
    const single = objective.itemIds?.length === 1 ? options.itemsById.get(objective.itemIds[0]) : undefined
    const line: SheetObjective = {
      id: objective.id,
      text: objective.description,
      ...(kind === 'handover' && single ? { item: single.name } : {}),
      // «×5» unless the text already says the number
      ...(objective.count > 1 && !new RegExp(`(^|\\D)${objective.count}(\\D|$)`).test(objective.description) ? { count: objective.count } : {}),
      ...(objective.foundInRaid ? { foundInRaid: true } : {}),
      ...(objective.optional ? { optional: true } : {}),
      where: whereOf(kind, mapIds, options.maps),
      here: mapIds.includes(mapId),
      done: options.progress ? objectiveDone(options.progress, quest.id, objective.id) : false,
    }
    grouped.set(kind, [...(grouped.get(kind) ?? []), line])
  }
  const groups = ORDER.flatMap((kind) => {
    const objectives = grouped.get(kind)
    return objectives?.length ? [{ kind, title: titleOf(kind, objectives), objectives }] : []
  })
  const places = new Set(groups.flatMap((group) => group.objectives.flatMap((objective) => (objective.where ? [objective.where] : []))))
  return { groups, showWhere: places.size > 1 }
}
