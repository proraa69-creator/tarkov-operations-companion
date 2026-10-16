/**
 * The app's entry (package.json "main"). Every development run goes straight to main.ts. A packaged copy first looks for
 * a newer build staged by a partial update (electron/appDelta.ts, electron/deltaBoot.ts) in %APPDATA%\Raid OS Updates
 * (a player's copy: its «client» folder, and only a build whose signed manifest verifies with the update key) and starts
 * that build's main.js instead; a build that fails to load is marked bad and the exe's own build starts. Electron waits
 * for this module (top-level await) before «ready», so main.ts sets its paths and switches in time either way. Only Node
 * built-ins, deltaBoot.ts (with deltaInfo.ts) and the public key here: everything else must come from the build that runs.
 */
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chooseBoot, deltaRoot, markBad, stagedBuildVerified, type BootChoice, type BootFs } from './deltaBoot.js'
import { UPDATE_SIGNING_PUBLIC_KEY } from './updateSigningKey.js'

function packagedInfo(): { edition?: unknown; build?: unknown } {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'build-info.json'), 'utf8')) as { edition?: unknown; build?: unknown }
  } catch {
    return {}
  }
}

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

let choice: BootChoice | null = null
let originalFs: BootFs | null = null
const packaged = packagedInfo()
const root = app.isPackaged ? deltaRoot(app.getPath('appData'), packaged.edition === 'client' ? 'client' : 'owner') : ''
if (app.isPackaged) {
  try {
    const fs = createRequire(import.meta.url)('original-fs') as BootFs
    originalFs = fs
    choice = chooseBoot({ fs, root, packaged, pid: process.pid, alive, verify: (dir, build) => stagedBuildVerified(fs, dir, build, UPDATE_SIGNING_PUBLIC_KEY) })
  } catch {
    choice = null
  }
}

if (choice) {
  try {
    await import(pathToFileURL(choice.main).href)
  } catch (error) {
    // Nothing of it ran (an ES module graph fails while linking, before any code): the exe's own build takes over.
    console.error(`Raid OS: build ${choice.build} did not start`, error)
    try { if (originalFs) markBad(originalFs, root, choice.build) } catch { /* the next start tries again */ }
    await import('./main.js')
  }
} else {
  await import('./main.js')
}
