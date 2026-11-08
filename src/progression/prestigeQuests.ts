/**
 * «Новое начало» (report №100, 08.11.2026: «Для каждого престижа … нужно проходить квест новое начало, не нашел его в
 * списке квестов»): Ragman gives one for each next prestige, and only to a character of the prestige before it. The game
 * names these ids in its prestige conditions (its log: «Can't find condition for target <quest> quest id: <prestige>»,
 * 02.11.2026), the wikis give the prestige each one needs.
 *
 * The value is the prestige the character has while the quest is given (New Beginning (Prestige 4) → 3). Prestige 5 and 6
 * need «Коллекционер» in the game's conditions; no «Новое начало» of theirs has a known id.
 */
export const PRESTIGE_QUESTS: ReadonlyMap<string, number> = new Map([
  ['6761f28a022f60bb320f3e95', 0],
  ['6761ff17cdc36bd66102e9d0', 1],
  ['6848100b00afffa81f09e365', 2],
  ['68481881f43abfdda2058369', 3],
])

type JsonRecord = Record<string, unknown>

/**
 * The prestige a task of tarkov.dev's tasks file is given at: the table above, else its `requiredPrestige` (an id of the
 * file's own `prestige` list) as that prestige's level.
 */
export function taskPrestigeOf(entry: JsonRecord, root: JsonRecord): number | undefined {
  const known = PRESTIGE_QUESTS.get(typeof entry.id === 'string' ? entry.id : '')
  if (known != null) return known
  const required = typeof entry.requiredPrestige === 'string' ? entry.requiredPrestige : ''
  if (!required) return undefined
  const list = Array.isArray(root.prestige) ? root.prestige : root.prestige && typeof root.prestige === 'object' ? Object.values(root.prestige) : []
  const level = list.map((value) => value as JsonRecord).find((value) => value.id === required)?.prestigeLevel
  return typeof level === 'number' && Number.isFinite(level) ? level : undefined
}

/** Whether a quest is given at another prestige than the character's: `before` — already behind it, `after` — still ahead. */
export function prestigeMismatch(quest: { prestige?: number }, prestige: number): 'before' | 'after' | undefined {
  if (quest.prestige == null) return undefined
  const own = Math.max(0, Math.round(prestige || 0))
  if (quest.prestige === own) return undefined
  return quest.prestige < own ? 'before' : 'after'
}
