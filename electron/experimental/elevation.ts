import { dirname } from 'node:path'
import { app } from 'electron'
import { isElevated, runElevated } from './win32.js'

/** Marks the copy started by relaunchAsAdmin; carries the process id of the copy that asked. */
const RELAUNCH_ARG = '--elevated-relaunch'

/** This copy was started by relaunchAsAdmin: it never asks again, even when Windows still ran it without the rights. */
export function isElevatedRelaunch() {
  return process.argv.some((arg) => arg === RELAUNCH_ARG || arg.startsWith(`${RELAUNCH_ARG}=`))
}

/**
 * Starts the app again with administrator rights (the Windows consent prompt) and quits this copy.
 * The portable exe unpacks the app to a temporary folder that is removed when it exits, so the exe itself
 * is started again. False when the rights were refused or cannot be asked for.
 */
export function relaunchAsAdmin() {
  if (process.platform !== 'win32' || isElevated() !== false) return false
  const portable = process.env.PORTABLE_EXECUTABLE_FILE
  const file = portable || process.execPath
  const args = portable ? [] : process.argv.slice(1).filter((arg) => !arg.startsWith(RELAUNCH_ARG))
  const params = [...args, `${RELAUNCH_ARG}=${process.pid}`].map(quoteArg).join(' ')
  if (!runElevated(file, params, dirname(file))) return false
  setImmediate(() => app.quit())
  return true
}

/**
 * The copy that asked for the rights may still be closing. Wait for it, so the two never use the same
 * profile (settings, local storage) at the same time.
 */
export async function waitForPreviousCopy(timeoutMs = 15_000) {
  const arg = process.argv.find((value) => value.startsWith(`${RELAUNCH_ARG}=`))
  const pid = Number(arg?.slice(RELAUNCH_ARG.length + 1))
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/** Windows command-line quoting for one argument. */
function quoteArg(arg: string) {
  if (arg && !/[\s"]/.test(arg)) return arg
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
}
