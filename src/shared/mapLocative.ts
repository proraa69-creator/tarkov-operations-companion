import { canonicalMapId, MAP_DISPLAY_NAMES } from '../data/mapIds'

/**
 * «11 на Таможне»: the base maps with their Russian preposition and locative, keyed by the canonical map id.
 * The map data has only the nominative («Таможня»), so «на {name}» printed «на Таможня».
 * Standard Russian uses «в» for the forest, the lab and the labyrinth («в Лесу», not «на Лесу»).
 */
const MAP_LOCATIVES: Record<string, string> = {
  customs: 'на Таможне',
  woods: 'в Лесу',
  interchange: 'на Развязке',
  shoreline: 'на Береге',
  factory: 'на Заводе',
  reserve: 'на Резерве',
  lighthouse: 'на Маяке',
  'streets-of-tarkov': 'на Улицах Таркова',
  'the-lab': 'в Лаборатории',
  'ground-zero': 'на Эпицентре',
  terminal: 'на Терминале',
  'the-labyrinth': 'в Лабиринте',
  icebreaker: 'на Ледоколе',
}

const ID_BY_RUSSIAN_NAME = new Map(Object.entries(MAP_DISPLAY_NAMES).map(([id, name]) => [name.toLowerCase(), id]))

/**
 * Where-phrase for a map: «на Таможне» / «on Customs». A map the table does not know (a new location) keeps its
 * name in the nominative behind «на карте» instead of a wrong case. English names are passed through `uiText`
 * by the caller, so a Russian demo name still reads «on Customs».
 */
export function mapLocativePhrase(map: { id: string; name: string }, locale: 'ru' | 'en' = 'ru'): string {
  if (locale === 'en') return `on ${map.name}`
  const id = canonicalMapId(map.id)
  const known = MAP_LOCATIVES[id] ?? MAP_LOCATIVES[ID_BY_RUSSIAN_NAME.get(map.name.trim().toLowerCase()) ?? '']
  return known ?? `на карте «${map.name}»`
}
