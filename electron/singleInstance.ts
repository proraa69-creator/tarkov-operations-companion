import type { BrowserWindow } from 'electron'

/**
 * One copy of the app at a time (owner, 04.11.2026: «приложение может запускаться бесконечно раз и из за второго запуска
 * ломается, сделай что бы оно не запускалось еще раз при активном первом»): two copies share one profile (settings, local
 * storage, the logs' caches). A second start leaves at once and the running copy's window comes forward.
 *
 * The lock belongs to the data folder (Electron's single-instance lock), so an installed copy and a portable one count as
 * one, and the test build for friends, with a folder of its own, does not count against them.
 */

/** How long a copy this app started itself waits for the lock: the copy before it has just gone. */
const LOCK_WAIT_MS = 5000
const LOCK_PAUSE_MS = 1000

/**
 * This copy was started by the app itself, in place of a copy that is leaving: the start with administrator rights, the
 * installer's start after an update, the server laptop's restart. It takes the lock only once that copy is gone, and a
 * refusal then must not leave the player with no app at all, so it asks again for a moment.
 */
export function startedByTheApp(argv: readonly string[]) {
  return argv.some((arg) => arg === '--updated' || arg === '--server-mode' || arg === '--elevated-relaunch' || arg.startsWith('--elevated-relaunch='))
}

/** Asks for the lock until it is free or LOCK_WAIT_MS went by. Every refused request also brings the holder's window forward. */
export async function waitForInstanceLock(request: () => boolean, waitMs = LOCK_WAIT_MS, pauseMs = LOCK_PAUSE_MS) {
  const until = Date.now() + waitMs
  for (;;) {
    if (request()) return true
    if (Date.now() >= until) return false
    await new Promise((resolve) => setTimeout(resolve, pauseMs))
  }
}

/** A second start asked for this window: it is all a second start can do, whatever it was started with. */
export function bringToFront(window: Pick<BrowserWindow, 'isDestroyed' | 'isMinimized' | 'restore' | 'show' | 'focus'> | null) {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
