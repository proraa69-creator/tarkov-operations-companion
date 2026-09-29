import type { RaidMode } from '../domain/types.js'
import type { ParsedTaskEvent } from './logParser.js'

/**
 * EFT writes one folder per game launch. Quest progress is only visible as chat notifications
 * (type 10 = accepted, 11 = failed, 12 = handed in) in push-notifications_*.log; the mode they
 * belong to comes from «Session mode: …» (application log), the gateway host of backend requests
 * (gw-pvp / gw-pve / gw-pvp-season) and the selected profile id, which differs per mode.
 */
export type LogSignal =
  | { kind: 'mode'; at: number; mode: RaidMode }
  | { kind: 'profile'; at: number; profileId: string; accountId: number }
  | { kind: 'quest'; at: number; taskId: string; status: ParsedTaskEvent['status'] }

export interface ModeLogSummary {
  profileId?: string
  accountId?: number
  /** Latest profile reset (quests handed in before were accepted again). Earlier events are ignored. */
  resetAt?: string
  lastActivityAt?: string
  /** Every quest event since the last reset, oldest first. */
  history: ParsedTaskEvent[]
  /** Latest status of every quest since the last reset. */
  quests: ParsedTaskEvent[]
}

export interface LogTimelineSummary {
  modes: Record<RaidMode, ModeLogSummary>
  latestMode?: RaidMode
  unresolvedEvents: number
}

/** What the desktop scanner sends to the UI: latest quest status per mode, never mixed. */
export interface ModeLogScanResult {
  events: ParsedTaskEvent[]
  detectedModes: RaidMode[]
  accountIds: number[]
  profileIds: string[]
  ignoredRecords: number
  eventsByMode: Record<RaidMode, ParsedTaskEvent[]>
  summaryByMode: Record<RaidMode, Omit<ModeLogSummary, 'history' | 'quests'> & { questCount: number }>
  unresolvedEvents: number
  sessionCount: number
  latestMode?: RaidMode
  latestAccountIdByMode: Partial<Record<RaidMode, number>>
  latestCharacterIdByMode: Partial<Record<RaidMode, string>>
}

export function buildScanResult(signals: LogSignal[], sessionCount: number, ignoredRecords = 0): ModeLogScanResult {
  const summary = summarizeLogSignals(signals)
  const modesList: RaidMode[] = ['pvp', 'pve', 'seasonal']
  const eventsByMode = { pvp: summary.modes.pvp.quests, pve: summary.modes.pve.quests, seasonal: summary.modes.seasonal.quests }
  const latestAccountIdByMode: Partial<Record<RaidMode, number>> = {}
  const latestCharacterIdByMode: Partial<Record<RaidMode, string>> = {}
  const summaryByMode = {} as ModeLogScanResult['summaryByMode']
  for (const mode of modesList) {
    const { profileId, accountId, resetAt, lastActivityAt, quests } = summary.modes[mode]
    summaryByMode[mode] = { profileId, accountId, resetAt, lastActivityAt, questCount: quests.length }
    if (accountId) latestAccountIdByMode[mode] = accountId
    if (profileId) latestCharacterIdByMode[mode] = profileId
  }
  return {
    events: [...eventsByMode.pvp, ...eventsByMode.pve, ...eventsByMode.seasonal],
    detectedModes: modesList.filter((mode) => summary.modes[mode].lastActivityAt),
    accountIds: [...new Set(Object.values(latestAccountIdByMode))],
    profileIds: [...new Set(Object.values(latestCharacterIdByMode))],
    ignoredRecords,
    eventsByMode,
    summaryByMode,
    unresolvedEvents: summary.unresolvedEvents,
    sessionCount,
    latestMode: summary.latestMode,
    latestAccountIdByMode,
    latestCharacterIdByMode,
  }
}

const STATUS_BY_TYPE: Record<number, ParsedTaskEvent['status']> = { 10: 'active', 11: 'failed', 12: 'completed' }
const LINE_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:\s*([+-]\d{2}:?\d{2}|Z))?(?:\s*\||\s)/
const SESSION_MODE = /Session mode:\s*(PvpSeason|Seasonal|Pve|Pvp|Regular)\b/i
const PROFILE_LINE = /(?:Select(?:ed)?Profile|PrepareSelectedProfileLocally) ProfileId:([a-f0-9]{24}) AccountId:(\d+)/i
const GATEWAY = /https?:\/\/gw-(pvp-season|pve|pvp)\./i
const QUEST_TYPE_ORDER = { active: 1, failed: 2, completed: 3 } as const
const KIND_ORDER = { mode: 0, profile: 1, quest: 2 } as const

export function parseLogTime(line: string): number | undefined {
  const match = line.match(LINE_TIME)
  if (!match) return undefined
  const offset = match[3] ? (match[3] === 'Z' ? 'Z' : match[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : ''
  const value = Date.parse(`${match[1]}T${match[2]}${offset}`)
  return Number.isNaN(value) ? undefined : value
}

export function modeFromSessionValue(value: string): RaidMode {
  const key = value.toLowerCase()
  if (key === 'pve') return 'pve'
  if (key === 'pvpseason' || key === 'seasonal') return 'seasonal'
  return 'pvp'
}

function modeFromGateway(value: string): RaidMode {
  const key = value.toLowerCase()
  return key === 'pve' ? 'pve' : key === 'pvp-season' ? 'seasonal' : 'pvp'
}

/** Reads the signals of one log file (any of application / backend / push-notifications). */
export function readLogSignals(text: string): LogSignal[] {
  return readLogSignalsFrom(text).signals
}

/**
 * The same for a log read piece by piece (the desktop app follows the growing logs of a running game): a piece
 * must end where a timestamped line starts, `gatewayMode` is what the previous piece returned. Reading all pieces
 * one after another gives exactly the signals of reading the whole text at once.
 */
export function readLogSignalsFrom(text: string, gatewayMode?: RaidMode): { signals: LogSignal[]; gatewayMode?: RaidMode } {
  const signals: LogSignal[] = []
  const lines = text.split(/\r?\n/)
  let lastGatewayMode = gatewayMode
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const at = parseLogTime(line)
    if (at === undefined) continue

    const session = line.match(SESSION_MODE)
    if (session) {
      signals.push({ kind: 'mode', at, mode: modeFromSessionValue(session[1]!) })
      continue
    }
    const profile = line.match(PROFILE_LINE)
    if (profile) {
      signals.push({ kind: 'profile', at, profileId: profile[1]!, accountId: Number(profile[2]) })
      continue
    }
    const gateway = line.match(GATEWAY)
    if (gateway) {
      const mode = modeFromGateway(gateway[1]!)
      if (mode !== lastGatewayMode) signals.push({ kind: 'mode', at, mode })
      lastGatewayMode = mode
      continue
    }
    if (/Got notification \| ChatMessageReceived/.test(line)) {
      const block: string[] = []
      for (let next = index + 1; next < lines.length && parseLogTime(lines[next]!) === undefined; next += 1) block.push(lines[next]!)
      const quest = readQuestMessage(block.join('\n'))
      if (quest) signals.push({ kind: 'quest', at, ...quest })
    }
  }
  return { signals, gatewayMode: lastGatewayMode }
}

function readQuestMessage(json: string): { taskId: string; status: ParsedTaskEvent['status'] } | undefined {
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    const type = json.match(/"type"\s*:\s*(1[012])\b/)?.[1]
    const template = json.match(/"templateId"\s*:\s*"([a-f0-9]{24})/i)?.[1]
    return type && template ? { taskId: template, status: STATUS_BY_TYPE[Number(type)]! } : undefined
  }
  const message = isRecord(payload) && isRecord(payload.message) ? payload.message : undefined
  if (!message) return undefined
  const status = STATUS_BY_TYPE[Number(message.type)]
  const taskId = typeof message.templateId === 'string' ? message.templateId.split(/\s+/)[0] ?? '' : ''
  return status && /^[a-f0-9]{24}$/i.test(taskId) ? { taskId, status } : undefined
}

function emptySummary(): ModeLogSummary {
  return { history: [], quests: [] }
}

export function summarizeLogSignals(signals: LogSignal[]): LogTimelineSummary {
  const ordered = [...signals].sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  const modeOfProfile = new Map<string, RaidMode>()
  const profileOfMode: Partial<Record<RaidMode, { profileId: string; accountId: number }>> = {}
  const profileTimes: Record<RaidMode, number[]> = { pvp: [], pve: [], seasonal: [] }
  const raw: Record<RaidMode, ParsedTaskEvent[]> = { pvp: [], pve: [], seasonal: [] }
  const lastActivity: Partial<Record<RaidMode, number>> = {}
  let mode: RaidMode | undefined
  let unresolvedEvents = 0

  for (const signal of ordered) {
    if (signal.kind === 'mode') {
      mode = signal.mode
      lastActivity[mode] = signal.at
      continue
    }
    if (signal.kind === 'profile') {
      // Each mode has its own profile id, so a known id also pins the mode.
      const known = modeOfProfile.get(signal.profileId)
      if (known) mode = known
      if (!mode) continue
      if (!known) modeOfProfile.set(signal.profileId, mode)
      profileOfMode[mode] = { profileId: signal.profileId, accountId: signal.accountId }
      profileTimes[mode].push(signal.at)
      lastActivity[mode] = signal.at
      continue
    }
    if (!mode) {
      unresolvedEvents += 1
      continue
    }
    const identity = profileOfMode[mode]
    raw[mode].push({
      taskId: signal.taskId,
      status: signal.status,
      timestamp: new Date(signal.at).toISOString(),
      mode,
      accountId: identity?.accountId,
      profileId: identity?.profileId,
    })
    lastActivity[mode] = signal.at
  }

  const modes = { pvp: emptySummary(), pve: emptySummary(), seasonal: emptySummary() }
  for (const key of Object.keys(modes) as RaidMode[]) {
    const identity = profileOfMode[key]
    const events = identity ? raw[key].filter((event) => !event.profileId || event.profileId === identity.profileId) : raw[key]
    const { history, resetAt } = dropBeforeReset(events, profileTimes[key])
    modes[key] = {
      profileId: identity?.profileId,
      accountId: identity?.accountId,
      resetAt: resetAt === undefined ? undefined : new Date(resetAt).toISOString(),
      lastActivityAt: lastActivity[key] === undefined ? undefined : new Date(lastActivity[key]!).toISOString(),
      history,
      quests: latestPerTask(history),
    }
  }
  return { modes, latestMode: mode, unresolvedEvents }
}

/**
 * A quest that was handed in cannot be accepted again, so «accepted after handed in» means the
 * profile was reset. Everything before the profile load that preceded it belongs to the old profile.
 */
function dropBeforeReset(events: ParsedTaskEvent[], profileTimes: number[]) {
  let kept: ParsedTaskEvent[] = []
  let resetAt: number | undefined
  for (const event of events) {
    const at = Date.parse(event.timestamp)
    if (event.status === 'active' && kept.some((entry) => entry.taskId === event.taskId && entry.status === 'completed')) {
      const boundary = [...profileTimes].reverse().find((time) => time <= at) ?? at
      kept = kept.filter((entry) => Date.parse(entry.timestamp) >= boundary)
      if (kept.some((entry) => entry.taskId === event.taskId && entry.status === 'completed')) {
        kept = []
        resetAt = at
      } else resetAt = boundary
    }
    kept.push(event)
  }
  return { history: kept, resetAt }
}

function latestPerTask(events: ParsedTaskEvent[]) {
  const byTask = new Map<string, ParsedTaskEvent>()
  for (const event of events) {
    const current = byTask.get(event.taskId)
    if (!current || event.timestamp > current.timestamp || (event.timestamp === current.timestamp && QUEST_TYPE_ORDER[event.status] > QUEST_TYPE_ORDER[current.status])) {
      byTask.set(event.taskId, event)
    }
  }
  return [...byTask.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
