import type { ExtraGameLanguage, GameLanguage } from '../import/gameLanguage'
import { extraGameLanguage } from '../import/gameLanguage'

/**
 * The game's names in the language the game runs in, when that is German, Japanese or Chinese (src/import/gameLanguage.ts):
 * quests, items (full and short), exits and transits — what the screen readers compare the game's screens with, beside
 * the Russian and English names the catalog has. Loaded from tarkov.dev's dictionaries in that language
 * (src/data/gameNamesLoader.ts); kept here for the readers, which only read it. A Russian or English game has none.
 */
export interface ItemNames { name?: string; shortName?: string }

export interface GameNames {
  language: ExtraGameLanguage
  /** Quest (task) id → its title in the game's language. */
  quests: ReadonlyMap<string, string>
  /** Item id → its full and short name in the game's language. */
  items: ReadonlyMap<string, ItemNames>
  /** An exit's or a transit's Russian or English name (exitNameKey) → its name in the game's language. */
  exits: ReadonlyMap<string, string>
}

let current: GameNames | null = null
let wanted: ExtraGameLanguage | null = null
let version = 0
const listeners = new Set<() => void>()

/** An exit's name as a key: lower case, ё as е, spaces folded. */
export const exitNameKey = (name: string) => name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')

/** Grows whenever the names change: the readers' caches of titles and keys start again. */
export const gameNamesVersion = () => version

/** The names now (null: the game is Russian or English, or its names are not loaded yet). */
export const gameNames = () => current

/** The language whose names are wanted now (the game's, when it is German, Japanese or Chinese). */
export const wantedGameNames = () => wanted

export function subscribeGameNames(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function changed() {
  version += 1
  for (const listener of listeners) listener()
}

/** The game's language as the readers saw it: names of another language go at once (the loader brings the new ones). */
export function setWantedGameLanguage(language: GameLanguage | null | undefined) {
  const extra = extraGameLanguage(language)
  if (extra === wanted) return
  wanted = extra
  if (current && current.language !== extra) { current = null; changed() }
}

/** Names loaded (or none): kept only while they are of the language wanted. Exported for the loader and the tests. */
export function setGameNames(names: GameNames | null) {
  if (names && names.language !== wanted) return
  current = names
  changed()
}

/** A quest's title in the game's language, when its names are loaded. */
export const gameQuestTitle = (questId: string) => current?.quests.get(questId)

/** An item's names in the game's language, when its names are loaded. */
export const gameItemNames = (itemId: string) => current?.items.get(itemId)

/** An exit's name in the game's language, by its Russian or English name. */
export const gameExitName = (name: string) => current?.exits.get(exitNameKey(name))

/** Tests: the state as at the start. */
export function resetGameNamesForTests() {
  current = null
  wanted = null
  changed()
}
