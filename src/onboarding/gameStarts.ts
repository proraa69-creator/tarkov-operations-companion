/**
 * The first-launch notice «Перезапустите Escape from Tarkov» (src/onboarding/GameRestartNotice.tsx) is shown once per
 * computer (owner, 16.10.2026: «все уведомления показываются только один раз»); before that it was shown at every app
 * start until the game's «Выбор профиля и режима» screen has been read, or until the game was started three times
 * without it (audit P4f): once per computer was not enough when that one reading failed, and three starts are enough
 * chances — after that the notice would only nag. Both are kept on this computer.
 */
export const GAME_RESTART_KEY = 'raidos.first-launch.game-restart.v2'
/** Game starts seen without a mode selection reading, after which the notice is no longer shown. */
export const GAME_START_LIMIT = 3
/** A game window first seen this soon after the app started was already running then: not a start the app saw. */
export const ALREADY_RUNNING_MS = 10_000

interface GameStartRecord {
  /** The notice was shown on this computer: never again (owner, 16.10.2026: «только по одному разу»). */
  shown?: boolean
  /** A mode selection screen was read on this computer. */
  read?: boolean
  /** Game starts seen. */
  starts?: number
  /** When the last counted game window was first seen (the main process's clock): the same window counts once. */
  lastSince?: number
}

/** About when the app started (this module loads with the page). */
const appStartedAt = Date.now()

function load(): GameStartRecord {
  try {
    const value = JSON.parse(localStorage.getItem(GAME_RESTART_KEY) ?? '{}') as unknown
    return value && typeof value === 'object' ? value as GameStartRecord : {}
  } catch {
    return {}
  }
}

function save(record: GameStartRecord) {
  try { localStorage.setItem(GAME_RESTART_KEY, JSON.stringify(record)) } catch { /* storage unavailable: counted again next time */ }
}

/**
 * A look at the game told of its window (electron/screenOcr.ts): a new game window, first seen at `gameSince` while the
 * app was already running, is one game start. Every look of the same window gives the same time; a later window, a later one.
 */
export function noteGameSighting(frame: { freshGame?: boolean; gameSince?: number } | null | undefined, startedAt = appStartedAt) {
  const since = frame?.gameSince
  if (!frame?.freshGame || typeof since !== 'number' || !Number.isFinite(since) || since - startedAt < ALREADY_RUNNING_MS) return
  const record = load()
  if (record.read || (record.lastSince !== undefined && since <= record.lastSince)) return
  save({ ...record, starts: (record.starts ?? 0) + 1, lastSince: since })
}

/** The game's mode selection screen was read (now, or while the app was locked). */
export function noteModeSelectRead() {
  const record = load()
  if (!record.read) save({ ...record, read: true })
}

/** The notice is still wanted on this computer: never shown, no mode selection reading yet, fewer than three game starts. */
export function gameRestartNoticeDue() {
  const record = load()
  return !record.shown && !record.read && (record.starts ?? 0) < GAME_START_LIMIT
}

/** The notice opened: it is not shown again on this computer, whatever happens before «Понятно». */
export function noteGameRestartNoticeShown() {
  const record = load()
  if (!record.shown) save({ ...record, shown: true })
}
