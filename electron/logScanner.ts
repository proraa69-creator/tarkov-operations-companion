import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { mergeParseResults, parseEftLog, type LogParseResult, type ParsedTaskEvent } from '../src/import/logParser.js'
import type { RaidMode } from '../src/domain/types.js'

export interface LogSessionResult extends LogParseResult {
  id: string
  folder: string
  modifiedAt: string
  mode?: RaidMode
  accountId?: number
}

export interface ModeLogScanResult extends LogParseResult {
  sessions: LogSessionResult[]
  eventsByMode: Record<RaidMode, ParsedTaskEvent[]>
  unresolvedEvents: ParsedTaskEvent[]
  latestMode?: RaidMode
  latestAccountIdByMode: Partial<Record<RaidMode, number>>
}

export async function scanLogFolderBySession(root: string): Promise<ModeLogScanResult> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const sessionFolders = entries.filter((entry) => entry.isDirectory() && /^log_/i.test(entry.name))
  const folders = sessionFolders.length ? sessionFolders.map((entry) => join(root, entry.name)) : [root]
  const sessions = (await Promise.all(folders.map(scanSessionFolder)))
    .filter((session) => session.events.length || session.detectedModes.length || session.accountIds.length)
    .sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt))

  const eventsByMode: Record<RaidMode, ParsedTaskEvent[]> = { pvp: [], pve: [], seasonal: [] }
  const unresolvedEvents: ParsedTaskEvent[] = []
  const latestAccountIdByMode: Partial<Record<RaidMode, number>> = {}
  for (const session of sessions) {
    if (session.mode && session.accountId) latestAccountIdByMode[session.mode] = session.accountId
    for (const event of session.events) {
      const mode = event.mode ?? session.mode
      if (mode) eventsByMode[mode].push({ ...event, mode })
      else unresolvedEvents.push(event)
    }
  }
  for (const mode of Object.keys(eventsByMode) as RaidMode[]) eventsByMode[mode] = reduceModeEvents(eventsByMode[mode])
  const latestMode = [...sessions].reverse().find((session) => session.mode)?.mode
  const merged = mergeParseResults(sessions)
  return {
    ...merged,
    events: [...eventsByMode.pvp, ...eventsByMode.pve, ...eventsByMode.seasonal, ...unresolvedEvents],
    sessions,
    eventsByMode,
    unresolvedEvents,
    latestMode,
    latestAccountIdByMode,
  }
}

async function scanSessionFolder(folder: string): Promise<LogSessionResult> {
  const files = await collectSupportedLogs(folder)
  const parsed: LogParseResult[] = []
  let modified = 0
  for (const file of files) {
    const info = await stat(file).catch(() => null)
    modified = Math.max(modified, info?.mtimeMs ?? 0)
    try {
      parsed.push(parseEftLog(await readFile(file, 'utf8')))
    } catch {
      parsed.push({ events: [], detectedModes: [], accountIds: [], profileIds: [], ignoredRecords: 1 })
    }
  }
  const merged = mergeParseResults(parsed)
  const mode = merged.detectedModes.length === 1 ? merged.detectedModes[0] : undefined
  const accountId = merged.accountIds.at(-1)
  return {
    ...merged,
    events: merged.events.map((event) => event.mode || !mode ? event : { ...event, mode }),
    id: folder.split(/[\\/]/).at(-1) ?? folder,
    folder,
    modifiedAt: new Date(modified || 0).toISOString(),
    mode,
    accountId,
  }
}

async function collectSupportedLogs(root: string, depth = 0): Promise<string[]> {
  if (depth > 2) return []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await collectSupportedLogs(path, depth + 1))
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.log' && /(?:notifications|push-notifications|application|output[_-]?\d*).*\.log$/i.test(entry.name)) files.push(path)
  }
  return files
}

function reduceModeEvents(events: ParsedTaskEvent[]) {
  const priority = { active: 1, failed: 2, completed: 3 }
  const byTask = new Map<string, ParsedTaskEvent>()
  for (const event of events) {
    const current = byTask.get(event.taskId)
    if (!current || event.timestamp > current.timestamp || (event.timestamp === current.timestamp && priority[event.status] > priority[current.status])) byTask.set(event.taskId, event)
  }
  return [...byTask.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}
