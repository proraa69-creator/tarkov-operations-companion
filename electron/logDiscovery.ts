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

export async function discoverEftLogs(appDataDirectory: string): Promise<EftLogDiscovery> {
  const launcherSettings = join(appDataDirectory, 'Battlestate Games', 'BsgLauncher', 'settings')
  const settingsRaw = await readFile(launcherSettings, 'utf8').catch(() => '')
  const gamesRoot = parseLauncherGamesRoot(settingsRaw)

  for (const candidate of [...buildLogFolderCandidates(gamesRoot), ...buildUserLogFolderCandidates(appDataDirectory)]) {
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
  for (const candidate of [...buildLogFolderCandidates(parseLauncherGamesRoot(settingsRaw)), ...buildUserLogFolderCandidates(appDataDirectory)]) {
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

export async function normalizeSelectedLogsFolder(selectedFolder: string) {
  if (basename(selectedFolder).toLowerCase() === 'logs') return selectedFolder
  const childLogs = join(selectedFolder, 'Logs')
  return await isDirectory(childLogs) ? childLogs : selectedFolder
}

async function isDirectory(path: string) {
  const info = await stat(path).catch(() => null)
  return Boolean(info?.isDirectory())
}

function windowsDriveRoots() {
  return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:`)
}
