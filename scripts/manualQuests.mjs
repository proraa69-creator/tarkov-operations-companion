// The quests changed by hand (src/data/manualQuests.json; owner, 23.11.2026: «при обновлениях из базы их не трогай»), for the
// data generators: a generator that rebuilds its file from the sites keeps the entries of these quests as they were.
import registry from '../src/data/manualQuests.json' with { type: 'json' }

const own = (object, key) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, key)

/** The registered quest `id` in `mode` ('pvp' | 'pve' | 'seasonal'); no mode (data of every mode): registered for every mode. */
export function manualQuest(id, mode) {
  const entry = own(registry.quests, id) ? registry.quests[id] : undefined
  if (!entry) return undefined
  if (entry.modes && (!mode || !entry.modes.includes(mode))) return undefined
  return entry
}

/**
 * `next` (entries by quest id, rebuilt from the sites) with the registered quests' entries as `previous` had them: kept, or
 * left out when it had none. The names of the quests whose entries the rebuild would have changed.
 */
export function keepManualEntries(next, previous, mode) {
  const held = []
  for (const id of Object.keys(registry.quests)) {
    const entry = manualQuest(id, mode)
    if (!entry) continue
    const before = own(previous, id) ? previous[id] : undefined
    if (JSON.stringify(before) !== JSON.stringify(own(next, id) ? next[id] : undefined)) held.push(entry.name)
    if (before === undefined) delete next[id]
    else next[id] = before
  }
  return held
}

/** One line for the generator's output: what it left as it was. */
export function heldLine(held, what) {
  return held.length ? `hand-changed quests kept as they were (${what}): ${[...new Set(held)].join(', ')}` : `hand-changed quests: nothing to keep (${what})`
}
