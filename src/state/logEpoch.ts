import type { RaidMode } from '../domain/types'
import type { LogEpochChange } from '../import/logApply'

/**
 * «Character changed / reset» (R4, audit step 25): told when a mode of a local profile gets another character (a wipe,
 * another game account) or a newer trusted reset of the same one, right after AppState dropped that mode's quest, story
 * and objective records older than `at` (src/state/AppState.tsx applyLogStateForMode). Anything else kept per character
 * or per epoch — the traders-screen loyalty, for one — drops its own readings of that mode older than `at` here. The same
 * point is in the state too: `ModeProgress.logCharacterId`, `logResetAt` and `logEpochAt`.
 */
export interface LogEpochEvent extends LogEpochChange {
  /** The local profile (AppState's active profile id). */
  profileId: string
  mode: RaidMode
}

type Listener = (event: LogEpochEvent) => void

const listeners = new Set<Listener>()
/** Each change is told once (a state updater may run twice). */
const told = new Set<string>()

export function onLogEpochChange(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Called by AppState inside its state update: the listeners hear it right after, outside that update. */
export function announceLogEpochChange(event: LogEpochEvent) {
  const key = JSON.stringify([event.profileId, event.mode, event.kind, event.at, event.characterId ?? ''])
  if (told.has(key)) return
  told.add(key)
  queueMicrotask(() => { for (const listener of listeners) listener(event) })
}
