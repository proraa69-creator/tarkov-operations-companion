import type { RaidMode, TaskProgressRecord } from '../domain/types.js'

export interface ParsedTaskEvent {
  taskId: string
  status: 'active' | 'failed' | 'completed'
  timestamp: string
  mode?: RaidMode
  accountId?: number
  profileId?: string
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

export function parseEftLog(text: string, preserveHistory = false): LogParseResult {
  const detectedModes = detectModes(text)
  const accountIds = detectAccountIds(text)
  const profileIds = detectProfileIds(text)
  const fallbackMode = detectedModes.length === 1 ? detectedModes[0] : undefined
  const events: ParsedTaskEvent[] = []
  let ignoredRecords = 0

  for (const candidate of extractJsonObjects(text)) {
    try {
      const payload = JSON.parse(candidate.json) as Record<string, unknown>
      const event = readQuestNotification(payload)
      if (!event) continue
      events.push({ ...event, timestamp: extractTimestamp(candidate.prefix, payload), mode: fallbackMode })
    } catch {
      ignoredRecords += 1
    }
  }

  const regexPatterns = [
    /"type"\s*:\s*"?(10|11|12)"?[\s\S]{0,280}?"templateId"\s*:\s*"([a-f0-9]{24})[^"]*"/gi,
    /"templateId"\s*:\s*"([a-f0-9]{24})[^"]*"[\s\S]{0,280}?"type"\s*:\s*"?(10|11|12)"?/gi,
    /"tid"\s*:\s*"([a-f0-9]{24})"[\s\S]{0,200}?"type"\s*:\s*"?(10|11|12)"?/gi,
  ]
  for (const pattern of regexPatterns) {
    for (const match of text.matchAll(pattern)) {
      const typeValue = match[1].length === 24 ? match[2] : match[1]
      const taskId = match[1].length === 24 ? match[1] : match[2]
      const status = STATUS_BY_TYPE.get(Number(typeValue))
      if (!status || !taskId) continue
      if (events.some((event) => event.taskId === taskId && event.status === status)) continue
      const preceding = text.slice(Math.max(0, (match.index ?? 0) - 120), match.index)
      const stamp = preceding.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?/)?.[0]
      events.push({ taskId, status, timestamp: stamp ? new Date(stamp.replace(' ', 'T')).toISOString() : new Date(0).toISOString(), mode: fallbackMode })
    }
  }

  return { events: preserveHistory ? events : reduceEvents(events), detectedModes, accountIds, profileIds, ignoredRecords }
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
        const preceding = text.slice(Math.max(0, start - 1000), start)
        const header = [...preceding.matchAll(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?/g)].at(-1)
        const prefixStart = header ? Math.max(0, start - 1000) + header.index! : Math.max(0, text.lastIndexOf('\n', start - 1) + 1)
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
    const key = `${event.mode ?? '?'}:${event.accountId ?? '?'}:${event.profileId ?? '?'}:${event.taskId}`
    const current = byTask.get(key)
    if (!current || event.timestamp > current.timestamp || (event.timestamp === current.timestamp && priority[event.status] > priority[current.status])) {
      byTask.set(key, event)
    }
  }
  return [...byTask.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function readQuestNotification(payload: Record<string, unknown>): Pick<ParsedTaskEvent, 'taskId' | 'status'> | undefined {
  const sources = [isRecord(payload.message) ? payload.message : undefined, payload].filter((entry): entry is Record<string, unknown> => Boolean(entry))
  for (const source of sources) {
    const type = typeof source.type === 'number' ? source.type : Number(source.type)
    const status = STATUS_BY_TYPE.get(type)
    const templateId = typeof source.templateId === 'string'
      ? source.templateId
      : typeof source.tid === 'string'
        ? source.tid
        : ''
    const taskId = templateId.split(/\s+/)[0]
    if (status && /^[a-f0-9]{24}$/i.test(taskId)) return { taskId, status }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
