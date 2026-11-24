import { constants, setPriority } from 'node:os'

/**
 * While the game's window is in front, the app's main process (the quest screen reading's OCR, a partial update's
 * archive, the log parsing workers) runs below normal priority, so it never takes the CPU from the game (a player,
 * 03.11.2026: «с запущенной прогой, время от времени у меня начали появлятся статтеры в игре, они идут минуты 2 потом
 * пропадают»); with the app's own window in front it is back to normal. Set only on a change; electron/screenTuning
 * calls it from its tick (Windows only).
 *
 * Report 227 (25.11.2026, «игра фризит», a laptop): the page's process (the quest matching after each screen reading, the
 * map) and Chromium's graphics process stayed at normal priority beside the game. `pids` gives every process of the app
 * (electron/screenTuning: app.getAppMetrics()), and each is set on its own: one that refuses leaves the others as set.
 */
let belowNormal: boolean | null = null

export function followGameFront(
  gameInFront: boolean,
  set: (priority: number, pid: number) => void = (priority, pid) => setPriority(pid, priority),
  pids: () => number[] = () => [process.pid],
) {
  if (belowNormal === gameInFront) return
  belowNormal = gameInFront
  const priority = gameInFront ? constants.priority.PRIORITY_BELOW_NORMAL : constants.priority.PRIORITY_NORMAL
  let list: number[] = [process.pid]
  try { list = [...new Set([process.pid, ...pids()])] } catch { /* the main process at least */ }
  for (const pid of list) {
    try {
      set(priority, pid)
    } catch {
      // Not allowed, not supported or the process is gone: its priority stays as it was.
    }
  }
}

/** Tests only. */
export function resetGamePriorityForTests() {
  belowNormal = null
}
