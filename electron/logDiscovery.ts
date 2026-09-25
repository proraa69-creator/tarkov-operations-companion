import { readFile, stat } from 'node:fs/promises'
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
    ]) add(win32.join(`${drive}\\`, ...relative))
  }

  return candidates
}

export async function discoverEftLogs(appDataDirectory: string): Promise<EftLogDiscovery> {
  const launcherSettings = join(appDataDirectory, 'Battlestate Games', 'BsgLauncher', 'settings')
  const settingsRaw = await readFile(launcherSettings, 'utf8').catch(() => '')
  const gamesRoot = parseLauncherGamesRoot(settingsRaw)

  for (const candidate of buildLogFolderCandidates(gamesRoot)) {
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
