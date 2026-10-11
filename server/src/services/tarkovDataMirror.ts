import type { MirrorStorage } from './mirrorStorage.js'

export const MIRROR_MODES = ['regular', 'pve', 'pvp-season'] as const
export type MirrorMode = typeof MIRROR_MODES[number]
// `maps` already contains mobs; `items` contains handbook categories. The former standalone endpoints now return 404.
export const MIRROR_ENDPOINTS = ['items', 'tasks', 'maps', 'traders', 'hideout', 'barters', 'crafts'] as const
const TRANSLATED = new Set(['items', 'tasks', 'maps', 'traders', 'hideout'])
const MINIMUMS: Record<string, number> = { items: 1000, tasks: 100, maps: 1 }
const MAX_BYTES = 48 * 1024 * 1024
const DAY = 24 * 60 * 60 * 1000

interface Validator { etag?: string; modified?: string }
interface DatasetMetadata {
  mode: MirrorMode
  validators: Record<string, Validator>
  counts: Record<string, number>
  downloadedBytes: number
}

export interface DataMirrorStatus {
  state: 'idle' | 'running' | 'done' | 'degraded' | 'mount-missing' | 'disk-full' | 'error'
  startedAt: string | null
  finishedAt: string | null
  modes: Partial<Record<MirrorMode, { updatedAt?: string; error?: string; bytes: number }>>
  bytes: number
  error?: string
}

export interface TarkovDataMirrorOptions {
  storage: MirrorStorage
  fetch?: typeof fetch
  now?: () => Date
  intervalMs?: number
  initialDelayMs?: number
  minimums?: Record<string, number>
  log?: (message: string) => void
}

function collectionCount(payload: unknown, endpoint: string) {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root
  const aliases: Record<string, string[]> = { hideout: ['hideout', 'hideoutStations'], mobs: ['mobs', 'bosses'] }
  const value = [endpoint, ...(aliases[endpoint] ?? [])].map((key) => data[key]).find((entry) => Array.isArray(entry) || (entry && typeof entry === 'object'))
  return Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0
}

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error)
  if (value.includes('mount')) return 'mount-missing'
  if (value.includes('free space')) return 'disk-full'
  return value.replace(/https?:\/\/\S+/g, 'upstream').slice(0, 160)
}

export class TarkovDataMirror {
  private readonly fetcher: typeof fetch
  private readonly now: () => Date
  private readonly minimums: Record<string, number>
  private running: Promise<void> | null = null
  private initial: ReturnType<typeof setTimeout> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private current: DataMirrorStatus = { state: 'idle', startedAt: null, finishedAt: null, modes: {}, bytes: 0 }

  constructor(private readonly options: TarkovDataMirrorOptions) {
    this.fetcher = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date())
    this.minimums = { ...MINIMUMS, ...options.minimums }
  }

  status(): DataMirrorStatus { return { ...this.current, modes: structuredClone(this.current.modes) } }

  start() {
    if (this.timer || this.initial) return
    const kick = () => { void this.run().catch(() => undefined) }
    this.initial = setTimeout(kick, this.options.initialDelayMs ?? 10_000)
    this.initial.unref?.()
    this.timer = setInterval(kick, this.options.intervalMs ?? DAY)
    this.timer.unref?.()
  }

  stop() {
    if (this.initial) clearTimeout(this.initial)
    if (this.timer) clearInterval(this.timer)
    this.initial = this.timer = null
  }

  run() {
    if (this.running) return this.running
    this.running = this.pass().finally(() => { this.running = null })
    return this.running
  }

  private async pass() {
    this.current = { state: 'running', startedAt: this.now().toISOString(), finishedAt: null, modes: {}, bytes: 0 }
    let failed = 0
    for (const mode of MIRROR_MODES) {
      try {
        const bytes = await this.syncMode(mode)
        this.current.modes[mode] = { updatedAt: this.now().toISOString(), bytes }
        this.current.bytes += bytes
      } catch (error) {
        failed += 1
        const message = safeError(error)
        this.current.modes[mode] = { error: message, bytes: 0 }
        this.options.log?.(`data mirror ${mode}: ${message}`)
        if (message === 'mount-missing') this.current.state = 'mount-missing'
        else if (message === 'disk-full') this.current.state = 'disk-full'
      }
    }
    if (!['mount-missing', 'disk-full'].includes(this.current.state)) this.current.state = failed === 0 ? 'done' : failed < MIRROR_MODES.length ? 'degraded' : 'error'
    this.current.finishedAt = this.now().toISOString()
  }

  private async syncMode(mode: MirrorMode) {
    const slot = `dataset-${mode}`
    const previous = await this.options.storage.generation(slot)
    const old = previous?.metadata as unknown as DatasetMetadata | undefined
    const transaction = await this.options.storage.begin(slot)
    const validators: Record<string, Validator> = {}
    const counts: Record<string, number> = {}
    let downloadedBytes = 0
    try {
      const names = [...MIRROR_ENDPOINTS.flatMap((name) => [name, ...(TRANSLATED.has(name) ? [`${name}_ru`, `${name}_en`] : [])]), ...(mode === 'pvp-season' ? ['season', 'season_ru', 'season_en'] : [])]
      for (const name of names) {
        const prior = old?.validators?.[name]
        const headers: Record<string, string> = { accept: 'application/json', 'accept-encoding': 'gzip', 'user-agent': 'RaidOS-data-mirror/1 (+https://raidos.app)' }
        if (prior?.etag) headers['if-none-match'] = prior.etag
        if (prior?.modified) headers['if-modified-since'] = prior.modified
        const response = await this.fetcher(`https://json.tarkov.dev/${mode}/${name}`, { headers, redirect: 'error', signal: AbortSignal.timeout(60_000) })
        let body: string
        if (response.status === 304) {
          const cached = await this.options.storage.read(slot, `${name}.json`)
          if (!cached) throw new Error(`${name}: 304 without cached body`)
          body = cached.toString('utf8')
        } else {
          if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
          const declared = Number(response.headers.get('content-length'))
          if (declared > MAX_BYTES) throw new Error(`${name}: response too large`)
          body = await response.text()
          if (Buffer.byteLength(body) > MAX_BYTES) throw new Error(`${name}: response too large`)
          downloadedBytes += Number.isFinite(declared) && declared > 0 ? declared : Buffer.byteLength(body)
        }
        let parsed: unknown
        try { parsed = JSON.parse(body) } catch { throw new Error(`${name}: invalid JSON`) }
        const base = name.split('_')[0]!
        const count = collectionCount(parsed, base)
        if (!name.includes('_')) {
          const minimum = this.minimums[base] ?? 0
          const oldCount = old?.counts?.[base] ?? 0
          if (count < minimum || (oldCount > 0 && count < oldCount * 0.6)) throw new Error(`${name}: incomplete dataset (${count})`)
          counts[base] = count
        }
        validators[name] = { ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : prior?.etag ? { etag: prior.etag } : {}), ...(response.headers.get('last-modified') ? { modified: response.headers.get('last-modified')! } : prior?.modified ? { modified: prior.modified } : {}) }
        await transaction.write(`${name}.json`, body)
      }
      await transaction.publish({ mode, validators, counts, downloadedBytes }, async () => {
        for (const endpoint of ['items', 'tasks', 'maps']) {
          const active = await this.options.storage.read(slot, `${endpoint}.json`)
          if (!active || collectionCount(JSON.parse(active.toString('utf8')), endpoint) < (this.minimums[endpoint] ?? 0)) throw new Error(`published ${endpoint} failed smoke check`)
        }
      })
      return downloadedBytes
    } catch (error) {
      await transaction.abort()
      throw error
    }
  }
}
