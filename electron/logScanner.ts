import { open, readdir, stat, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import type { RaidMode } from '../src/domain/types.js'
import { buildScanResult, parseLogTime, readLogSignalsFrom, type LogSignal, type ModeLogScanResult } from '../src/import/eftLogTimeline.js'
import { raidEventsFromText, raidStateFromEvents, type RaidLogEvent, type RaidState } from '../src/import/raidState.js'
import { parseScreenshotBinding } from '../src/overlay/gameKeys.js'

export type { ModeLogScanResult, RaidState }

/** Only these logs carry mode, profile and quest notifications; output/errors are huge and irrelevant. */
const RELEVANT_LOG = /(application|backend|notifications)[^\\/]*\.log$/i
const MAX_FILE_BYTES = 60 * 1024 * 1024

/**
 * Parses a log that a running game keeps appending to. `feed` takes finished records (text that ends where a
 * timestamped line starts) into the kept state; `finish` adds the last, still open record — a notification's JSON
 * block or a half-written line may still grow — without keeping it, and returns the result for the whole file.
 */
interface LogReader<S, R> {
  init(): S
  feed(state: S, text: string): void
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
 * The first poll reads a log whole; later polls read only the bytes appended since (the log of a long session grows
 * to tens of MB and used to be read and parsed whole every 5 seconds). A shorter file (truncated) or a different
 * start (replaced) is read again from the beginning. Returns undefined when the file cannot be read.
 */
async function follow<S, R>(file: string, cache: Map<string, Followed<S, R>>, reader: LogReader<S, R>, maxBytes = Infinity): Promise<R | undefined> {
  const info = await stat(file).catch(() => null)
  if (!info || info.size > maxBytes) { cache.delete(file); return undefined }
  let entry = cache.get(file)
  if (entry && entry.size === info.size && entry.mtimeMs === info.mtimeMs) return entry.result
  const handle = await open(file, 'r').catch(() => null)
  if (!handle) { cache.delete(file); return undefined }
  try {
    const previous = entry?.result
    let head = entry ? await readBytes(handle, 0, HEAD_BYTES) : undefined
    if (entry && head && (info.size < entry.offset || !head.subarray(0, entry.head.length).equals(entry.head))) entry = undefined
    const from = entry?.offset ?? 0
    const bytes = await readBytes(handle, from, info.size - from)
    if (!entry) head = Buffer.from(bytes.subarray(0, HEAD_BYTES))
    const cut = lastRecordStart(bytes)
    const state = entry?.state ?? reader.init()
    if (cut > 0) reader.feed(state, bytes.toString('utf8', 0, cut))
    const next = reader.finish(state, bytes.toString('utf8', cut))
    // Appended lines rarely add anything: then hand out the previous result itself, so callers can tell nothing changed.
    const result = previous !== undefined && reader.same(previous, next) ? previous : next
    cache.set(file, { offset: from + cut, size: info.size, mtimeMs: info.mtimeMs, head: head!, state, result })
    return result
  } catch {
    cache.delete(file)
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
  feed(state, text) {
    const piece = readLogSignalsFrom(withoutLastBreak(text), state.gatewayMode)
    state.signals.push(...piece.signals)
    state.gatewayMode = piece.gatewayMode
  },
  finish: (state, open) => open ? [...state.signals, ...readLogSignalsFrom(open, state.gatewayMode).signals] : [...state.signals],
  same: sameItems,
}

const raidReader: LogReader<{ events: RaidLogEvent[] }, RaidLogEvent[]> = {
  init: () => ({ events: [] }),
  feed(state, text) { state.events.push(...raidEventsFromText(withoutLastBreak(text))) },
  finish: (state, open) => open ? [...state.events, ...raidEventsFromText(open)] : [...state.events],
  same: sameItems,
}

const signalCache = new Map<string, Followed<{ signals: LogSignal[]; gatewayMode?: RaidMode }, LogSignal[]>>()
const raidCache = new Map<string, Followed<{ events: RaidLogEvent[] }, RaidLogEvent[]>>()
let lastScan: { root: string; folders: number; inputs: Array<LogSignal[] | undefined>; result: ModeLogScanResult } | null = null

export async function scanLogFolderBySession(root: string): Promise<ModeLogScanResult> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const sessionFolders = entries.filter((entry) => entry.isDirectory() && /^log_/i.test(entry.name)).map((entry) => join(root, entry.name))
  const folders = sessionFolders.length ? sessionFolders : [root]
  const inputs: Array<LogSignal[] | undefined> = []
  const seen = new Set<string>()
  for (const folder of folders) {
    for (const file of await relevantLogs(folder)) {
      seen.add(file)
      inputs.push(await follow(file, signalCache, signalReader, MAX_FILE_BYTES))
    }
  }
  forgetOthers(signalCache, root, seen)
  // Nothing changed since the last poll (the usual case): skip summarizing every launch again.
  if (lastScan && lastScan.root === root && lastScan.folders === folders.length && sameInputs(lastScan.inputs, inputs)) return lastScan.result
  const signals: LogSignal[] = []
  let ignoredRecords = 0
  for (const result of inputs) {
    if (result) signals.push(...result)
    else ignoredRecords += 1
  }
  const result = buildScanResult(signals, folders.length, ignoredRecords)
  lastScan = { root, folders: folders.length, inputs, result }
  return result
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
  const events = await Promise.all(files.map(async (file) => await follow(file, raidCache, raidReader) ?? []))
  forgetOthers(raidCache, root, new Set(files))
  return raidStateFromEvents(events)
}

/** Drops kept logs under `root` that are gone or no longer read (older launches for the raid state). */
function forgetOthers(cache: Map<string, unknown>, root: string, keep: Set<string>) {
  for (const file of cache.keys()) if (file.startsWith(root) && !keep.has(file)) cache.delete(file)
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
