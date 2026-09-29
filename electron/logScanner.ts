import { open, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { buildScanResult, readLogSignals, type LogSignal, type ModeLogScanResult } from '../src/import/eftLogTimeline.js'
import { raidStateFromLogs, type RaidState } from '../src/import/raidState.js'
import { parseScreenshotBinding } from '../src/overlay/gameKeys.js'

export type { ModeLogScanResult, RaidState }

/** Only these logs carry mode, profile and quest notifications; output/errors are huge and irrelevant. */
const RELEVANT_LOG = /(application|backend|notifications)[^\\/]*\.log$/i
const MAX_FILE_BYTES = 60 * 1024 * 1024
const signalCache = new Map<string, { mtimeMs: number; size: number; signals: LogSignal[] }>()

export async function scanLogFolderBySession(root: string): Promise<ModeLogScanResult> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const sessionFolders = entries.filter((entry) => entry.isDirectory() && /^log_/i.test(entry.name)).map((entry) => join(root, entry.name))
  const folders = sessionFolders.length ? sessionFolders : [root]
  const signals: LogSignal[] = []
  let ignoredRecords = 0
  for (const folder of folders) {
    for (const file of await relevantLogs(folder)) {
      const result = await fileSignals(file)
      if (result) signals.push(...result)
      else ignoredRecords += 1
    }
  }
  return buildScanResult(signals, folders.length, ignoredRecords)
}

/** Raid state of the newest game launch — only its application and notification logs are read. */
export async function readRaidState(root: string): Promise<RaidState> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const latest = entries
    .filter((entry) => entry.isDirectory() && /^log_/i.test(entry.name))
    .map((entry) => ({ name: entry.name, key: launchKey(entry.name) }))
    .sort((a, b) => b.key - a.key)[0]
  const folder = latest ? join(root, latest.name) : root
  const files = (await relevantLogs(folder)).filter((file) => /(application|notifications)[^\\/]*\.log$/i.test(file))
  const texts = await Promise.all(files.map((file) => readFile(file, 'utf8').catch(() => '')))
  return raidStateFromLogs(texts)
}

/**
 * The game's screenshot key from the control settings EFT logs when it starts, from the newest of the last
 * few launches that logged them: [] = not bound, null = not found.
 */
export async function readScreenshotBinding(root: string): Promise<string[] | null> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const launches = entries
    .filter((entry) => entry.isDirectory() && /^log_/i.test(entry.name))
    .map((entry) => ({ name: entry.name, key: launchKey(entry.name) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, 3)
    .map((entry) => join(root, entry.name))
  for (const folder of launches.length ? launches : [root]) {
    const files = (await relevantLogs(folder)).filter((file) => /application[^\\/]*\.log$/i.test(file)).sort()
    let keys: string[] | null = null
    for (const file of files) keys = await fileBinding(file) ?? keys
    if (keys) return keys
  }
  return null
}

const BINDING_CHUNK = 4 * 1024 * 1024
/** Chunks overlap so a binding cut in half by a chunk edge is still read whole. */
const BINDING_OVERLAP = 8 * 1024
const bindingCache = new Map<string, { size: number; keys: string[] | null }>()

/** A running game keeps appending to its log: only the new part is read, in chunks. */
async function fileBinding(file: string) {
  const info = await stat(file).catch(() => null)
  if (!info) return null
  const cached = bindingCache.get(file)
  if (cached && cached.size === info.size) return cached.keys
  const from = cached && info.size > cached.size ? Math.max(0, cached.size - BINDING_OVERLAP) : 0
  let keys = cached && from > 0 ? cached.keys : null
  const handle = await open(file, 'r').catch(() => null)
  if (!handle) return keys
  try {
    const buffer = Buffer.alloc(BINDING_CHUNK)
    for (let position = from; position < info.size;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(BINDING_CHUNK, info.size - position), position)
      if (!bytesRead) break
      keys = parseScreenshotBinding(buffer.toString('utf8', 0, bytesRead)) ?? keys
      if (position + bytesRead >= info.size) break
      position += Math.max(1, bytesRead - BINDING_OVERLAP)
    }
  } catch {
    return keys
  } finally {
    await handle.close().catch(() => {})
  }
  bindingCache.set(file, { size: info.size, keys })
  return keys
}

/** «log_2026.09.27_2-33-45_1.1.5.1» → sortable launch time (the hour is not zero-padded). */
function launchKey(name: string) {
  const match = /^log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{2})-(\d{2})/i.exec(name)
  if (!match) return 0
  const [, year, month, day, hour, minute, second] = match.map(Number)
  return Date.UTC(year!, month! - 1, day!, hour!, minute!, second!)
}

async function fileSignals(file: string) {
  const info = await stat(file).catch(() => null)
  if (!info || info.size > MAX_FILE_BYTES) return undefined
  const cached = signalCache.get(file)
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.signals
  try {
    const signals = readLogSignals(await readFile(file, 'utf8'))
    signalCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, signals })
    return signals
  } catch {
    return undefined
  }
}

async function relevantLogs(root: string, depth = 0): Promise<string[]> {
  if (depth > 2) return []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await relevantLogs(path, depth + 1))
    else if (entry.isFile() && RELEVANT_LOG.test(entry.name)) files.push(path)
  }
  return files
}
