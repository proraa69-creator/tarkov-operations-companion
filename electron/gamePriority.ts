import { constants, setPriority } from 'node:os'

/**
 * While the game's window is in front, the app's main process (the quest screen reading's OCR, a partial update's
 * archive, the log parsing workers) runs below normal priority, so it never takes the CPU from the game (a player,
 * 03.11.2026: «с запущенной прогой, время от времени у меня начали появлятся статтеры в игре, они идут минуты 2 потом
 * пропадают»); with the app's own window in front it is back to normal. Set only on a change; electron/screenTuning
 * calls it from its tick (Windows only).
 */
let belowNormal: boolean | null = null

export function followGameFront(gameInFront: boolean, set: (priority: number) => void = (priority) => setPriority(process.pid, priority)) {
  if (belowNormal === gameInFront) return
  belowNormal = gameInFront
  try {
    set(gameInFront ? constants.priority.PRIORITY_BELOW_NORMAL : constants.priority.PRIORITY_NORMAL)
  } catch {
    // Not allowed or not supported: the priority stays as it was.
  }
}

/** Tests only. */
export function resetGamePriorityForTests() {
  belowNormal = null
}
