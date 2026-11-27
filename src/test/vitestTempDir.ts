/**
 * Vitest 5 leaves a folder in the system Temp after every run: the root process keeps the modules it hands the test workers
 * in os.tmpdir()/<nanoid> (a `client` and an `ssr` folder, a file per module named by its SHA-1) and never removes it; only a
 * project's own folder is cleared on close, and a config without `projects` does not use that one. On the owner's PC that
 * came to 995 folders, ~11 GB, and a full disk C: on 27.11.2026. This plugin (vite.config.ts) removes the run's folder when
 * Vitest closes, and the ones earlier runs left — killed runs, checkouts without this plugin — once a day has passed since
 * they last changed (no test run takes that long).
 */
import { lstat, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { Plugin } from 'vitest/config'

/** nanoid(): 21 characters of A-Z a-z 0-9 _ - */
const RUN_FOLDER = /^[\w-]{21}$/
/** The module environments Vitest writes a folder for. */
const ENVIRONMENTS = new Set(['client', 'ssr'])
export const LEFTOVER_AGE_MS = 24 * 60 * 60 * 1000

/**
 * True when `folder` is a Vitest run folder unchanged for `age`: a real folder (a link or junction is never followed) holding
 * only `client`/`ssr` folders of plain files.
 */
async function isOldRunFolder(folder: string, now: number, age: number): Promise<boolean> {
  const stats = await lstat(folder)
  if (!stats.isDirectory()) return false
  const entries = await readdir(folder, { withFileTypes: true })
  if (!entries.length || entries.some((entry) => !ENVIRONMENTS.has(entry.name) || !entry.isDirectory())) return false
  let changed = stats.mtimeMs
  for (const entry of entries) changed = Math.max(changed, (await lstat(join(folder, entry.name))).mtimeMs)
  if (now - changed < age) return false
  for (const entry of entries) {
    if ((await readdir(join(folder, entry.name), { withFileTypes: true })).some((file) => !file.isFile())) return false
  }
  return true
}

/** Removes from `base` the run folders earlier Vitest runs left once they are `age` old; gives how many went. */
export async function removeLeftoverRunFolders(base = tmpdir(), now = Date.now(), age = LEFTOVER_AGE_MS): Promise<number> {
  let names: string[]
  try {
    names = await readdir(base)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    if (!RUN_FOLDER.test(name)) continue
    const folder = join(base, name)
    try {
      if (!(await isOldRunFolder(folder, now, age))) continue
      await rm(folder, { recursive: true, force: true })
      removed++
    } catch {
      // in use, already gone or not readable: left as it is
    }
  }
  return removed
}

/** One spelling for a path: Vitest writes `C:/Users/…` (pathe), Node's tmpdir() `C:\Users\…`. */
const comparable = (path: string) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path))

/** The run folder of this Vitest (`Vitest._tmpDir`, internal to Vitest 5) when it is one, right in `base`. */
function runFolderOf(vitest: object, base: string): string | null {
  const folder = (vitest as { _tmpDir?: unknown })._tmpDir
  if (typeof folder !== 'string' || !RUN_FOLDER.test(basename(folder))) return null
  return comparable(dirname(folder)) === comparable(base) ? folder : null
}

export function vitestTempCleanup(base = tmpdir()): Plugin {
  return {
    name: 'raidos-vitest-temp-cleanup',
    configureVitest({ vitest }) {
      vitest.onClose(async () => {
        const own = runFolderOf(vitest, base)
        if (own) await rm(own, { recursive: true, force: true }).catch(() => undefined)
        await removeLeftoverRunFolders(base)
      })
    },
  }
}
