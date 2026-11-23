/**
 * The game's own id of a quest objective, the key every hand fix of an objective is written under (src/data/stalePlaces.ts,
 * MISSING_OBJECTIVE_KEYS, QUEST_EXTRA_PLACES, QUEST_POINT_FLOORS).
 *
 * The `_ru` / `_en` dictionaries of tarkov.dev translate an objective's `id` together with its description (the id is the
 * description's key), so in the translated tasks the app adapts an objective's `id` is its text. The untranslated objective at
 * the same place, of the same type, has the game's id. Without the untranslated data (tasks already untranslated, the app's
 * own quests) the objective's id is the game's. Owner, 23.11.2026: report 215 — «Витамины» still on Shoreline after its fix of
 * 10.11; the fixes of «Должник», «Слежка» and «Умный в гору не пойдёт» did not reach the app either.
 */
type JsonRecord = Record<string, unknown>

const asRecord = (value: unknown): JsonRecord => (value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {})
const text = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

/** The game's id of `objective`, `raw` being the untranslated objective at its place (none: its own id). */
export function gameObjectiveId(objective: unknown, raw: unknown): string {
  const own = text(asRecord(objective).id)
  const aligned = asRecord(raw)
  return text(aligned.id) && text(aligned.type) === text(asRecord(objective).type) ? text(aligned.id) : own
}

/** The game's ids of a task's objectives, by the objective, against the task's untranslated objectives in the same order. */
export function gameObjectiveIds(objectives: readonly unknown[], rawObjectives: unknown): (objective: unknown) => string {
  const raw = Array.isArray(rawObjectives) ? rawObjectives : []
  const ids = new Map<unknown, string>(objectives.map((objective, index) => [objective, gameObjectiveId(objective, raw[index])]))
  return (objective) => ids.get(objective) ?? text(asRecord(objective).id)
}

/** `table`'s entry for an objective: under its game id, else under the id it has here. */
export function byObjective<T>(table: Readonly<Record<string, T>>, gameId: string, id: string): T | undefined {
  const at = (key: string) => (key && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined)
  return at(gameId) ?? at(id)
}
