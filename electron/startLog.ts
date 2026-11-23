/**
 * The start log (owner, 23.11.2026: a player's window stayed dark at every start with 0.6.0.335 too, the shortcut with
 * --disable-gpu as well): what each start of the app went through — its version and Windows, the fallbacks it is in, the
 * graphics card, and what became of its page and its processes — in start-log.txt in the data folder. No paths, no account,
 * nothing typed: the lines the player copies for support (electron/main.ts showStartFailure) come from here.
 */
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const START_LOG_FILE = 'start-log.txt'
/** Past this the older half goes: a few hundred starts are kept. */
export const START_LOG_MAX_BYTES = 256 * 1024

export function appendStartLog(dataFolder: string, line: string, now = new Date()) {
  try {
    const file = join(dataFolder, START_LOG_FILE)
    if (existsSync(file) && statSync(file).size > START_LOG_MAX_BYTES) {
      const kept = readFileSync(file, 'utf8').slice(-START_LOG_MAX_BYTES / 2)
      writeFileSync(file, kept.slice(kept.indexOf('\n') + 1))
    }
    appendFileSync(file, `${now.toISOString()} ${line.replace(/\s*\n\s*/g, ' ')}\n`)
  } catch {
    // a log that cannot be written never stops a start
  }
}

/** The last lines of the log, for the support text. */
export function startLogTail(dataFolder: string, lines = 40) {
  try {
    const text = readFileSync(join(dataFolder, START_LOG_FILE), 'utf8').trimEnd().split('\n')
    return text.slice(-lines).join('\n')
  } catch {
    return ''
  }
}
