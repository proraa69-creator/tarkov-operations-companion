import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
 * found — only <drive>:\SteamLibrary and Program Files (x86)\Steam were tried; with every library of the Steam the
 * registry names, still not found: so also Windows' own entry of the game, a registry path in any letters, Steam's folder
 * without its library list, and at last a look through the drives).
 */
export const STEAM_EFT_APP_ID = '3932890'

type Join = (...parts: string[]) => string

/** Appends `value` unless the list has it in any letter case (Windows paths). */
function addUnique(list: string[], value: string) {
  if (value && !list.some((entry) => entry.toLowerCase() === value.toLowerCase())) list.push(value)
}
const cleanFolder = (value: string) => win32.normalize(value.trim()).replace(/\\+$/, '')
const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? ''

/** The Logs folders of a game folder: build\Logs (the Steam build writes there), then Logs (the launcher's). */
export const gameLogFolders = (game: string, join: Join = win32.join) => [join(game, 'build', 'Logs'), join(game, 'Logs')]

/** A folder of the game: «Escape from Tarkov», «EscapeFromTarkov», the launcher's old «EFT» — not Arena. */
const isGameFolderName = (name: string) => (/tarkov/i.test(name) && !/arena/i.test(name)) || /^eft$/i.test(name)

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

/**
 * A value of the key's own section in a .reg file of `reg export` (UTF-16: the exact text in any letters):
 * «"SteamPath"="d:/игры/steam"», backslashes and quotes escaped; the values of its subkeys are not taken.
 */
export function parseRegExport(raw: string, name: string): string | undefined {
  let sections = 0
  for (const line of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (line.startsWith('[')) {
      sections += 1
      if (sections > 1) break
      continue
    }
    const match = /^"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"\s*$/.exec(line)
    if (match && unescapeVdf(match[1]!).toLowerCase() === name.toLowerCase()) return unescapeVdf(match[2]!).trim() || undefined
  }
  return undefined
}

/** «%ProgramFiles(x86)%\Steam» → the folder (a REG_EXPAND_SZ value). */
const expandEnvironment = (value: string) => value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole)

function run(command: string, args: string[]) {
  return new Promise<string | undefined>((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 4000 }, (error, stdout) => resolve(error ? undefined : String(stdout)))
  })
}

/**
 * One REG_SZ value through reg.exe (read only); undefined off Windows or when it is missing. reg.exe prints in the
 * console's code page, so a value with letters beyond ASCII (D:\Игры\Steam) comes out garbled: then the key is exported
 * to a temporary .reg file (UTF-16), read and removed.
 */
const registryValue: RegistryQuery = async (key, name) => {
  if (process.platform !== 'win32') return undefined
  const output = await run('reg', ['query', key, '/v', name])
  const line = output?.split(/\r?\n/).find((entry) => entry.trim().toLowerCase().startsWith(`${name.toLowerCase()} `))
  const value = /REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i.exec(line ?? '')?.[1]
  if (!value) return undefined
  if (/^[\x20-\x7e]+$/.test(value)) return expandEnvironment(value)
  const file = join(tmpdir(), `raidos-registry-${process.pid}-${randomBytes(6).toString('hex')}.reg`)
  try {
    if (await run('reg', ['export', key, file, '/y']) === undefined) return undefined
    const exported = parseRegExport((await readFile(file)).toString('utf16le'), name)
    return exported ? expandEnvironment(exported) : undefined
  } catch {
    return undefined
  } finally {
    await unlink(file).catch(() => {})
  }
}

const UNINSTALL = 'Microsoft\\Windows\\CurrentVersion\\Uninstall'

/**
 * Windows' «Programs and features» entries of the game — Steam's for its app (in whatever library and folder) and the
 * BSG launcher's: their InstallLocation is the game folder.
 */
export const GAME_UNINSTALL_KEYS = [
  `HKLM\\SOFTWARE\\WOW6432Node\\${UNINSTALL}\\Steam App ${STEAM_EFT_APP_ID}`,
  `HKLM\\SOFTWARE\\${UNINSTALL}\\Steam App ${STEAM_EFT_APP_ID}`,
  `HKCU\\Software\\${UNINSTALL}\\Steam App ${STEAM_EFT_APP_ID}`,
  `HKLM\\SOFTWARE\\WOW6432Node\\${UNINSTALL}\\EscapeFromTarkov`,
  `HKLM\\SOFTWARE\\${UNINSTALL}\\EscapeFromTarkov`,
]

/** The game folders Windows knows from those entries. */
export async function registeredGameFolders(query: RegistryQuery = registryValue): Promise<string[]> {
  const folders: string[] = []
  const values = await Promise.all(GAME_UNINSTALL_KEYS.map((key) => query(key, 'InstallLocation').catch(() => undefined)))
  for (const value of values) {
    const folder = value?.trim().replace(/^"(.*)"$/, '$1')
    if (folder && win32.isAbsolute(folder)) addUnique(folders, cleanFolder(folder))
  }
  return folders
}

/** Where Steam itself may be: the registry (the player's SteamPath, the machine's InstallPath), then the usual folders. */
export async function steamRoots(query: RegistryQuery = registryValue, drives = windowsDriveRoots()): Promise<string[]> {
  const roots: string[] = []
  const keys = [['HKCU\\Software\\Valve\\Steam', 'SteamPath'], ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'], ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath']] as const
  for (const value of await Promise.all(keys.map(([key, name]) => query(key, name).catch(() => undefined)))) if (value) addUnique(roots, cleanFolder(value))
  for (const drive of drives) for (const relative of [['Program Files (x86)', 'Steam'], ['Program Files', 'Steam'], ['Steam']]) addUnique(roots, win32.join(`${drive}\\`, ...relative))
  return roots
}

export interface SteamFiles {
  read(path: string): Promise<string>
  /** The names of the folders in `path` (links to folders included). */
  list(path: string): Promise<string[]>
}
const diskFiles: SteamFiles = {
  read: (path) => readFile(path, 'utf8'),
  list: async (path) => (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name),
}

/**
 * The Steam libraries of the Steam folders found: the Steam folder itself (when it has steamapps — also without a library
 * list) and every library its libraryfolders.vdf names (in steamapps\, older Steam: config\).
 */
export async function steamLibraries(roots: string[], files: SteamFiles = diskFiles): Promise<string[]> {
  const libraries: string[] = []
  for (const root of roots) {
    const listed = await files.read(win32.join(root, 'steamapps', 'libraryfolders.vdf')).catch(() => '')
      || await files.read(win32.join(root, 'config', 'libraryfolders.vdf')).catch(() => '')
    if (!listed && !await files.list(win32.join(root, 'steamapps')).then(() => true, () => false)) continue
    addUnique(libraries, cleanFolder(root))
    for (const library of parseSteamLibraryFolders(listed)) addUnique(libraries, cleanFolder(library))
  }
  return libraries
}

/**
 * The Logs folders of the game in these Steam libraries: the folder its appmanifest_3932890.acf names, any «…Tarkov…»
 * folder in steamapps\common (not Arena) and «Escape from Tarkov» — each with build\Logs and Logs.
 */
export async function libraryLogFolders(libraries: string[], files: SteamFiles = diskFiles, join: Join = win32.join): Promise<string[]> {
  const candidates: string[] = []
  for (const library of libraries) {
    const common = join(library, 'steamapps', 'common')
    const folders: string[] = []
    const manifest = await files.read(join(library, 'steamapps', `appmanifest_${STEAM_EFT_APP_ID}.acf`)).catch(() => '')
    const installed = manifest ? parseSteamInstallDir(manifest) : undefined
    if (installed) folders.push(installed)
    for (const name of await files.list(common).catch(() => [] as string[])) if (isGameFolderName(name)) folders.push(name)
    folders.push('Escape from Tarkov')
    for (const folder of folders) for (const logs of gameLogFolders(join(common, folder), join)) addUnique(candidates, logs)
  }
  return candidates
}

/** The Logs folders Escape from Tarkov on Steam can write to, in every library of every Steam folder found. */
export async function steamLogFolderCandidates(roots: string[], files: SteamFiles = diskFiles): Promise<string[]> {
  return libraryLogFolders(await steamLibraries(roots, files), files)
}

/** Never looked through: Windows' own folders, the users' profiles, drivers' and hidden ones (no game is there). */
const NOT_SEARCHED = /^(\$.*|\..*|windows|windows\.old|system volume information|recovery|perflogs|programdata|config\.msi|msocache|documents and settings|users|boot|efi|intel|amd|nvidia|drivers|windowsapps|onedrivetemp|node_modules)$/i
/** Where games usually are: looked through first. */
const GAMES_FIRST = /steam|game|игр|battlestate/i

/**
 * Game folders and Steam libraries (folders with steamapps) in `roots` and up to `depth` levels below — folder names
 * only, nothing is read; for a game installed where no launcher setting, registry entry or Steam list points. Level by
 * level across all roots, the likely folders first, until `deadline`.
 */
export async function searchGameFolders(roots: string[], options: { files?: SteamFiles; deadline?: number; depth?: number; join?: Join } = {}) {
  const { files = diskFiles, deadline = Date.now() + 8_000, depth = 3, join = win32.join } = options
  const games: string[] = []
  const libraries: string[] = []
  let level = roots
  for (let current = 1; current <= depth && level.length; current += 1) {
    const next: string[] = []
    for (const folder of level) {
      if (Date.now() >= deadline) return { games, libraries }
      for (const name of await files.list(folder).catch(() => [] as string[])) {
        if (/^steamapps$/i.test(name)) addUnique(libraries, folder)
        else if (isGameFolderName(name)) addUnique(games, join(folder, name))
        else if (current < depth && !NOT_SEARCHED.test(name)) next.push(join(folder, name))
      }
    }
    level = [...next.filter((path) => GAMES_FIRST.test(lastPart(path))), ...next.filter((path) => !GAMES_FIRST.test(lastPart(path)))]
  }
  return { games, libraries }
}

/** The Logs folders of the game folders and Steam libraries found on the drives (searchGameFolders). */
export async function searchDrivesForLogFolders(drives = windowsDriveRoots(), files: SteamFiles = diskFiles, deadline = Date.now() + 8_000): Promise<string[]> {
  const { games, libraries } = await searchGameFolders(drives.map((drive) => `${drive}\\`), { files, deadline })
  const candidates: string[] = []
  for (const game of games) for (const folder of gameLogFolders(game)) addUnique(candidates, folder)
  for (const folder of await libraryLogFolders(libraries, files)) addUnique(candidates, folder)
  return candidates
}

interface Lookup {
  gamesRoot?: string
  /** Game folders from Windows' entries of the game. */
  registered: string[]
  /** Steam folders found (they have steamapps). */
  steamFolders: string[]
  libraries: string[]
  /** Every Logs folder to check, the most certain first. */
  candidates: string[]
}

/** The launcher's settings, Windows' entries, Steam and the usual folders: what to check, without the drives. */
async function lookUp(appDataDirectory: string): Promise<Lookup> {
  const settingsRaw = await readFile(join(appDataDirectory, 'Battlestate Games', 'BsgLauncher', 'settings'), 'utf8').catch(() => '')
  const gamesRoot = parseLauncherGamesRoot(settingsRaw)
  const windows = process.platform === 'win32'
  const [registered, roots] = windows ? await Promise.all([registeredGameFolders(), steamRoots()]) : [[], []]
  const libraries = windows ? await steamLibraries(roots) : []
  const candidates: string[] = []
  for (const folder of buildLogFolderCandidates(gamesRoot, [])) addUnique(candidates, folder)
  for (const game of registered) for (const folder of gameLogFolders(game)) addUnique(candidates, folder)
  for (const folder of windows ? await libraryLogFolders(libraries) : []) addUnique(candidates, folder)
  for (const folder of [...buildLogFolderCandidates(), ...buildUserLogFolderCandidates(appDataDirectory)]) addUnique(candidates, folder)
  const steamFolders = roots.map(cleanFolder).filter((root) => libraries.some((library) => library.toLowerCase() === root.toLowerCase()))
  return { gamesRoot, registered, steamFolders, libraries, candidates }
}

/** Looked up once a minute at most (reg.exe and the .vdf files). */
let lookupCache: { at: number; appData: string; lookup: Promise<Lookup> } | undefined
function cachedLookUp(appDataDirectory: string, fresh = false) {
  if (fresh || !lookupCache || lookupCache.appData !== appDataDirectory || Date.now() - lookupCache.at > 60_000) {
    lookupCache = { at: Date.now(), appData: appDataDirectory, lookup: lookUp(appDataDirectory).catch(() => ({ registered: [], steamFolders: [], libraries: [], candidates: [] })) }
  }
  return lookupCache.lookup
}

/** The drives are looked through at most every 10 minutes; only folders the game has started in count. */
let driveCache: { at: number; found: Promise<string[]> } | undefined
function cachedDriveSearch() {
  if (process.platform !== 'win32') return Promise.resolve([] as string[])
  if (!driveCache || Date.now() - driveCache.at > 10 * 60_000) {
    driveCache = { at: Date.now(), found: searchDrivesForLogFolders().then(async (folders) => {
      const started: string[] = []
      for (const folder of folders) if (await lastLaunch(folder) > 0) started.push(folder)
      return started
    }).catch(() => []) }
  }
  return driveCache.found
}

/** No game launch in any folder found for this long: a newer install may be elsewhere — the drives are looked through. */
const STALE_MS = 3 * 24 * 60 * 60_000

async function searchLogs(appDataDirectory: string, fresh = false) {
  const lookup = await cachedLookUp(appDataDirectory, fresh)
  const found: string[] = []
  for (const candidate of lookup.candidates) if (await isDirectory(candidate)) addUnique(found, candidate)
  let newest = 0
  for (const folder of found) newest = Math.max(newest, await lastLaunch(folder))
  const drivesSearched = process.platform === 'win32' && newest < Date.now() - STALE_MS
  if (drivesSearched) for (const folder of await cachedDriveSearch()) addUnique(found, folder)
  return { ...lookup, found, drivesSearched }
}

/** The Logs folder the game writes to (the freshest of all found), the game folder and the launcher's games folder. */
export async function discoverEftLogs(appDataDirectory: string): Promise<EftLogDiscovery> {
  const { found, gamesRoot } = await searchLogs(appDataDirectory)
  const logsFolder = await freshestLogsFolder(found)
  if (logsFolder) return { logsFolder, gameFolder: dirname(logsFolder), gamesRoot }
  const fallbackGameFolder = gamesRoot ? join(gamesRoot, 'Escape from Tarkov') : undefined
  return {
    gameFolder: fallbackGameFolder && await isDirectory(fallbackGameFolder) ? fallbackGameFolder : gamesRoot,
    gamesRoot,
  }
}

/** Every Logs folder that exists among the candidates (the launcher's games folder first), the drives' if needed. */
export async function discoverAllEftLogs(appDataDirectory: string): Promise<string[]> {
  return (await searchLogs(appDataDirectory)).found
}

/** «Где искали журналы» in the app (src/pages/ImportProgressPage.tsx): every place looked at, every Logs folder found. */
export interface EftLogSearchReport {
  launcherGamesRoot?: string
  registeredGameFolders: string[]
  steamFolders: string[]
  steamLibraries: string[]
  drivesSearched: boolean
  folders: Array<{ folder: string; launches: number; newest?: string }>
}

export async function eftLogSearchReport(appDataDirectory: string): Promise<EftLogSearchReport> {
  const result = await searchLogs(appDataDirectory, true)
  const folders: EftLogSearchReport['folders'] = []
  for (const folder of result.found) folders.push({ folder, ...await launches(folder) })
  return {
    ...(result.gamesRoot ? { launcherGamesRoot: result.gamesRoot } : {}),
    registeredGameFolders: result.registered,
    steamFolders: result.steamFolders,
    steamLibraries: result.libraries,
    drivesSearched: result.drivesSearched,
    folders,
  }
}

/** How many game launches (log_… folders) a Logs folder has, and the newest one. */
async function launches(folder: string) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
  const names = entries.filter((entry) => entry.isDirectory() && /^log_/i.test(entry.name)).map((entry) => entry.name)
  const newest = names.sort((a, b) => launchTime(b) - launchTime(a) || b.localeCompare(a))[0]
  return { launches: names.length, ...(newest ? { newest } : {}) }
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

/**
 * The picked folder → its Logs folder: the folder itself; the Logs folder of a game launch folder (log_…); the folder's
 * Logs or build\Logs (the Steam game folder); else the game's Logs found below it — a Steam library, its
 * steamapps\common, Steam's own folder, a drive (owner, 13.10.2026). Otherwise the picked folder as it is.
 */
export async function normalizeSelectedLogsFolder(selectedFolder: string, files: SteamFiles = diskFiles) {
  if (basename(selectedFolder).toLowerCase() === 'logs') return selectedFolder
  const parent = dirname(selectedFolder)
  if (/^log_/i.test(basename(selectedFolder)) && basename(parent).toLowerCase() === 'logs') return parent
  const direct: string[] = []
  for (const child of [join(selectedFolder, 'Logs'), join(selectedFolder, 'build', 'Logs')]) if (await isDirectory(child)) direct.push(child)
  if (direct.length) return (await freshestLogsFolder(direct))!
  const { games, libraries } = await searchGameFolders([selectedFolder], { files, deadline: Date.now() + 5_000, depth: 4, join })
  const found: string[] = []
  for (const game of games) for (const folder of gameLogFolders(game, join)) if (await isDirectory(folder)) addUnique(found, folder)
  for (const folder of await libraryLogFolders(libraries, files, join)) if (await isDirectory(folder)) addUnique(found, folder)
  return await freshestLogsFolder(found) ?? selectedFolder
}

async function isDirectory(path: string) {
  const info = await stat(path).catch(() => null)
  return Boolean(info?.isDirectory())
}

function windowsDriveRoots() {
  return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:`)
}
