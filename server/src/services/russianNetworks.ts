/**
 * Russia's IP addresses, for «Войти через Google» (owner, 25.11.2026: «все страны, кроме России… как сделать, чтобы
 * человек из России не мог зайти через Google?»). raidos.app is not behind Cloudflare, so the visitor's country comes
 * from RIPE NCC's official statistics instead of a GeoIP service: every IPv4 and IPv6 block RIPE NCC has allocated or
 * assigned to a holder in Russia (`ripencc|RU|ipv4|<start>|<count>|…` and `ripencc|RU|ipv6|<prefix>|<length>|…`).
 *
 * The server downloads the file at start and once a day (with a time limit); a failed or implausible download keeps the
 * previous list. Only the Russian lines are kept on disk next to the server's data, so a restart without the internet
 * still knows them. Until any list is loaded nothing is blocked: `isRussianAddress` answers null («unknown»).
 * Addresses are looked up by binary search over merged, sorted ranges. Nothing about the visitor is stored or logged.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isIP } from 'node:net'
import { writeFileAtomic } from './atomicFile.js'

export const RIPE_DELEGATED_URL = 'https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest'
export const RUSSIAN_NETWORKS_REFRESH_MS = 24 * 60 * 60 * 1000
/** After a failed download while no list is known at all: try again sooner than the next day. */
const RETRY_EMPTY_MS = 60 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 60_000
/** The whole RIPE file is ~10 MB; anything far bigger is not it. */
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
/** Russia has thousands of IPv4 blocks: a download with fewer is truncated or something else and does not replace the list. */
const MIN_DOWNLOADED_RANGES = 1000
const COUNTRY = 'RU'
const STATUSES = new Set(['allocated', 'assigned'])

export interface RussianRanges {
  /** IPv4: [start, end] pairs as numbers (inclusive), sorted and merged. */
  v4: Float64Array
  /** IPv6: [start, end] pairs as 128-bit numbers (inclusive), sorted and merged. */
  v6: bigint[]
  /** The source lines kept for the copy on disk. */
  lines: string[]
}

export interface RussianAddressCheck {
  /** true: the address is Russian; false: it is not; null: no list loaded yet or not an IP address. */
  isRussianAddress(ip: string | undefined | null): boolean | null
}

function ipv4ToNumber(text: string): number | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const byte = Number(part)
    if (byte > 255) return null
    value = value * 256 + byte
  }
  return value
}

function ipv6ToBigInt(text: string): bigint | null {
  let address = text
  // an IPv4 tail («::ffff:1.2.3.4», «64:ff9b::1.2.3.4») becomes two groups
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)
  if (tail) {
    const v4 = ipv4ToNumber(tail[2]!)
    if (v4 === null) return null
    address = `${tail[1]}${(Math.floor(v4 / 65536)).toString(16)}:${(v4 % 65536).toString(16)}`
  }
  const halves = address.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest]
  let value = 0n
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    value = (value << 16n) | BigInt(parseInt(group, 16))
  }
  return value
}

const MAPPED_V4 = 0xffffn << 32n
const V4_MASK = 0xffffffffn

/** An address as IPv4 number or IPv6 bigint; «::ffff:1.2.3.4» counts as IPv4. A zone («%eth0») is ignored. */
export function parseAddress(ip: string): { v4: number } | { v6: bigint } | null {
  const address = ip.trim().replace(/%.*$/, '')
  const kind = isIP(address)
  if (kind === 4) { const v4 = ipv4ToNumber(address); return v4 === null ? null : { v4 } }
  if (kind !== 6) return null
  const v6 = ipv6ToBigInt(address)
  if (v6 === null) return null
  if (v6 >> 32n === MAPPED_V4 >> 32n) return { v4: Number(v6 & V4_MASK) }
  return { v6 }
}

function mergeNumbers(pairs: [number, number][]) {
  pairs.sort((a, b) => a[0] - b[0])
  const merged: number[] = []
  for (const [start, end] of pairs) {
    const last = merged.length - 1
    if (last > 0 && start <= merged[last]! + 1) merged[last] = Math.max(merged[last]!, end)
    else merged.push(start, end)
  }
  return Float64Array.from(merged)
}

function mergeBigInts(pairs: [bigint, bigint][]) {
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const merged: bigint[] = []
  for (const [start, end] of pairs) {
    const last = merged.length - 1
    if (last > 0 && start <= merged[last]! + 1n) { if (end > merged[last]!) merged[last] = end }
    else merged.push(start, end)
  }
  return merged
}

/**
 * The Russian blocks of a RIPE NCC «delegated» file (extended or not): `registry|cc|type|start|value|date|status[|id]`.
 * Header, summary and comment lines, other countries and other statuses (available, reserved) are skipped.
 */
export function parseRipeDelegated(text: string): RussianRanges {
  const v4: [number, number][] = []
  const v6: [bigint, bigint][] = []
  const lines: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const fields = line.split('|')
    if (fields.length < 7 || fields[1] !== COUNTRY || !STATUSES.has(fields[6]!)) continue
    const [, , type, start, value] = fields as [string, string, string, string, string]
    if (type === 'ipv4') {
      const first = ipv4ToNumber(start)
      const count = /^\d+$/.test(value) ? Number(value) : 0
      if (first === null || count < 1 || first + count > 2 ** 32) continue
      v4.push([first, first + count - 1])
      lines.push(line)
    } else if (type === 'ipv6') {
      const first = start.includes(':') ? ipv6ToBigInt(start) : null
      const length = /^\d+$/.test(value) ? Number(value) : -1
      if (first === null || length < 0 || length > 128) continue
      const size = 1n << BigInt(128 - length)
      const base = first & ~(size - 1n) & ((1n << 128n) - 1n)
      v6.push([base, base + size - 1n])
      lines.push(line)
    }
  }
  return { v4: mergeNumbers(v4), v6: mergeBigInts(v6), lines }
}

/** Whether `value` lies in one of the sorted, merged [start, end] pairs. */
function inRanges<T extends number | bigint>(ranges: ArrayLike<T>, value: T) {
  let low = 0
  let high = ranges.length / 2 - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (value < ranges[middle * 2]!) high = middle - 1
    else if (value > ranges[middle * 2 + 1]!) low = middle + 1
    else return true
  }
  return false
}

export function rangesContain(ranges: RussianRanges, ip: string): boolean | null {
  const address = parseAddress(ip)
  if (!address) return null
  return 'v4' in address ? inRanges(ranges.v4, address.v4) : inRanges(ranges.v6, address.v6)
}

export interface RussianNetworksOptions {
  /** The copy on disk (only the Russian lines); none: memory only. */
  file?: string
  url?: string
  fetch?: typeof fetch
  timeoutMs?: number
  /** Fewer IPv4 blocks in a download than this keep the previous list (tests pass a small number). */
  minRanges?: number
  log?: (message: string) => void
}

export class RussianNetworks implements RussianAddressCheck {
  private ranges: RussianRanges | null = null
  private timer: NodeJS.Timeout | null = null
  private retry: NodeJS.Timeout | null = null
  private loadedAt: number | null = null

  constructor(private readonly options: RussianNetworksOptions = {}) {}

  get ready() { return this.ranges !== null }

  /** Counts for the logs and the tests. */
  stats() { return { v4: (this.ranges?.v4.length ?? 0) / 2, v6: (this.ranges?.v6.length ?? 0) / 2, loadedAt: this.loadedAt } }

  isRussianAddress(ip: string | undefined | null): boolean | null {
    if (!this.ranges || !ip) return null
    return rangesContain(this.ranges, ip)
  }

  /** Uses a list given here (tests, or a copy read elsewhere). */
  use(ranges: RussianRanges) {
    this.ranges = ranges
    this.loadedAt = Date.now()
  }

  /** Reads the copy on disk; false when there is none or it holds nothing. */
  async loadSaved() {
    if (!this.options.file) return false
    try {
      const parsed = parseRipeDelegated(await readFile(this.options.file, 'utf8'))
      if (parsed.v4.length === 0) return false
      this.use(parsed)
      return true
    } catch {
      return false
    }
  }

  /** Downloads RIPE's file; on success replaces the list and the copy on disk, on failure keeps both. */
  async refresh() {
    const log = this.options.log ?? (() => undefined)
    try {
      const response = await (this.options.fetch ?? fetch)(this.options.url ?? RIPE_DELEGATED_URL, { signal: AbortSignal.timeout(this.options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const declared = Number(response.headers.get('content-length'))
      if (declared > MAX_DOWNLOAD_BYTES) throw new Error('file too large')
      const text = await response.text()
      if (text.length > MAX_DOWNLOAD_BYTES) throw new Error('file too large')
      const parsed = parseRipeDelegated(text)
      if (parsed.v4.length / 2 < (this.options.minRanges ?? MIN_DOWNLOADED_RANGES)) throw new Error(`only ${parsed.v4.length / 2} IPv4 ranges`)
      this.use(parsed)
      if (this.options.file) {
        await mkdir(dirname(this.options.file), { recursive: true })
        await writeFileAtomic(this.options.file, `# Russian blocks from ${this.options.url ?? RIPE_DELEGATED_URL}, ${new Date().toISOString()}\n${parsed.lines.join('\n')}\n`, 0o644)
      }
      const { v4, v6 } = this.stats()
      log(`russian networks: ${v4} IPv4 and ${v6} IPv6 ranges`)
      return true
    } catch (error) {
      log(`russian networks: download failed (${error instanceof Error ? error.message : String(error)}), ${this.ranges ? 'keeping the previous list' : 'no list yet'}`)
      return false
    }
  }

  /** The copy on disk first, then a download now and once a day. Timers do not keep the process alive. */
  async start() {
    await this.loadSaved()
    this.timer ??= setInterval(() => void this.refreshOrRetry(), RUSSIAN_NETWORKS_REFRESH_MS)
    this.timer.unref()
    await this.refreshOrRetry()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.retry) clearTimeout(this.retry)
    this.timer = null
    this.retry = null
  }

  private async refreshOrRetry() {
    if (this.retry) { clearTimeout(this.retry); this.retry = null }
    const ok = await this.refresh()
    if (!ok && !this.ranges && this.timer) {
      this.retry = setTimeout(() => void this.refreshOrRetry(), RETRY_EMPTY_MS)
      this.retry.unref()
    }
  }
}
