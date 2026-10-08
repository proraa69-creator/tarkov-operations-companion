import { execFile } from 'node:child_process'

const GAME_IMAGE = 'EscapeFromTarkov.exe'

/**
 * Whether Escape from Tarkov is running (Windows `tasklist`): true / false, or null when it can't be told (another
 * system, tasklist failed) — then the caller keeps relying on the logs. Only reads the process list.
 */
export function isTarkovRunning(): Promise<boolean | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${GAME_IMAGE}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : gameInTaskList(String(stdout)))
    })
  })
}

/** tasklist CSV output → whether the game's image is listed (no match prints an «INFO: …» line instead). */
export function gameInTaskList(output: string) {
  return output.split(/\r?\n/).some((line) => line.trim().toLowerCase().startsWith(`"${GAME_IMAGE.toLowerCase()}"`))
}
