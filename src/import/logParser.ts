import type { RaidMode, TaskProgressRecord } from '../domain/types.js'

export interface ParsedTaskEvent {
  taskId: string
  status: 'active' | 'failed' | 'completed'
  timestamp: string
  mode?: RaidMode
}

export interface LogParseResult {
  events: ParsedTaskEvent[]
  detectedModes: RaidMode[]
  accountIds: number[]
  profileIds: string[]
  ignoredRecords: number
}

const STATUS_BY_TYPE = new Map<number, ParsedTaskEvent['status']>([
  [10, 'active'],
  [11, 'failed'],
  [12, 'completed'],
])

export function parseEftLog(text: string): LogParseResult {
  const detectedModes = detectModes(text)
  const accountIds = detectAccountIds(text)
  const profileIds = detectProfileIds(text)
  const fallbackMode = detectedModes.length === 1 ? detectedModes[0] : undefined
  const events: ParsedTaskEvent[] = []
  let ignoredRecords = 0

  for (const candidate of extractJsonObjects(text)) {
    try {
      const payload = JSON.parse(candidate.json) as Record<string, unknown>
      const message = isRecord(payload.message) ? payload.message : null
      if (!message) continue
      const type = typeof message.type === 'number' ? message.type : Number(message.type)
      const status = STATUS_BY_TYPE.get(type)
      const templateId = typeof message.templateId === 'string' ? message.templateId : ''
      const taskId = templateId.split(/\s+/)[0]
      if (!status || !/^[a-f0-9]{24}$/i.test(taskId)) continue
      events.push({ taskId, status, timestamp: extractTimestamp(candidate.prefix, payload), mode: fallbackMode })
    } catch {
      ignoredRecords += 1
    }
  }

  return { events: reduceEvents(events), detectedModes, accountIds, profileIds, ignoredRecords }
}

export function eventsToProgressRecords(events: ParsedTaskEvent[]): TaskProgressRecord[] {
  return events.map((event) => ({
    taskId: event.taskId,
    status: event.status,
    source: 'eft-log',
    updatedAt: event.timestamp,
  }))
}

export function mergeParseResults(results: LogParseResult[]): LogParseResult {
  return {
    events: reduceEvents(results.flatMap((result) => result.events)),
    detectedModes: [...new Set(results.flatMap((result) => result.detectedModes))],
    accountIds: [...new Set(results.flatMap((result) => result.accountIds))],
    profileIds: [...new Set(results.flatMap((result) => result.profileIds))],
    ignoredRecords: results.reduce((sum, result) => sum + result.ignoredRecords, 0),
  }
}

function detectModes(text: string): RaidMode[] {
  const modes = new Set<RaidMode>()
  for (const match of text.matchAll(/Session mode:\s*(PvPSeason|Seasonal|Pve|Pvp|Regular)|"sessionMode"\s*:\s*"(PvPSeason|Seasonal|PVE|PVP|Regular)"/gi)) {
    const value = (match[1] ?? match[2] ?? '').toLowerCase()
    if (value === 'pve') modes.add('pve')
    if (value === 'pvp' || value === 'regular') modes.add('pvp')
    if (value === 'pvpseason' || value === 'seasonal') modes.add('seasonal')
  }
  return [...modes]
}

function detectAccountIds(text: string) {
  return [...new Set([...text.matchAll(/CompleteSelectedProfile[^\r\n]*AccountId:(\d+)/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isSafeInteger(value) && value > 0))]
}

function detectProfileIds(text: string) {
  return [...new Set([...text.matchAll(/CompleteSelectedProfile[^\r\n]*ProfileId:([a-f0-9]{24})/gi)].map((match) => match[1]))]
}

function extractJsonObjects(text: string) {
  const records: Array<{ json: string; prefix: string }> = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (start >= 0 && inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (start >= 0 && char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        const prefixStart = Math.max(0, text.lastIndexOf('\n', start - 1) + 1)
        records.push({ json: text.slice(start, index + 1), prefix: text.slice(prefixStart, start) })
        start = -1
      }
    }
  }
  return records
}

function extractTimestamp(prefix: string, payload: Record<string, unknown>) {
  const raw = typeof payload.time === 'string' ? payload.time : prefix.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?/)?.[0]
  if (raw) {
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'))
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return new Date(0).toISOString()
}

function reduceEvents(events: ParsedTaskEvent[]) {
  const priority = { active: 1, failed: 2, completed: 3 }
  const byTask = new Map<string, ParsedTaskEvent>()
  for (const event of events) {
    const current = byTask.get(event.taskId)
    if (!current || event.timestamp > current.timestamp || (event.timestamp === current.timestamp && priority[event.status] > priority[current.status])) {
      byTask.set(event.taskId, event)
    }
  }
  return [...byTask.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
