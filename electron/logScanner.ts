import { open, readdir, readFile, rename, stat, unlink, writeFile, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import type { RaidMode } from '../src/domain/types.js'
import { buildScanResult, explicitModesWin, identityScanResult, parseLogTime, readLogSignalsFrom, type LogSignal, type LogSummaryOptions, type ModeLogScanResult } from '../src/import/eftLogTimeline.js'
import { raidEventsFromText, raidStateFromEvents, type RaidLogEvent, type RaidState } from '../src/import/raidState.js'
import { logSliceParser } from './logParser.js'
import { parseScreenshotBindingAt } from '../src/overlay/gameKeys.js'

export type { ModeLogScanResult, RaidState }

/** Only these logs carry mode, profile and quest notifications; output/errors are huge and irrelevant. */
const RELEVANT_LOG = /(application|backend|notifications)[^\\/]*\.log$/i
const MAX_FILE_BYTES = 60 * 1024 * 1024

/**
 * Parses a log that a running game keeps appending to. `feed` takes finished records (the bytes `[from, to)`, which end
 * where a timestamped line starts) into the kept state; `finish` adds the last, still open record — a notification's
 * JSON block or a half-written line may still grow — without keeping it, and returns the result for the whole file.
 */
interface LogReader<S, R> {
  init(): S
  /** A copy to go on from: the kept state of a log is never changed in place (a save may read it meanwhile). */
  clone(state: S): S
  feed(state: S, bytes: Buffer, from: number, to: number): void | Promise<void>
  finish(state: S, open: string): R
  same(a: R, b: R): boolean
}

/** Kept items are the very same objects; the re-read open record gives equal copies. */
function sameItems<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((item, index) => item === b[index] || JSON.stringify(item) === JSON.stringify(b[index]))
}

interface Followed<S, R> {
  /** Bytes already taken into `state`: always the start of a record. */
  offset: number
  size: number
  mtimeMs: number
  /** First bytes of the file: a replaced (rotated) file of the same name is read again from the start. */
  head: Buffer
  state: S
  result: R
}

const HEAD_BYTES = 64

/**
 * New bytes are parsed a slice of about a megabyte at a time, with a pause for the main process's other work between
 * slices: at the app's start every launch's logs are read, and a log of tens of megabytes held the main process for a
 * second or more at once (the item lookup, the hotkeys and the quest scanner waited meanwhile). A big slice is decoded and
 * parsed on a worker thread (electron/logParser.ts); what a start reads at all is only what is new since the last run.
 */
const SLICE_BYTES = 1024 * 1024
const pauseForEvents = () => new Promise<void>((resolve) => setImmediate(resolve))

/** Where the slice from `from` may end: the start of a record about SLICE_BYTES on (records are never split). */
function sliceEnd(bytes: Buffer, from: number, cut: number) {
  if (cut - from <= SLICE_BYTES) return cut
  const start = lastRecordStart(bytes.subarray(from, from + SLICE_BYTES))
  return start > 0 ? from + start : cut
}

/**
 * The first poll reads a log whole; later polls read only the bytes appended since (the log of a long session grows
 * to tens of MB and used to be read and parsed whole every 5 seconds). A shorter file (truncated) or a different
 * start (replaced) is read again from the beginning. Returns undefined when the file cannot be read.
 */
async function follow<S, R>(file: string, cache: Map<string, Followed<S, R>>, reader: LogReader<S, R>, maxBytes = Infinity, changed?: (bytes: number, resultChanged: boolean) => void): Promise<R | undefined> {
  const info = await stat(file).catch(() => null)
  if (!info || info.size > maxBytes) { if (cache.delete(file)) changed?.(0, true); return undefined }
  let entry = cache.get(file)
  if (entry && entry.size === info.size && entry.mtimeMs === info.mtimeMs) return entry.result
  const handle = await open(file, 'r').catch(() => null)
  if (!handle) { if (cache.delete(file)) changed?.(0, true); return undefined }
  try {
    const previous = entry?.result
    let head = entry ? await readBytes(handle, 0, HEAD_BYTES) : undefined
    if (entry && head && (info.size < entry.offset || !head.subarray(0, entry.head.length).equals(entry.head))) entry = undefined
    const from = entry?.offset ?? 0
    const bytes = await readBytes(handle, from, info.size - from)
    if (!entry) head = Buffer.from(bytes.subarray(0, HEAD_BYTES))
    const cut = lastRecordStart(bytes)
    const state = entry ? reader.clone(entry.state) : reader.init()
    for (let from = 0; from < cut;) {
      const to = sliceEnd(bytes, from, cut)
      await reader.feed(state, bytes, from, to)
      from = to
      if (from < cut) await pauseForEvents()
    }
    const next = reader.finish(state, bytes.toString('utf8', cut))
    // Appended lines rarely add anything: then hand out the previous result itself, so callers can tell nothing changed.
    const result = previous !== undefined && reader.same(previous, next) ? previous : next
    cache.set(file, { offset: from + cut, size: info.size, mtimeMs: info.mtimeMs, head: head!, state, result })
    changed?.(bytes.length, result !== previous)
    return result
  } catch {
    if (cache.delete(file)) changed?.(0, true)
    return undefined
  } finally {
    await handle.close().catch(() => {})
  }
}

async function readBytes(handle: FileHandle, position: number, length: number) {
  const buffer = Buffer.allocUnsafe(Math.max(0, length))
  let filled = 0
  while (filled < buffer.length) {
    const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, position + filled)
    if (!bytesRead) break
    filled += bytesRead
  }
  return buffer.subarray(0, filled)
}

/** Byte index where the last timestamped line of `bytes` starts; 0 when no line after the first one is. */
function lastRecordStart(bytes: Buffer) {
  let end = bytes.length
  while (end > 0) {
    const newline = bytes.lastIndexOf(0x0a, end - 1)
    if (newline < 0) return 0
    const start = newline + 1
    if (start < bytes.length) {
      let lineEnd = bytes.indexOf(0x0a, start)
      if (lineEnd < 0) lineEnd = bytes.length
      const line = bytes.toString('utf8', start, Math.min(lineEnd, start + 256)).replace(/\r$/, '')
      if (parseLogTime(line) !== undefined) return start
    }
    end = newline
  }
  return 0
}

/** The finished text of `feed` ends with the line break before the next record; that break is not a line of its own. */
const withoutLastBreak = (text: string) => text.replace(/\r?\n$/, '')

const signalReader: LogReader<{ signals: LogSignal[]; gatewayMode?: RaidMode }, LogSignal[]> = {
  init: () => ({ signals: [] }),
  clone: (state) => ({ signals: [...state.signals], gatewayMode: state.gatewayMode }),
  // A big slice is parsed on the worker thread (electron/logParser.ts).
  async feed(state, bytes, from, to) {
    const piece = await logSliceParser.parse(bytes, from, to, state.gatewayMode)
    for (const signal of piece.signals) state.signals.push(signal)
    state.gatewayMode = piece.gatewayMode
  },
  finish: (state, open) => open ? [...state.signals, ...readLogSignalsFrom(open, state.gatewayMode).signals] : [...state.signals],
  same: sameItems,
}

const raidReader: LogReader<{ events: RaidLogEvent[] }, RaidLogEvent[]> = {
  init: () => ({ events: [] }),
  clone: (state) => ({ events: [...state.events] }),
  feed(state, bytes, from, to) { for (const event of raidEventsFromText(withoutLastBreak(bytes.toString('utf8', from, to)))) state.events.push(event) },
  finish: (state, open) => open ? [...state.events, ...raidEventsFromText(open)] : [...state.events],
  same: sameItems,
}

const signalCache = new Map<string, Followed<{ signals: LogSignal[]; gatewayMode?: RaidMode }, LogSignal[]>>()
const raidCache = new Map<string, Followed<{ events: RaidLogEvent[] }, RaidLogEvent[]>>()
let lastScan: { root: string; folders: number; trusted: ScanOptions['trustedQuestIds']; inputs: Array<LogSignal[] | undefined>; result: ModeLogScanResult } | null = null

/**
 * Launches before the newest one are over: the game writes only to the newest launch's logs. Read once more after a
 * newer launch appeared (their last lines may have come after the previous poll), their logs are not listed or checked
 * again — a player keeps hundreds of launches, and every 5-second poll used to list each folder and check each log.
 */
const finishedLaunches = new Map<string, string[]>()

/**
 * One read at a time of each kind (the 5-second poll, a search from the page, a profile lookup): reads share the kept
 * state of each log, and a read now pauses between slices of a big log, where another could have slipped in.
 */
function oneAtATime() {
  let last: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = last.then(task, task)
    last = run.catch(() => undefined)
    return run
  }
}
const signalReads = oneAtATime()
const raidReads = oneAtATime()

/** What a scan takes from the app: the catalog's trader quest ids per mode (resets, see summarizeLogSignals). */
export type ScanOptions = Pick<LogSummaryOptions, 'trustedQuestIds'>

/**
 * Every launch's logs, summarized per mode. `options.trustedQuestIds`: a scan with other ids is summarized again even
 * when no log changed (the same object = the same ids).
 */
export function scanLogFolderBySession(root: string, options: ScanOptions = {}): Promise<ModeLogScanResult> {
  return signalReads(() => scanNow(root, options))
}

interface Launch { folder: string; key: number }

/** The launch folders (log_…) of a Logs folder, oldest first; the folder itself when it holds the logs directly. */
async function launchFolders(root: string): Promise<Launch[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const launches = entries.filter((entry) => entry.isDirectory() && /^log_/i.test(entry.name))
    .map((entry) => ({ folder: join(root, entry.name), key: launchKey(entry.name), name: entry.name }))
    .sort((a, b) => a.key - b.key || a.name.localeCompare(b.name))
    .map(({ folder, key }) => ({ folder, key }))
  return launches.length ? launches : [{ folder: root, key: 0 }]
}

async function scanNow(root: string, options: ScanOptions): Promise<ModeLogScanResult> {
  const folders = await launchFolders(root)
  const newest = Math.max(0, ...folders.map((launch) => launch.key))
  const inputs: Array<LogSignal[] | undefined> = []
  const perLaunch: LogSignal[][] = []
  const seen = new Set<string>()
  for (const { folder, key } of folders) {
    const finished = finishedLaunches.get(folder)
    const files = finished ?? await relevantLogs(folder)
    const launch: LogSignal[] = []
    for (const file of files) {
      seen.add(file)
      const kept = finished ? signalCache.get(file) : undefined
      const signals = kept ? kept.result : await follow(file, signalCache, signalReader, MAX_FILE_BYTES, noteCacheChange)
      inputs.push(signals)
      if (signals) for (const signal of signals) launch.push(signal)
    }
    perLaunch.push(launch)
    if (!finished && key > 0 && key < newest) finishedLaunches.set(folder, files)
  }
  const listed = new Set(folders.map((entry) => entry.folder))
  for (const folder of finishedLaunches.keys()) if (folder.startsWith(root) && !listed.has(folder)) finishedLaunches.delete(folder)
  forgetOthers(signalCache, root, seen, noteCacheChange)
  // Nothing changed since the last poll (the usual case): skip summarizing every launch again.
  if (lastScan && lastScan.root === root && lastScan.folders === folders.length && lastScan.trusted === options.trustedQuestIds && sameInputs(lastScan.inputs, inputs)) return lastScan.result
  let ignoredRecords = 0
  for (const signals of inputs) if (!signals) ignoredRecords += 1
  // The oldest launch that logged anything: a profile seen first after it started inside the logs (historyStartsInLogs).
  const oldest = perLaunch.find((launch) => launch.length)
  let oldestLaunchUntil: number | undefined
  if (oldest) for (const signal of oldest) oldestLaunchUntil = Math.max(oldestLaunchUntil ?? signal.at, signal.at)
  const result = buildScanResult(perLaunch.flatMap(explicitModesWin), folders.length, ignoredRecords, { trustedQuestIds: options.trustedQuestIds, oldestLaunchUntil })
  lastScan = { root, folders: folders.length, trusted: options.trustedQuestIds, inputs, result }
  return result
}

/** The newest launches read for the identity: the latest mode and each mode's game account and profile within seconds. */
export const IDENTITY_LAUNCHES = 3

/**
 * Identity first (#202, «персонаж должен находиться сразу при первом запуске»): only the application logs of the newest
 * launches — where «Session mode» and the profile lines are — summarized into an identity-only result
 * (identityScanResult). The full read of every launch follows; the files read here are kept for it.
 */
export function scanLogIdentity(root: string, options: ScanOptions = {}): Promise<ModeLogScanResult> {
  return signalReads(async () => {
    const folders = await launchFolders(root)
    const perLaunch: LogSignal[][] = []
    for (const { folder } of folders.slice(-IDENTITY_LAUNCHES)) {
      const files = (finishedLaunches.get(folder) ?? await relevantLogs(folder)).filter((file) => /application[^\\/]*\.log$/i.test(file))
      const launch: LogSignal[] = []
      for (const file of files) {
        const signals = await follow(file, signalCache, signalReader, MAX_FILE_BYTES, noteCacheChange)
        if (signals) for (const signal of signals) launch.push(signal)
      }
      perLaunch.push(launch)
    }
    return identityScanResult(buildScanResult(perLaunch.flatMap(explicitModesWin), folders.length, 0, { trustedQuestIds: options.trustedQuestIds }))
  })
}

/** Raid state of the newest game launch — only its application and notification logs are read. */
export function readRaidState(root: string): Promise<RaidState> {
  return raidReads(() => raidStateNow(root))
}

async function raidStateNow(root: string): Promise<RaidState> {
  const folder = (await launchFolders(root)).at(-1)!.folder
  const files = (await relevantLogs(folder)).filter((file) => /(application|notifications)[^\\/]*\.log$/i.test(file))
  const events = await Promise.all(files.map(async (file) => await follow(file, raidCache, raidReader) ?? []))
  forgetOthers(raidCache, root, new Set(files))
  return raidStateFromEvents(events)
}

/** Drops kept logs under `root` that are gone or no longer read (older launches for the raid state). */
function forgetOthers(cache: Map<string, unknown>, root: string, keep: Set<string>, changed?: (bytes: number, resultChanged: boolean) => void) {
  for (const file of cache.keys()) if (file.startsWith(root) && !keep.has(file)) { cache.delete(file); changed?.(0, true) }
}

/** The same file results (unchanged files return the very same array) in the same order. */
function sameInputs(previous: Array<LogSignal[] | undefined>, next: Array<LogSignal[] | undefined>) {
  return previous.length === next.length && previous.every((value, index) => value === next[index])
}

/**
 * The game's screenshot key from the control settings EFT logs when it starts, from the newest of the last
 * few launches that logged them: [] = not bound, null = not found.
 */
export async function readScreenshotBinding(root: string): Promise<string[] | null> {
  return (await readScreenshotBindingAt(root))?.keys ?? null
}

/** The same with the time the game logged it (0 when the log line had none), to weigh it against Control.ini. */
export async function readScreenshotBindingAt(root: string): Promise<{ keys: string[]; at: number } | null> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const launches = entries
    .filter((entry) => entry.isDirectory() && /^log_/i.test(entry.name))
    .map((entry) => ({ name: entry.name, key: launchKey(entry.name) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, 3)
    .map((entry) => join(root, entry.name))
  for (const folder of launches.length ? launches : [root]) {
    const files = (await relevantLogs(folder)).filter((file) => /application[^\\/]*\.log$/i.test(file)).sort()
    let found: { keys: string[]; at: number } | null = null
    for (const file of files) found = await fileBinding(file) ?? found
    if (found) return found
  }
  return null
}

const BINDING_CHUNK = 4 * 1024 * 1024
/** Chunks overlap so a binding cut in half by a chunk edge is still read whole. */
const BINDING_OVERLAP = 8 * 1024
const bindingCache = new Map<string, { size: number; found: { keys: string[]; at: number } | null }>()

/** A running game keeps appending to its log: only the new part is read, in chunks. */
async function fileBinding(file: string) {
  const info = await stat(file).catch(() => null)
  if (!info) return null
  const cached = bindingCache.get(file)
  if (cached && cached.size === info.size) return cached.found
  const from = cached && info.size > cached.size ? Math.max(0, cached.size - BINDING_OVERLAP) : 0
  let found = cached && from > 0 ? cached.found : null
  const handle = await open(file, 'r').catch(() => null)
  if (!handle) return found
  try {
    const buffer = Buffer.alloc(BINDING_CHUNK)
    for (let position = from; position < info.size;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(BINDING_CHUNK, info.size - position), position)
      if (!bytesRead) break
      found = parseScreenshotBindingAt(buffer.toString('utf8', 0, bytesRead)) ?? found
      if (position + bytesRead >= info.size) break
      position += Math.max(1, bytesRead - BINDING_OVERLAP)
    }
  } catch {
    return found
  } finally {
    await handle.close().catch(() => {})
  }
  bindingCache.set(file, { size: info.size, found })
  return found
}

/** «log_2026.09.27_2-33-45_1.1.5.1» → sortable launch time (the hour is not zero-padded). */
function launchKey(name: string) {
  const match = /^log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{2})-(\d{2})/i.exec(name)
  if (!match) return 0
  const [, year, month, day, hour, minute, second] = match.map(Number)
  return Date.UTC(year!, month! - 1, day!, hour!, minute!, second!)
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

// ------------------------------------------------------------------------------------------------------------
// The kept logs between app starts
// ------------------------------------------------------------------------------------------------------------

/**
 * What every log read so far gave, kept in the app's data folder (P14): an app start no longer re-reads and re-parses
 * every launch the game kept — only logs whose size or time changed, from where the last read stopped. Per log: its
 * path, size, time, first bytes (a replaced log is read again from the start), the offset read up to, the gateway mode
 * at that offset and the signals (those of the finished records, then those of the last, still open one).
 */
interface KeptLog {
  path: string
  size: number
  mtimeMs: number
  offset: number
  head: string
  gatewayMode?: RaidMode
  signals: LogSignal[]
  open: LogSignal[]
}

/** 2: the game's prestige / new-profile requests are signals too (read again once, so older ones count). */
const LOG_CACHE_VERSION = 2
/** A kept file bigger than this is not read (something else wrote it); a player's logs give a few MB at most. */
const MAX_CACHE_FILE_BYTES = 64 * 1024 * 1024
/** Log bytes read since the last save after which the offsets alone are worth saving (a growing log of a long session). */
const SAVE_AFTER_BYTES = 16 * 1024 * 1024

let cacheDirty = false
let bytesSinceSave = 0

function noteCacheChange(bytes: number, resultChanged: boolean) {
  bytesSinceSave += bytes
  if (resultChanged || bytesSinceSave >= SAVE_AFTER_BYTES) cacheDirty = true
}

const MODES = new Set<string>(['pvp', 'pve', 'seasonal'])
const HEX_ID = /^[a-f0-9]{24}$/i
const STATUSES = new Set<string>(['active', 'completed', 'failed'])

function validSignal(value: unknown): value is LogSignal {
  if (!value || typeof value !== 'object') return false
  const signal = value as Record<string, unknown>
  if (typeof signal.at !== 'number' || !Number.isFinite(signal.at)) return false
  if (signal.kind === 'mode') return MODES.has(String(signal.mode)) && (signal.via === undefined || signal.via === 'gateway')
  if (signal.kind === 'profile') return HEX_ID.test(String(signal.profileId)) && Number.isSafeInteger(signal.accountId)
  if (signal.kind === 'quest') return HEX_ID.test(String(signal.taskId)) && STATUSES.has(String(signal.status))
  if (signal.kind === 'reset') return (signal.via === 'prestige' || signal.via === 'profile-create') && (signal.mode === undefined || MODES.has(String(signal.mode)))
  return false
}

function validKeptLog(value: unknown): value is KeptLog {
  if (!value || typeof value !== 'object') return false
  const log = value as Record<string, unknown>
  return typeof log.path === 'string' && log.path.length > 0 && log.path.length < 4096
    && [log.size, log.mtimeMs, log.offset].every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0)
    && (log.offset as number) <= (log.size as number)
    && typeof log.head === 'string' && log.head.length <= 128
    && (log.gatewayMode === undefined || MODES.has(String(log.gatewayMode)))
    && Array.isArray(log.signals) && log.signals.every(validSignal)
    && Array.isArray(log.open) && log.open.every(validSignal)
}

/** The kept logs from the last run (at the start, before the first scan). Returns how many logs were taken. */
export function loadLogCache(file: string): Promise<number> {
  return signalReads(async () => {
    const info = await stat(file).catch(() => null)
    if (!info || info.size > MAX_CACHE_FILE_BYTES) return 0
    let parsed: unknown
    try { parsed = JSON.parse(await readFile(file, 'utf8')) } catch { return 0 }
    const root = parsed as { version?: unknown; logs?: unknown } | null
    if (!root || root.version !== LOG_CACHE_VERSION || !Array.isArray(root.logs)) return 0
    let taken = 0
    for (const log of root.logs) {
      if (!validKeptLog(log) || signalCache.has(log.path)) continue
      const state = { signals: log.signals, gatewayMode: log.gatewayMode }
      signalCache.set(log.path, { offset: log.offset, size: log.size, mtimeMs: log.mtimeMs, head: Buffer.from(log.head, 'base64'), state, result: [...log.signals, ...log.open] })
      taken += 1
    }
    return taken
  })
}

/**
 * Writes the kept logs when they changed since the last save (a new signal, a log added or gone, or a lot of bytes
 * read). In turn with the reads, so a log is never written half-way through its read; the file is replaced at once.
 */
export function saveLogCache(file: string): Promise<boolean> {
  return signalReads(async () => {
    if (!cacheDirty) return false
    const logs: KeptLog[] = []
    for (const [path, entry] of signalCache) {
      logs.push({
        path, size: entry.size, mtimeMs: entry.mtimeMs, offset: entry.offset, head: entry.head.toString('base64'),
        ...(entry.state.gatewayMode ? { gatewayMode: entry.state.gatewayMode } : {}),
        signals: entry.state.signals, open: entry.result.slice(entry.state.signals.length),
      })
    }
    const temporary = `${file}.${process.pid}.tmp`
    try {
      await writeFile(temporary, JSON.stringify({ version: LOG_CACHE_VERSION, logs }), 'utf8')
      await rename(temporary, file)
    } catch {
      await unlink(temporary).catch(() => {})
      return false
    }
    cacheDirty = false
    bytesSinceSave = 0
    return true
  })
}

/** «Очистить все данные»: everything read from the logs is forgotten, here and in the kept file. */
export function clearLogCaches(file?: string): Promise<void> {
  return signalReads(async () => {
    signalCache.clear()
    raidCache.clear()
    finishedLaunches.clear()
    lastScan = null
    cacheDirty = false
    bytesSinceSave = 0
    if (file) await unlink(file).catch(() => {})
  })
}
