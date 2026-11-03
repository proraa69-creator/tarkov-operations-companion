import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'
import { PAUSE_1S, runHiddenScript, SYSTEM32 } from './hiddenScript.js'
import { verifiedSetupManifest, type UpdateManifest } from './updateManifest.js'

/**
 * The players' app installed by RaidOSSetup.exe (owner, 03.11.2026: «сделай установочный файл, можно выбрать куда
 * установить. установил и приложение распаковывается туда, после этого пусть обновляется частями, и запускается
 * быстро»). The portable exe unpacked 630 MB into %TEMP% on every start — twice, with the administrator relaunch
 * (electron/experimental/elevation.ts) — and the window ran from that folder, so a shortcut or a pin to it broke when the
 * app closed. The installed copy runs from its own folder: it starts at once, its shortcuts stay, parts of a release come
 * as before (electron/deltaUpdate.ts) and a release parts cannot bring is put in by the installer itself, silently, at
 * the next start (electron/appUpdate.ts). A portable copy offers the installer once the site publishes it (offer below).
 */

/** electron-builder's NSIS installer puts its uninstaller («Uninstall Raid OS.exe») next to the app's exe; a portable copy never has one. */
const UNINSTALLER = /^Uninstall .+\.exe$/i
export const SETUP_FILE_PATH = '/downloads/RaidOSSetup.exe'
export const SETUP_MANIFEST_PATH = '/downloads/setup.json'
/** The portable exe a copy left for the installer (its own path): the installed copy removes it on its first start. */
const MIGRATION_FILE = 'portable-migration.json'

/** The exe of a copy installed by RaidOSSetup.exe; null for the portable exe, a development run or another OS. */
export function installedExe(): string | null {
  if (process.platform !== 'win32' || !app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return null
  try {
    return readdirSync(dirname(process.execPath)).some((name) => UNINSTALLER.test(name)) ? process.execPath : null
  } catch {
    return null
  }
}

/** What an update replaces or starts again: the portable exe, or the installed app's exe. */
export function updatableExe() {
  return process.env.PORTABLE_EXECUTABLE_FILE || installedExe()
}

/** The installer's signed manifest on the site, or null (not published yet, unsigned, offline). */
export async function fetchSetupManifest(base: string): Promise<UpdateManifest | null> {
  if (!base.startsWith('https://')) return null
  try {
    const response = await fetch(`${base}${SETUP_MANIFEST_PATH}?ts=${Date.now()}`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' }, cache: 'no-store' })
    return response.ok ? verifiedSetupManifest(await response.json()) : null
  } catch {
    return null // not published yet (the site answers with its page) or offline
  }
}

/** Where a downloaded installer waits (not next to the exe: a folder in Program Files may not take it). */
export function setupDownloadFile() {
  return join(app.getPath('userData'), 'updates', 'RaidOSSetup.exe')
}

export function prepareSetupDownloadFolder() {
  mkdirSync(dirname(setupDownloadFile()), { recursive: true })
}

/**
 * An installed copy, a release parts cannot bring: once this copy has quit, the installer puts the release into the same
 * folder without a window and starts the app again (NSIS `/S`, electron-builder's `--updated --force-run`; `/D=` must be
 * the last argument, unquoted). A hidden cmd waits for this process (electron/hiddenScript.ts); paths travel in
 * environment variables (non-Latin folder names).
 */
export function runSetupWhenClosed(setup: string, exe: string) {
  return runHiddenScript(`raidos-setup-${process.pid}.cmd`, [
    'set n=0',
    ':wait',
    `${SYSTEM32}\\tasklist.exe /FI "PID eq %RO_PID%" /NH 2>nul | ${SYSTEM32}\\find.exe " %RO_PID% " >nul || goto run`,
    'set /a n+=1',
    'if %n% geq 90 goto run',
    PAUSE_1S,
    'goto wait',
    ':run',
    PAUSE_1S,
    '"%RO_SETUP%" /S --updated --force-run /D=%RO_DIR%',
    'del "%RO_SETUP%" >nul 2>&1',
  ], { RO_PID: String(process.pid), RO_SETUP: setup, RO_DIR: dirname(exe) })
}

/**
 * A portable copy, «Установить»: the installer opens with its window (the player picks the folder) and this copy quits,
 * so the two never use the same settings at once. The installed copy removes this exe on its first start.
 */
export function openSetupForPortable(setup: string) {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE
  if (!portable) throw new Error('Установщик открывается только из скачанного exe')
  writeFileSync(join(app.getPath('userData'), MIGRATION_FILE), JSON.stringify({ exe: portable, at: new Date().toISOString() }))
  const child = spawn(setup, [], { detached: true, stdio: 'ignore', cwd: dirname(setup) })
  child.unref()
}

/**
 * The installed copy's first start after «Установить» in a portable one: that exe (the path it wrote itself) and the
 * update it may have left next to it go. Anything else, or a file that is not there any more, is left alone.
 */
export function removeMigratedPortable() {
  if (!installedExe()) return
  const file = join(app.getPath('userData'), MIGRATION_FILE)
  if (!existsSync(file)) return
  try {
    const exe = (JSON.parse(readFileSync(file, 'utf8')) as { exe?: unknown }).exe
    if (typeof exe === 'string' && /\.exe$/i.test(exe) && exe.toLowerCase() !== process.execPath.toLowerCase() && existsSync(exe) && statSync(exe).isFile()) {
      rmSync(exe, { force: true })
      rmSync(`${exe}.update`, { force: true })
    }
  } catch (error) {
    console.warn('Raid OS: the old portable exe could not be removed', error)
  }
  rmSync(file, { force: true })
}

/** NSIS's own temporary folder, where the portable exe's stub unpacks the app: %TEMP%\nsXNNNN.tmp\app. */
const UNPACKED = /^ns[a-z0-9]+\.tmp$/i
/** A leftover taken for removal; one a removal left half done goes at the next start. */
const TAKEN = '.raidos-old'
const APP_EXE = /^Raid OS.*\.exe$/i
const LEFTOVER_AGE_MS = 60 * 60_000

/**
 * The folders the portable exe left in %TEMP% (player, 03.11.2026: «он просто в темпе все файлы хранит и они там
 * остаются мусором… Подчеркнул все папки которые создаются с каждым новым запуском»). Its stub unpacks the app into a
 * new nsXNNNN.tmp on every start and removes it the moment the window's process ends, while the app's other processes
 * still hold «Raid OS.exe» and its libraries — and not at all when Windows shuts down with the app open: up to 630 MB a
 * start. A folder goes when its app folder holds a «Raid OS» exe, it is not this copy's own, it was left over an hour
 * ago and nothing runs from it (Windows refuses to open a running exe for writing; it does let its folder be renamed,
 * tried on Windows 10). Never while the game runs.
 */
export async function removePortableLeftovers(gameRunning: () => Promise<boolean>, temp = tmpdir()) {
  if (process.platform !== 'win32' || !app.isPackaged) return
  const own = process.env.PORTABLE_EXECUTABLE_FILE ? basename(dirname(dirname(process.execPath))).toLowerCase() : ''
  let names: string[]
  try {
    names = await readdir(temp)
  } catch {
    return
  }
  const leftovers: string[] = []
  for (const name of names) {
    if (name.toLowerCase() === own) continue
    if (name.endsWith(TAKEN) && UNPACKED.test(name.slice(0, -TAKEN.length))) leftovers.push(join(temp, name))
    else if (UNPACKED.test(name) && await leftBehind(join(temp, name))) leftovers.push(join(temp, name))
  }
  for (const folder of leftovers) {
    if (await gameRunning()) return
    try {
      const taken = folder.endsWith(TAKEN) ? folder : `${folder}${TAKEN}`
      if (taken !== folder) await rename(folder, taken)
      await rm(taken, { recursive: true, force: true })
    } catch {
      // A file is still held: the next start looks again.
    }
  }
}

async function leftBehind(folder: string) {
  try {
    if (Date.now() - (await stat(folder)).mtimeMs < LEFTOVER_AGE_MS) return false
    const exes = (await readdir(join(folder, 'app'))).filter((name) => APP_EXE.test(name))
    // A copy may still run from it: a pin to that exe, or a stub Windows never let finish.
    for (const exe of exes) await (await open(join(folder, 'app', exe), 'r+')).close()
    return exes.length > 0
  } catch {
    return false
  }
}
