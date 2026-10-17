import type { RaidMode } from '../domain/types'
import { CURATED_SERIES, type CuratedObjective, type CuratedQuest, type CuratedSeries, type CuratedText } from './curatedQuests'

/**
 * «Ивент-квесты» (owner, 16.10.2026: «добавь возможность обновить мне из админ приложения название потом и вообще добавь
 * в админ панели возможность добавлять ивент квесты и редактировать их»). The owner keeps event quests on the server
 * (server/src/routes/eventQuests.ts) in the shape of a curated quest (src/data/curatedQuests.ts) plus the series they
 * belong to, the modes, the event's end and a switch-off. `eventSeriesWith` lays them over the built-in series:
 * - a definition with a built-in quest's id replaces that quest's fields (the owner renames «???» of «Вторжение Scourge»);
 *   what the editor does not show (map places, keys, items to bring) stays the built-in quest's;
 * - a new id (`raidos-event-…`) adds a quest: to the built-in series of the same name, else to a series of its own;
 * - `hidden` switches a quest off, `endsAt` hides it once the event is over.
 * The server's quest base (src/data/catalogSource.ts, `eventQuests` option) and the app (src/data/eventQuests.ts) use this
 * one function, so both show the same quests.
 */
export type EventObjectiveType =
  | 'visit' | 'extract' | 'shoot' | 'findItem' | 'giveItem' | 'plantItem' | 'findQuestItem' | 'giveQuestItem' | 'plantQuestItem'
  | 'useItem' | 'transit' | 'hideout'

export const EVENT_OBJECTIVE_TYPES: readonly EventObjectiveType[] = [
  'visit', 'extract', 'shoot', 'findItem', 'giveItem', 'plantItem', 'findQuestItem', 'giveQuestItem', 'plantQuestItem', 'useItem', 'transit', 'hideout',
]
/** Objective types whose items are quest items (one item: tarkov.dev `questItem`). */
export const QUEST_ITEM_OBJECTIVES: ReadonlySet<EventObjectiveType> = new Set(['findQuestItem', 'giveQuestItem', 'plantQuestItem'])
/** Objective types that name catalog items. */
export const ITEM_OBJECTIVES: ReadonlySet<EventObjectiveType> = new Set(['findItem', 'giveItem', 'plantItem', 'useItem', 'findQuestItem', 'giveQuestItem', 'plantQuestItem'])
/** Kill targets as the game names them (tarkov.dev `targetNames`). */
export const SHOOT_TARGETS = ['Any', 'AnyPmc', 'Usec', 'Bear', 'Savage', 'pmcBot'] as const

export const EVENT_QUEST_MODES: readonly RaidMode[] = ['pvp', 'pve', 'seasonal']
/** New quests' ids: never a game id, never a built-in id. */
export const EVENT_QUEST_ID = /^raidos-event-[a-z0-9]{6,32}$/

/** Limits of one definition; the server checks the same (server/src/routes/eventQuests.ts). */
export const EVENT_QUEST_LIMITS = {
  name: 120,
  objectiveText: 500,
  note: 4000,
  seriesName: 120,
  route: 200,
  skill: 120,
  objectives: 12,
  objectiveItems: 20,
  objectiveMaps: 12,
  shootTargets: 6,
  previous: 6,
  rewards: 30,
  skills: 10,
  count: 10_000,
  rewardCount: 100_000_000,
  experience: 10_000_000,
  definitions: 200,
} as const

export interface EventObjective {
  type: EventObjectiveType
  text: CuratedText
  count?: number
  optional?: boolean
  /** Maps by normalizedName (`factory`, `the-lab`). */
  maps?: string[]
  /** Catalog items (the first one is the quest item of a quest-item objective). */
  items?: string[]
  foundInRaid?: boolean
  /** Kill targets (`shoot`). */
  targets?: string[]
}

export interface EventQuestDefinition {
  id: string
  trader: string
  name: CuratedText
  /** Previous quests (complete): any catalog quest id. */
  after?: string[]
  experience: number
  objectives: EventObjective[]
  rewards?: Array<[itemId: string, count: number]>
  startRewards?: Array<[itemId: string, count: number]>
  skills?: CuratedText[]
  note: CuratedText
  modes: RaidMode[]
  /** The series and the lead of every quest's description («ивент до 20 октября»). */
  series: { name: CuratedText; route: CuratedText }
  /** ISO time the event ends; the app hides the quest from then on. */
  endsAt?: string
  hidden?: boolean
  /** Server bookkeeping (the owner's list only has `updatedBy`). */
  createdAt?: string
  updatedAt?: string
  updatedBy?: string
}

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '')
const both = (text: CuratedText): CuratedText => ({ ru: text.ru.trim() || text.en.trim(), en: text.en.trim() || text.ru.trim() })
const pairs = (list: Array<[string, number]> | undefined) => (list?.length ? list.map(([id, count]) => [id, count] as [string, number]) : undefined)

/** The built-in quest of an id, with its series. */
export function builtInEventQuest(id: string, list: readonly CuratedSeries[] = CURATED_SERIES) {
  for (const series of list) {
    const quest = series.quests.find((entry) => entry.id === id)
    if (quest) return { series, quest }
  }
  return undefined
}

/** An objective of the definition as a curated objective; `base`: the built-in one at the same place, kept where the editor has no field. */
function curatedObjective(objective: EventObjective, base: CuratedObjective | undefined): CuratedObjective {
  const kept = base && base.type === objective.type ? base : undefined
  const items = objective.items?.filter(Boolean) ?? []
  const questItem = QUEST_ITEM_OBJECTIVES.has(objective.type) ? items[0] : undefined
  const next: CuratedObjective = {
    ...(kept ?? {}),
    type: objective.type,
    text: both(objective.text),
    count: objective.count && objective.count > 1 ? objective.count : undefined,
    optional: objective.optional || undefined,
    maps: objective.maps?.length ? [...objective.maps] : undefined,
    items: !questItem && items.length ? items : undefined,
    questItem,
    foundInRaid: objective.foundInRaid || undefined,
    shoot: objective.type === 'shoot' ? { ...(kept?.shoot ?? {}), targets: objective.targets?.length ? [...objective.targets] : ['Any'] } : undefined,
  }
  // a place on a map that is not one of the objective's maps any more is not its place
  if (next.spots) next.spots = next.spots.filter((spot) => next.maps?.includes(spot.map))
  for (const key of Object.keys(next) as Array<keyof CuratedObjective>) if (next[key] === undefined) delete next[key]
  return next
}

/** The definition as a curated quest; `base`: the built-in quest it replaces. */
function curatedQuest(definition: EventQuestDefinition, base?: CuratedQuest): CuratedQuest {
  const quest: CuratedQuest = {
    ...(base ?? {}),
    id: definition.id,
    trader: definition.trader,
    name: both(definition.name),
    after: definition.after?.length ? [...definition.after] : undefined,
    experience: definition.experience,
    objectives: definition.objectives.map((objective, index) => curatedObjective(objective, base?.objectives[index])),
    rewards: pairs(definition.rewards),
    startRewards: pairs(definition.startRewards),
    skills: definition.skills?.length ? definition.skills.map(both) : undefined,
    note: { ru: definition.note.ru.trim(), en: definition.note.en.trim() || definition.note.ru.trim() },
    modes: [...definition.modes],
    endsAt: definition.endsAt || undefined,
    hidden: definition.hidden || undefined,
  }
  // the owner's title replaces the built-in one; the built-in title stays a title of the same quest (the screen reader)
  if (base && normalize(base.name.ru) !== normalize(quest.name.ru) && normalize(base.name.ru)) {
    quest.aliases = [...new Set([...(base.aliases ?? []), base.name.ru, base.name.en].filter((title) => normalize(title)))]
  }
  for (const key of Object.keys(quest) as Array<keyof CuratedQuest>) if (quest[key] === undefined) delete quest[key]
  return quest
}

/**
 * The built-in series with the owner's event quests laid over them (see the header). A built-in quest's own modes and end
 * become explicit, so an overriding definition can change both (an empty end: no end).
 */
export function eventSeriesWith(definitions: readonly EventQuestDefinition[], list: readonly CuratedSeries[] = CURATED_SERIES): CuratedSeries[] {
  if (!definitions.length) return [...list]
  const byId = new Map(definitions.map((definition) => [definition.id, definition]))
  const latest = (entries: EventQuestDefinition[]) => [...entries].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0]
  const fresh = definitions.filter((definition) => !builtInEventQuest(definition.id, list))
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id))
  const joined = new Set<string>()
  const merged = list.map((series): CuratedSeries => {
    const overrides = series.quests.map((quest) => byId.get(quest.id)).filter((entry): entry is EventQuestDefinition => Boolean(entry))
    const key = normalize(series.name.ru)
    const added = fresh.filter((definition) => normalize(definition.series.name.ru) === key)
    if (!overrides.length && !added.length) return series
    for (const definition of added) joined.add(definition.id)
    const lead = latest(overrides)
    const quests = [
      ...series.quests.map((quest) => {
        const definition = byId.get(quest.id)
        return definition ? curatedQuest(definition, quest) : { ...quest, modes: quest.modes ?? series.modes, ...(quest.endsAt ?? series.endsAt ? { endsAt: quest.endsAt ?? series.endsAt } : {}) }
      }),
      ...added.map((definition) => curatedQuest(definition)),
    ]
    const next: CuratedSeries = {
      ...series,
      ...(lead ? { name: both(lead.series.name), route: { ru: lead.series.route.ru.trim(), en: lead.series.route.en.trim() || lead.series.route.ru.trim() } } : {}),
      modes: [...new Set([...series.modes, ...added.flatMap((definition) => definition.modes)])],
      quests,
    }
    // every quest carries its own end now: an owner's quest without one has none
    delete next.endsAt
    return next
  })
  // New quests of a series of their own, grouped by the series' name, in the order they were made.
  const own = new Map<string, EventQuestDefinition[]>()
  for (const definition of fresh) {
    if (joined.has(definition.id)) continue
    const key = normalize(definition.series.name.ru) || definition.id
    own.set(key, [...(own.get(key) ?? []), definition])
  }
  for (const [key, entries] of own) {
    const lead = latest(entries)
    merged.push({
      id: `owner-event-${key}`,
      name: both(lead.series.name),
      route: { ru: lead.series.route.ru.trim(), en: lead.series.route.en.trim() || lead.series.route.ru.trim() },
      event: true,
      gameVersion: 'event',
      checkedAt: (lead.updatedAt ?? '').slice(0, 10),
      modes: [...new Set(entries.flatMap((definition) => definition.modes))],
      sources: ['the owner\'s event quests (admin app)'],
      quests: entries.map((definition) => curatedQuest(definition)),
    })
  }
  return merged
}

/** The editor's starting values for a built-in quest (its series' modes, end and name come with it). */
export function definitionOfBuiltIn(series: CuratedSeries, quest: CuratedQuest): EventQuestDefinition {
  return {
    id: quest.id,
    trader: quest.trader,
    name: { ...quest.name },
    after: [...(quest.after ?? [])],
    experience: quest.experience,
    objectives: quest.objectives.map((objective) => ({
      type: (EVENT_OBJECTIVE_TYPES as readonly string[]).includes(objective.type) ? objective.type as EventObjectiveType : 'visit',
      text: { ...objective.text },
      ...(objective.count ? { count: objective.count } : {}),
      ...(objective.optional ? { optional: true } : {}),
      ...(objective.maps?.length ? { maps: [...objective.maps] } : {}),
      ...(objective.questItem || objective.items?.length ? { items: objective.questItem ? [objective.questItem] : [...objective.items!] } : {}),
      ...(objective.foundInRaid ? { foundInRaid: true } : {}),
      ...(objective.shoot ? { targets: [...objective.shoot.targets] } : {}),
    })),
    rewards: (quest.rewards ?? []).map(([id, count]) => [id, count]),
    startRewards: (quest.startRewards ?? []).map(([id, count]) => [id, count]),
    skills: (quest.skills ?? []).map((skill) => ({ ...skill })),
    note: { ...quest.note },
    modes: [...(quest.modes ?? series.modes)],
    series: { name: { ...series.name }, route: { ...series.route } },
    ...(quest.endsAt ?? series.endsAt ? { endsAt: quest.endsAt ?? series.endsAt } : {}),
    ...(quest.hidden ? { hidden: true } : {}),
  }
}

/** The built-in event quests (the series marked `event`), for the owner's list. */
export function builtInEventQuests(list: readonly CuratedSeries[] = CURATED_SERIES) {
  return list.filter((series) => series.event).flatMap((series) => series.quests.map((quest) => ({ series, quest })))
}

const text = (value: unknown): CuratedText | undefined => {
  const row = value as Partial<CuratedText> | null
  return row && typeof row.ru === 'string' && typeof row.en === 'string' ? { ru: row.ru, en: row.en } : undefined
}
const ids = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [])
const counts = (value: unknown) => (Array.isArray(value)
  ? value.flatMap((entry): Array<[string, number]> => (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number' && entry[1] > 0 ? [[entry[0], entry[1]]] : []))
  : [])

/** The server's answer ({ quests }) as definitions; anything malformed is left out. */
export function parseEventQuestDefinitions(answer: unknown): EventQuestDefinition[] {
  const list = (answer as { quests?: unknown } | null)?.quests
  if (!Array.isArray(list)) return []
  return list.flatMap((entry): EventQuestDefinition[] => {
    const row = entry as Record<string, unknown>
    const name = text(row.name)
    const note = text(row.note)
    const series = row.series as { name?: unknown; route?: unknown } | undefined
    const seriesName = text(series?.name)
    const route = text(series?.route)
    if (typeof row.id !== 'string' || typeof row.trader !== 'string' || !name || !note || !seriesName || !route || !Array.isArray(row.objectives)) return []
    const objectives = row.objectives.flatMap((value): EventObjective[] => {
      const objective = value as Record<string, unknown>
      const line = text(objective.text)
      if (!line || !(EVENT_OBJECTIVE_TYPES as readonly unknown[]).includes(objective.type)) return []
      return [{
        type: objective.type as EventObjectiveType,
        text: line,
        ...(typeof objective.count === 'number' && objective.count > 0 ? { count: objective.count } : {}),
        ...(objective.optional === true ? { optional: true } : {}),
        ...(ids(objective.maps).length ? { maps: ids(objective.maps) } : {}),
        ...(ids(objective.items).length ? { items: ids(objective.items) } : {}),
        ...(objective.foundInRaid === true ? { foundInRaid: true } : {}),
        ...(ids(objective.targets).length ? { targets: ids(objective.targets) } : {}),
      }]
    })
    const modes = ids(row.modes).filter((mode): mode is RaidMode => (EVENT_QUEST_MODES as readonly string[]).includes(mode))
    if (!objectives.length || !modes.length) return []
    const skills = Array.isArray(row.skills) ? row.skills.map(text).filter((skill): skill is CuratedText => Boolean(skill)) : []
    return [{
      id: row.id,
      trader: row.trader,
      name,
      after: ids(row.after),
      experience: typeof row.experience === 'number' && row.experience >= 0 ? row.experience : 0,
      objectives,
      rewards: counts(row.rewards),
      startRewards: counts(row.startRewards),
      skills,
      note,
      modes,
      series: { name: seriesName, route },
      ...(typeof row.endsAt === 'string' && Number.isFinite(Date.parse(row.endsAt)) ? { endsAt: row.endsAt } : {}),
      ...(row.hidden === true ? { hidden: true } : {}),
      ...(typeof row.createdAt === 'string' ? { createdAt: row.createdAt } : {}),
      ...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {}),
      ...(typeof row.updatedBy === 'string' ? { updatedBy: row.updatedBy } : {}),
    }]
  })
}
