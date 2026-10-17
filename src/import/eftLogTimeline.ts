import type { RaidMode } from '../domain/types.js'
import type { ParsedTaskEvent } from './logParser.js'

/**
 * EFT writes one folder per game launch. Quest progress is only visible as chat notifications
 * (type 10 = accepted, 11 = failed, 12 = handed in) in push-notifications_*.log; the mode they
 * belong to comes from «Session mode: …» (application log), the gateway host of backend requests
 * (gw-pvp / gw-pve / gw-pvp-season) and the selected profile id, which differs per mode.
 */
export type LogSignal =
  /** `via: 'gateway'`: told by the host of a backend request, not by a «Session mode» line (see explicitModesWin). */
  | { kind: 'mode'; at: number; mode: RaidMode; via?: 'gateway' }
  | { kind: 'profile'; at: number; profileId: string; accountId: number }
  | { kind: 'quest'; at: number; taskId: string; status: ParsedTaskEvent['status'] }
  /**
   * The game's own reset of a profile, as its backend request names it: `prestige` — «/client/prestige/obtain» (the
   * prestige taken), `profile-create` — «/client/game/profile/create» (a new character after a wipe or a profile reset).
   * `mode` from the request's gateway host when it names one.
   */
  | { kind: 'reset'; at: number; via: 'prestige' | 'profile-create'; mode?: RaidMode }

export interface ModeLogSummary {
  profileId?: string
  accountId?: number
  /**
   * Latest profile reset: a catalog trader quest handed in before was accepted again (see dropBeforeReset). Earlier
   * events are ignored, and the server deletes this character's older events (server/src/services/progressStore.ts).
   */
  resetAt?: string
  /** What proved that reset: a catalog quest accepted again after its hand-in, or the game's prestige / new-profile request. */
  resetVia?: 'quest' | 'prestige' | 'profile-create'
  /**
   * Since when the logs show this profile in this mode: its first profile load after another profile's (a new character
   * after a wipe, or the other game account of a shared PC), else its first one. Records of the mode older than this
   * belong to the character before (src/import/logApply.ts logEpochChange).
   */
  profileSince?: string
  /**
   * The mode's quest history starts inside the logs on disk: its profile first appears after the oldest game launch that
   * logged anything (the profile started within the logs' coverage), or a trusted reset happened inside them. With the
   * content check of src/import/logCoverage.ts it tells that the logs hold the mode's whole quest history.
   */
  historyStartsInLogs?: boolean
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
  /**
   * Per mode, every quest whose acceptance (notification type 10) the logs hold since the last reset. With
   * `eventsByMode` (each quest's latest status) it tells whether the logs reach back to the profile's start
   * (src/import/logCoverage.ts). Missing from an older app: then they never do.
   */
  acceptedByMode?: Record<RaidMode, string[]>
  /**
   * Only who plays and where, from the newest launches' application logs (electron/logScanner.ts scanLogIdentity): the
   * first thing the app learns at a start, within seconds. No quest events: nothing to apply or push, the full scan follows.
   */
  identityOnly?: boolean
  /** A short hash of everything the app applies from this scan (logScanSignature): an equal one changes nothing. */
  signature?: string
}

/** What the summary needs besides the signals. */
export interface LogSummaryOptions {
  /**
   * Per mode, the catalog's trader quest ids (traderQuestIdsForResets): only an id of these accepted again after its
   * hand-in reveals a profile reset. Without a mode's ids no reset is detected in that mode — nothing is dropped.
   */
  trustedQuestIds?: Partial<Record<RaidMode, ReadonlySet<string>>>
  /** The time of the last signal of the oldest game launch on disk that logged any (historyStartsInLogs). */
  oldestLaunchUntil?: number
}

export function buildScanResult(signals: LogSignal[], sessionCount: number, ignoredRecords = 0, options: LogSummaryOptions = {}): ModeLogScanResult {
  const summary = summarizeLogSignals(signals, options)
  const modesList: RaidMode[] = ['pvp', 'pve', 'seasonal']
  const eventsByMode = { pvp: summary.modes.pvp.quests, pve: summary.modes.pve.quests, seasonal: summary.modes.seasonal.quests }
  const latestAccountIdByMode: Partial<Record<RaidMode, number>> = {}
  const latestCharacterIdByMode: Partial<Record<RaidMode, string>> = {}
  const summaryByMode = {} as ModeLogScanResult['summaryByMode']
  const acceptedByMode = {} as Record<RaidMode, string[]>
  for (const mode of modesList) {
    acceptedByMode[mode] = [...new Set(summary.modes[mode].history.filter((event) => event.status === 'active').map((event) => event.taskId))]
    const { profileId, accountId, resetAt, resetVia, profileSince, historyStartsInLogs, lastActivityAt, quests } = summary.modes[mode]
    summaryByMode[mode] = { profileId, accountId, resetAt, ...(resetVia ? { resetVia } : {}), profileSince, historyStartsInLogs, lastActivityAt, questCount: quests.length }
    if (accountId) latestAccountIdByMode[mode] = accountId
    if (profileId) latestCharacterIdByMode[mode] = profileId
  }
  const result: ModeLogScanResult = {
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
    acceptedByMode,
  }
  return { ...result, signature: logScanSignature(result) }
}

const SCAN_MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

/**
 * A short hash of everything the app takes from a scan: every mode's quests (task, status, time), its profile and game
 * account, its reset, whether its history starts in the logs and its acceptances, plus the latest mode and the number of
 * launches read. The desktop app publishes a scan only when this changes (electron/logWatcher.ts), and applies one only
 * once (src/import/logResults.ts). The last quest of the list alone is not enough: a PvP hand-in while a Season event is
 * last in the list changed neither the count nor that event, and was never published.
 */
export function logScanSignature(result: Pick<ModeLogScanResult, 'eventsByMode' | 'summaryByMode' | 'latestMode' | 'sessionCount'> & Partial<Pick<ModeLogScanResult, 'acceptedByMode' | 'identityOnly'>>): string {
  const parts: Array<string | number> = [result.identityOnly ? 'identity' : 'full', result.latestMode ?? '', result.sessionCount]
  for (const mode of SCAN_MODES) {
    const summary = result.summaryByMode?.[mode]
    parts.push(mode, summary?.profileId ?? '', summary?.accountId ?? 0, summary?.resetAt ?? '', summary?.historyStartsInLogs ? 1 : 0, (result.acceptedByMode?.[mode] ?? []).join(','))
    for (const event of result.eventsByMode?.[mode] ?? []) parts.push(event.taskId, event.status, event.timestamp)
  }
  return shortHash(JSON.stringify(parts))
}

/** cyrb53: a 53-bit string hash, plenty to tell two states of one player's logs apart. */
function shortHash(text: string) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * The identity part of a scan (identityOnly): the latest mode, each mode's game account and profile, nothing about quests.
 * No mode has `lastActivityAt`, so nothing is applied or pushed from it even by code that does not check `identityOnly`.
 */
export function identityScanResult(result: ModeLogScanResult): ModeLogScanResult {
  const summaryByMode = {} as ModeLogScanResult['summaryByMode']
  for (const mode of SCAN_MODES) {
    const { profileId, accountId } = result.summaryByMode[mode]
    summaryByMode[mode] = { profileId, accountId, questCount: 0 }
  }
  const identity: ModeLogScanResult = {
    events: [],
    detectedModes: SCAN_MODES.filter((mode) => summaryByMode[mode].profileId),
    accountIds: result.accountIds,
    profileIds: result.profileIds,
    ignoredRecords: result.ignoredRecords,
    eventsByMode: { pvp: [], pve: [], seasonal: [] },
    summaryByMode,
    unresolvedEvents: 0,
    sessionCount: result.sessionCount,
    latestMode: result.latestMode,
    latestAccountIdByMode: result.latestAccountIdByMode,
    latestCharacterIdByMode: result.latestCharacterIdByMode,
    identityOnly: true,
  }
  return { ...identity, signature: logScanSignature(identity) }
}

/**
 * The quest ids that may reveal a profile reset: the catalog's trader quests of a mode — not a story chapter, not a
 * wiki-only page, a game id. A daily or weekly quest is accepted again and again under one template id the catalog does
 * not list, and must never count as «accepted after handed in».
 */
export function traderQuestIdsForResets(quests: ReadonlyArray<{ id: string; kind?: string; storyChapterId?: string }>): string[] {
  return quests.filter((quest) => quest.kind !== 'story' && !quest.storyChapterId && /^[a-f0-9]{24}$/i.test(quest.id)).map((quest) => quest.id)
}

/**
 * P23: one launch that logged «Session mode» takes its modes from those lines (and profile ids) only. The gateway host of
 * backend requests used to switch the mode too, so one stray request to another mode's gateway in mid-session moved the
 * quests after it to that mode — and could look like a reset there. Gateway hosts still tell the mode of a launch that
 * logged no «Session mode» line at all. `launch`: every signal of one launch folder.
 */
export function explicitModesWin(launch: LogSignal[]): LogSignal[] {
  const explicit = launch.some((signal) => signal.kind === 'mode' && signal.via !== 'gateway')
  return explicit ? launch.filter((signal) => !(signal.kind === 'mode' && signal.via === 'gateway')) : launch
}

const STATUS_BY_TYPE: Record<number, ParsedTaskEvent['status']> = { 10: 'active', 11: 'failed', 12: 'completed' }
const LINE_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:\s*([+-]\d{2}:?\d{2}|Z))?(?:\s*\||\s)/
const SESSION_MODE = /Session mode:\s*(PvpSeason|Seasonal|Pve|Pvp|Regular)\b/i
const PROFILE_LINE = /(?:Select(?:ed)?Profile|PrepareSelectedProfileLocally) ProfileId:([a-f0-9]{24}) AccountId:(\d+)/i
const GATEWAY = /https?:\/\/gw-(pvp-season|pve|pvp)\./i
/** The game's own profile resets in the backend log (a request line, not its response): see LogSignal 'reset'. */
const RESET_REQUEST = /--->\s*Request[^\n]*\/client\/(prestige\/obtain|game\/profile\/create)\b/i
const QUEST_TYPE_ORDER = { active: 1, failed: 2, completed: 3 } as const
const KIND_ORDER = { mode: 0, profile: 1, reset: 2, quest: 3 } as const

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
    const reset = line.match(RESET_REQUEST)
    if (reset) {
      const host = line.match(GATEWAY)
      signals.push({ kind: 'reset', at, via: /prestige/i.test(reset[1]!) ? 'prestige' : 'profile-create', ...(host ? { mode: modeFromGateway(host[1]!) } : {}) })
    }
    const gateway = line.match(GATEWAY)
    if (gateway) {
      const mode = modeFromGateway(gateway[1]!)
      if (mode !== lastGatewayMode) signals.push({ kind: 'mode', at, mode, via: 'gateway' })
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

export function summarizeLogSignals(signals: LogSignal[], options: LogSummaryOptions = {}): LogTimelineSummary {
  const ordered = [...signals].sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  const modeOfProfile = new Map<string, RaidMode>()
  /** The first profile load of every profile id: whether the profile started inside the logs (historyStartsInLogs). */
  const firstSeen = new Map<string, number>()
  const profileOfMode: Partial<Record<RaidMode, { profileId: string; accountId: number }>> = {}
  /** Per mode, the profile loaded last and since when it has been, without another profile of the mode in between. */
  const profileRun: Partial<Record<RaidMode, { profileId: string; since: number }>> = {}
  const profileTimes: Record<RaidMode, number[]> = { pvp: [], pve: [], seasonal: [] }
  const raw: Record<RaidMode, ParsedTaskEvent[]> = { pvp: [], pve: [], seasonal: [] }
  const lastActivity: Partial<Record<RaidMode, number>> = {}
  /** Per mode, the game's own resets (prestige / new profile requests). */
  const resetSignals: Record<RaidMode, Array<{ at: number; via: 'prestige' | 'profile-create' }>> = { pvp: [], pve: [], seasonal: [] }
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
      if (!firstSeen.has(signal.profileId)) firstSeen.set(signal.profileId, signal.at)
      if (profileRun[mode]?.profileId !== signal.profileId) profileRun[mode] = { profileId: signal.profileId, since: signal.at }
      profileOfMode[mode] = { profileId: signal.profileId, accountId: signal.accountId }
      profileTimes[mode].push(signal.at)
      lastActivity[mode] = signal.at
      continue
    }
    if (signal.kind === 'reset') {
      const target = signal.mode ?? mode
      if (target) resetSignals[target].push({ at: signal.at, via: signal.via })
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
    const trusted = options.trustedQuestIds?.[key]
    const dropped = dropBeforeReset(events, profileTimes[key], (taskId) => trusted?.has(taskId) ?? false)
    let { history, resetAt } = dropped
    let resetVia: ModeLogSummary['resetVia'] = resetAt === undefined ? undefined : 'quest'
    // The game's own prestige / new-profile request is a reset too: the quests before it belong to the profile before.
    const signal = resetSignals[key].at(-1)
    if (signal && (resetAt === undefined || signal.at > resetAt)) {
      resetAt = signal.at
      resetVia = signal.via
      history = history.filter((event) => Date.parse(event.timestamp) >= signal.at)
    }
    const since = identity && profileRun[key]?.profileId === identity.profileId ? profileRun[key]!.since : undefined
    const first = identity ? firstSeen.get(identity.profileId) : undefined
    const startsInLogs = resetAt !== undefined || (first !== undefined && options.oldestLaunchUntil !== undefined && first > options.oldestLaunchUntil)
    modes[key] = {
      profileId: identity?.profileId,
      accountId: identity?.accountId,
      resetAt: resetAt === undefined ? undefined : new Date(resetAt).toISOString(),
      ...(resetVia ? { resetVia } : {}),
      profileSince: since === undefined ? undefined : new Date(since).toISOString(),
      historyStartsInLogs: startsInLogs || undefined,
      lastActivityAt: lastActivity[key] === undefined ? undefined : new Date(lastActivity[key]!).toISOString(),
      history,
      quests: latestPerTask(history),
    }
  }
  return { modes, latestMode: mode, unresolvedEvents }
}

/**
 * A quest that was handed in cannot be accepted again, so «accepted after handed in» means the profile was reset (a
 * prestige keeps the profile id). Everything before the profile load that preceded it belongs to the old profile.
 * Only a `trusted` quest — a trader quest of the mode's catalog — counts: dailies and weeklies are accepted again and
 * again under one template id, and every reset drops history here and deletes the character's older events on the server.
 */
function dropBeforeReset(events: ParsedTaskEvent[], profileTimes: number[], trusted: (taskId: string) => boolean) {
  let kept: ParsedTaskEvent[] = []
  let resetAt: number | undefined
  for (const event of events) {
    const at = Date.parse(event.timestamp)
    if (event.status === 'active' && trusted(event.taskId) && kept.some((entry) => entry.taskId === event.taskId && entry.status === 'completed')) {
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
