import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, win32 } from 'node:path'

export interface EftLogDiscovery {
  logsFolder?: string
  gameFolder?: string
  gamesRoot?: string
}

export function parseLauncherGamesRoot(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { gamesRootDir?: unknown }
    return typeof parsed.gamesRootDir === 'string' && parsed.gamesRootDir.trim()
      ? parsed.gamesRootDir.trim()
      : undefined
  } catch {
    return undefined
  }
}

export function buildLogFolderCandidates(gamesRoot?: string, drives = windowsDriveRoots()) {
  const candidates: string[] = []
  const add = (value: string) => {
    const normalized = win32.normalize(value)
    if (!candidates.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) candidates.push(normalized)
  }

  if (gamesRoot) {
    add(win32.join(gamesRoot, 'Escape from Tarkov', 'Logs'))
    add(win32.join(gamesRoot, 'EFT', 'Logs'))
  }

  for (const drive of drives) {
    for (const relative of [
      ['Battlestate Games', 'Escape from Tarkov', 'Logs'],
      ['Battlestate Games', 'EFT', 'Logs'],
      ['Games', 'Battlestate Games', 'Escape from Tarkov', 'Logs'],
      ['Games', 'Battlestate Games', 'EFT', 'Logs'],
      ['Games', 'Escape from Tarkov', 'Logs'],
      ['Escape from Tarkov', 'Logs'],
      // the Steam version
      ['Program Files (x86)', 'Steam', 'steamapps', 'common', 'Escape from Tarkov', 'build', 'Logs'],
      ['Program Files (x86)', 'Steam', 'steamapps', 'common', 'Escape from Tarkov', 'Logs'],
      ['SteamLibrary', 'steamapps', 'common', 'Escape from Tarkov', 'build', 'Logs'],
      ['SteamLibrary', 'steamapps', 'common', 'Escape from Tarkov', 'Logs'],
    ]) add(win32.join(`${drive}\\`, ...relative))
  }

  return candidates
}

/** Common per-user locations used by installs that do not appear in launcher settings. */
export function buildUserLogFolderCandidates(appDataDirectory: string) {
  const userRoot = win32.dirname(win32.dirname(appDataDirectory))
  const localAppData = win32.join(userRoot, 'AppData', 'Local')
  const documents = win32.join(userRoot, 'Documents')
  return [
    win32.join(localAppData, 'Battlestate Games', 'Escape from Tarkov', 'Logs'),
    win32.join(localAppData, 'Battlestate Games', 'EFT', 'Logs'),
    win32.join(documents, 'Escape from Tarkov', 'Logs'),
    win32.join(documents, 'EFT', 'Logs'),
  ]
}

/**
 * Escape from Tarkov on Steam (store app 3932890) writes its logs to <library>\steamapps\common\Escape from Tarkov\build\Logs,
 * and a Steam library can be any folder on any drive (owner, 13.10.2026: a player with the Steam version had no logs
 * found — only <drive>:\SteamLibrary and Program Files (x86)\Steam were tried).
 */
export const STEAM_EFT_APP_ID = '3932890'

const unescapeVdf = (value: string) => value.replace(/\\(.)/g, '$1')

/** The library folders listed in Steam's steamapps\libraryfolders.vdf («"path"  "D:\\SteamLibrary"»). */
export function parseSteamLibraryFolders(raw: string): string[] {
  return [...raw.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/gi)].map((match) => unescapeVdf(match[1]!).trim()).filter(Boolean)
}

/** The folder under steamapps\common named by an appmanifest_<app>.acf («"installdir"  "Escape from Tarkov"»). */
export function parseSteamInstallDir(raw: string): string | undefined {
  const match = /"installdir"\s+"((?:[^"\\]|\\.)*)"/i.exec(raw)
  const folder = match ? unescapeVdf(match[1]!).trim() : ''
  return folder && !/[\\/:]|\.\./.test(folder) ? folder : undefined
}

type RegistryQuery = (key: string, name: string) => Promise<string | undefined>

/** One REG_SZ value through reg.exe (read only); undefined off Windows or when it is missing. */
const registryValue: RegistryQuery = (key, name) => new Promise((resolve) => {
  if (process.platform !== 'win32') { resolve(undefined); return }
  execFile('reg', ['query', key, '/v', name], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
    if (error) { resolve(undefined); return }
    const line = String(stdout).split(/\r?\n/).find((entry) => entry.trim().toLowerCase().startsWith(`${name.toLowerCase()} `))
    resolve(/REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i.exec(line ?? '')?.[1] || undefined)
  })
})

/** Where Steam itself may be: the registry (the player's SteamPath, the machine's InstallPath), then the usual folders. */
export async function steamRoots(query: RegistryQuery = registryValue, drives = windowsDriveRoots()): Promise<string[]> {
  const roots: string[] = []
  const add = (value: string | undefined) => {
    if (!value) return
    const normalized = win32.normalize(value).replace(/\\+$/, '')
    if (!roots.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) roots.push(normalized)
  }
  for (const [key, name] of [['HKCU\\Software\\Valve\\Steam', 'SteamPath'], ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'], ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath']] as const) {
    add(await query(key, name).catch(() => undefined))
  }
  for (const drive of drives) for (const relative of [['Program Files (x86)', 'Steam'], ['Program Files', 'Steam'], ['Steam']]) add(win32.join(`${drive}\\`, ...relative))
  return roots
}

export interface SteamFiles {
  read(path: string): Promise<string>
  list(path: string): Promise<string[]>
}
const diskFiles: SteamFiles = { read: (path) => readFile(path, 'utf8'), list: (path) => readdir(path) }

/**
 * The Logs folders Escape from Tarkov on Steam can write to: in every library of every Steam found (its
 * libraryfolders.vdf), the game's folder from appmanifest_3932890.acf, any «…Tarkov…» folder in steamapps\common
 * (not Arena) and «Escape from Tarkov» — each with build\Logs (where the Steam build writes) and Logs.
 */
export async function steamLogFolderCandidates(roots: string[], files: SteamFiles = diskFiles): Promise<string[]> {
  const libraries: string[] = []
  const addLibrary = (value: string) => {
    const normalized = win32.normalize(value).replace(/\\+$/, '')
    if (!libraries.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) libraries.push(normalized)
  }
  for (const root of roots) {
    const listed = await files.read(win32.join(root, 'steamapps', 'libraryfolders.vdf')).catch(() => '')
    if (!listed) continue
    addLibrary(root)
    for (const library of parseSteamLibraryFolders(listed)) addLibrary(library)
  }
  const candidates: string[] = []
  const add = (value: string) => { if (!candidates.some((entry) => entry.toLowerCase() === value.toLowerCase())) candidates.push(value) }
  for (const library of libraries) {
    const common = win32.join(library, 'steamapps', 'common')
    const folders: string[] = []
    const manifest = await files.read(win32.join(library, 'steamapps', `appmanifest_${STEAM_EFT_APP_ID}.acf`)).catch(() => '')
    const installed = manifest ? parseSteamInstallDir(manifest) : undefined
    if (installed) folders.push(installed)
    for (const name of await files.list(common).catch(() => [] as string[])) if (/tarkov/i.test(name) && !/arena/i.test(name)) folders.push(name)
    folders.push('Escape from Tarkov')
    for (const folder of folders) {
      add(win32.join(common, folder, 'build', 'Logs'))
      add(win32.join(common, folder, 'Logs'))
    }
  }
  return candidates
}

/** Steam's libraries change rarely: looked up once a minute at most (reg.exe and the .vdf files). */
let steamCache: { at: number; candidates: Promise<string[]> } | undefined
function cachedSteamCandidates() {
  if (process.platform !== 'win32') return Promise.resolve([] as string[])
  if (!steamCache || Date.now() - steamCache.at > 60_000) steamCache = { at: Date.now(), candidates: steamRoots().then((roots) => steamLogFolderCandidates(roots)).catch(() => []) }
  return steamCache.candidates
}

export async function discoverEftLogs(appDataDirectory: string): Promise<EftLogDiscovery> {
  const launcherSettings = join(appDataDirectory, 'Battlestate Games', 'BsgLauncher', 'settings')
  const settingsRaw = await readFile(launcherSettings, 'utf8').catch(() => '')
  const gamesRoot = parseLauncherGamesRoot(settingsRaw)

  for (const candidate of [...buildLogFolderCandidates(gamesRoot), ...await cachedSteamCandidates(), ...buildUserLogFolderCandidates(appDataDirectory)]) {
    if (await isDirectory(candidate)) {
      return { logsFolder: candidate, gameFolder: dirname(candidate), gamesRoot }
    }
  }

  const fallbackGameFolder = gamesRoot ? join(gamesRoot, 'Escape from Tarkov') : undefined
  return {
    gameFolder: fallbackGameFolder && await isDirectory(fallbackGameFolder) ? fallbackGameFolder : gamesRoot,
    gamesRoot,
  }
}

/** Every Logs folder that exists among the candidates (the launcher's games folder first). */
export async function discoverAllEftLogs(appDataDirectory: string): Promise<string[]> {
  const settingsRaw = await readFile(join(appDataDirectory, 'Battlestate Games', 'BsgLauncher', 'settings'), 'utf8').catch(() => '')
  const found: string[] = []
  for (const candidate of [...buildLogFolderCandidates(parseLauncherGamesRoot(settingsRaw)), ...await cachedSteamCandidates(), ...buildUserLogFolderCandidates(appDataDirectory)]) {
    if (await isDirectory(candidate) && !found.some((entry) => entry.toLowerCase() === candidate.toLowerCase())) found.push(candidate)
  }
  return found
}

/** «log_2026.09.27_2-33-45_1.1.5.1» → the launch time (the hour is not zero-padded); 0 for other names. */
export function launchTime(name: string) {
  const match = /^log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{2})-(\d{2})/i.exec(name)
  if (!match) return 0
  const [, year, month, day, hour, minute, second] = match.map(Number)
  return Date.UTC(year!, month! - 1, day!, hour!, minute!, second!)
}

/** When the game last started with this Logs folder: its newest launch folder (by name, else by time); 0 if none. */
export async function lastLaunch(folder: string): Promise<number> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
  let newest = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^log_/i.test(entry.name)) continue
    const named = launchTime(entry.name)
    newest = Math.max(newest, named || (await stat(join(folder, entry.name)).catch(() => null))?.mtimeMs || 0)
  }
  return newest
}

/**
 * The Logs folder the game writes to now (owner, 12.10.2026: «разберись, чтобы брались актуальные логи»): of the folder
 * in use and every one found, the one with the newest game launch. A folder the app once used is kept only while the
 * game still starts there — after a reinstall elsewhere the old folder still exists, and its old logs were read on.
 */
export async function freshestLogsFolder(folders: Array<string | undefined>): Promise<string | undefined> {
  let best: { folder: string; at: number } | undefined
  for (const folder of folders) {
    if (!folder) continue
    const at = await lastLaunch(folder)
    if (!best || at > best.at) best = { folder, at }
  }
  return best?.folder
}

/** The picked folder → its Logs folder: the folder itself, its Logs, or build\Logs (the Steam game folder). */
export async function normalizeSelectedLogsFolder(selectedFolder: string) {
  if (basename(selectedFolder).toLowerCase() === 'logs') return selectedFolder
  for (const child of [join(selectedFolder, 'Logs'), join(selectedFolder, 'build', 'Logs')]) if (await isDirectory(child)) return child
  return selectedFolder
}

async function isDirectory(path: string) {
  const info = await stat(path).catch(() => null)
  return Boolean(info?.isDirectory())
}

function windowsDriveRoots() {
  return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:`)
}
