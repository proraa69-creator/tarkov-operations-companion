// Hand Control focus guard. A hand click must never take focus away from the game, so for a
// short time after one, actions that open an OS dialog, a browser or a new window are refused.

const GUARD_MS = 1200
let lastHandAction = Number.NEGATIVE_INFINITY

export function markHandAction(now = Date.now()) {
  lastHandAction = now
}

export function handActionRecent(now = Date.now()) {
  return now - lastHandAction < GUARD_MS
}
