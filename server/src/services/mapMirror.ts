import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, statfs, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * «Скачай все интерактивные карты к нам на сервер, чтобы не зависеть ни от кого» (owner, 10.10.2026; tarkov.dev gave
 * permission): the API keeps a copy of tarkov.dev's map tiles (the «Спутник» render of every map and floor), the floor
 * schemes (SVG) and maps.json under <data dir>/map-mirror, and serves them at /v1/map-tiles/… (routes/mapTiles.ts).
 * The app takes tiles from tarkov.dev and falls back to this copy when a tile does not come.
 *
 * The tile sets come from maps.json (every tilePath of every map and floor). A set is crawled once over its whole
 * pyramid (x, y from 0 at every zoom of the set; empty tiles answer 404 and are skipped) and marked complete; a later
 * maps.json with a new path (a new map version) mirrors that set too. Stops when the disk has less than `minFreeBytes`
 * free; runs again every week. Polite: a few requests at a time, a clear User-Agent.
 */
export const MAPS_JSON_URL = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json'
const ASSETS = 'https://assets.tarkov.dev/'
export const TILE_PATH = /^maps\/[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*\/\d{1,2}\/\d{1,5}\/\d{1,5}\.png$/
export const SVG_PATH = /^maps\/svg\/[A-Za-z0-9_-]+\.svg$/
const MAX_TILE = 4 * 1024 * 1024
const MAX_SVG = 40 * 1024 * 1024

export interface TileSet { path: string; minZoom: number; maxZoom: number; tileSize: number }
export interface MirrorStatus {
  state: 'idle' | 'running' | 'done' | 'error' | 'disk-full'
  sets: number
  completeSets: number
  tiles: { done: number; total: number; saved: number; missing: number }
  svgs: number
  bytes: number
  startedAt: string | null
  finishedAt: string | null
  error?: string
}

interface RawLayer { tilePath?: unknown; svgPath?: unknown }
interface RawMap extends RawLayer { minZoom?: unknown; maxZoom?: unknown; tileSize?: unknown; layers?: RawLayer[] }

/** «https://assets.tarkov.dev/maps/x/main/{z}/{x}/{y}.png» → «maps/x/main»; anything else → undefined. */
export function tileSetPath(url: unknown) {
  if (typeof url !== 'string') return undefined
  const match = /^https:\/\/assets\.tarkov\.dev\/(maps\/[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*)\/\{z\}\/\{x\}\/\{y\}\.png$/.exec(url)
  return match?.[1]
}

export function svgFilePath(url: unknown) {
  if (typeof url !== 'string') return undefined
  const match = /^https:\/\/assets\.tarkov\.dev\/(maps\/svg\/[A-Za-z0-9_-]+\.svg)$/.exec(url)
  return match?.[1]
}

/** Every tile set and scheme in maps.json (deduplicated). */
export function mirrorPlan(roots: unknown): { sets: TileSet[]; svgs: string[] } {
  const sets = new Map<string, TileSet>()
  const svgs = new Set<string>()
  for (const root of Array.isArray(roots) ? roots as Array<{ maps?: RawMap[] }> : []) {
    for (const map of root?.maps ?? []) {
      const minZoom = Number.isInteger(map.minZoom) ? Math.max(0, map.minZoom as number) : 1
      const maxZoom = Number.isInteger(map.maxZoom) ? Math.min(7, map.maxZoom as number) : 6
      const tileSize = Number.isInteger(map.tileSize) && (map.tileSize as number) >= 64 ? map.tileSize as number : 256
      for (const entry of [map, ...(Array.isArray(map.layers) ? map.layers : [])]) {
        const path = tileSetPath(entry.tilePath)
        if (path && !sets.has(path)) sets.set(path, { path, minZoom, maxZoom, tileSize })
        const svg = svgFilePath(entry.svgPath)
        if (svg) svgs.add(svg)
      }
    }
  }
  return { sets: [...sets.values()], svgs: [...svgs] }
}

/** Tiles per axis at a zoom: the 256-px pyramid, more for smaller tiles (Labs: 175 px). */
export const tilesPerAxis = (zoom: number, tileSize: number) => Math.ceil((2 ** zoom) * 256 / tileSize)

export function setTileCount(set: TileSet) {
  let count = 0
  for (let zoom = set.minZoom; zoom <= set.maxZoom; zoom++) count += tilesPerAxis(zoom, set.tileSize) ** 2
  return count
}

const isPng = (bytes: Buffer) => bytes.length >= 8 && bytes.length <= MAX_TILE && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
const isSvg = (bytes: Buffer) => bytes.length > 0 && bytes.length <= MAX_SVG && /<svg[\s>]/i.test(bytes.subarray(0, 4096).toString('utf8'))
const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

export interface MapMirrorOptions {
  dir: string
  fetch?: typeof fetch
  concurrency?: number
  minFreeBytes?: number
  mapsJsonUrl?: string
  log?: (message: string) => void
}

export class MapMirror {
  private current: MirrorStatus = { state: 'idle', sets: 0, completeSets: 0, tiles: { done: 0, total: 0, saved: 0, missing: 0 }, svgs: 0, bytes: 0, startedAt: null, finishedAt: null }
  private running: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly fetchImpl: typeof fetch
  private readonly concurrency: number
  private readonly minFreeBytes: number

  constructor(private readonly options: MapMirrorOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.concurrency = options.concurrency ?? 6
    this.minFreeBytes = options.minFreeBytes ?? 3 * 1024 ** 3
  }

  get dir() { return this.options.dir }
  status(): MirrorStatus { return { ...this.current, tiles: { ...this.current.tiles } } }

  /** Mirrors in the background: first after `delayMs`, then every `everyMs`. */
  start(delayMs = 60_000, everyMs = 7 * 24 * 3600_000) {
    if (this.timer) return
    const kick = () => { void this.run().catch(() => {}) }
    setTimeout(kick, delayMs).unref?.()
    this.timer = setInterval(kick, everyMs)
    this.timer.unref?.()
  }

  run(): Promise<void> {
    if (this.running) return this.running
    this.running = this.pass().finally(() => { this.running = null })
    return this.running
  }

  private log(message: string) { this.options.log?.(`map mirror: ${message}`) }

  private async get(url: string) {
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(30_000), redirect: 'error', headers: { 'user-agent': 'RaidOS-map-mirror/1 (+https://raidos.app)' } })
    if (response.status === 404 || response.status === 403) return null
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }

  private async save(path: string, bytes: Buffer) {
    const target = join(this.dir, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(`${target}.part`, bytes)
    await rename(`${target}.part`, target)
    this.current.bytes += bytes.length
  }

  private async diskFull() {
    try {
      const info = await statfs(this.dir)
      return info.bavail * info.bsize < this.minFreeBytes
    } catch { return false }
  }

  private async pass() {
    this.current = { ...this.current, state: 'running', startedAt: new Date().toISOString(), finishedAt: null, error: undefined }
    try {
      await mkdir(this.dir, { recursive: true })
      const text = (await this.get(this.options.mapsJsonUrl ?? MAPS_JSON_URL))?.toString('utf8')
      if (!text) throw new Error('maps.json not found')
      const plan = mirrorPlan(JSON.parse(text))
      if (!plan.sets.length) throw new Error('maps.json has no tile sets')
      await this.save('maps.json', Buffer.from(text, 'utf8'))
      this.current.sets = plan.sets.length
      this.current.tiles = { done: 0, total: plan.sets.reduce((sum, set) => sum + setTileCount(set), 0), saved: 0, missing: 0 }

      for (const svg of plan.svgs) {
        const bytes = await this.get(`${ASSETS}${svg}`).catch(() => null)
        if (bytes && isSvg(bytes)) await this.save(svg, bytes)
      }
      this.current.svgs = plan.svgs.filter((svg) => existsSync(join(this.dir, svg))).length

      this.current.completeSets = 0
      for (const set of plan.sets) {
        const marker = join(this.dir, set.path, '.complete')
        const stamp = digest(JSON.stringify(set))
        if ((await readFile(marker, 'utf8').catch(() => '')) === stamp) {
          this.current.completeSets += 1
          this.current.tiles.done += setTileCount(set)
          continue
        }
        if (await this.diskFull()) { this.current.state = 'disk-full'; this.log('stopped: low disk space'); return }
        const failed = await this.crawl(set)
        if (failed === 0) {
          await writeFile(marker, stamp)
          this.current.completeSets += 1
        }
        if (this.current.state === 'disk-full') return
      }
      this.current.state = 'done'
      this.log(`done: ${this.current.completeSets}/${this.current.sets} sets, ${this.current.tiles.saved} tiles saved`)
    } catch (error) {
      this.current.state = 'error'
      this.current.error = error instanceof Error ? error.message : String(error)
      this.log(`error: ${this.current.error}`)
    } finally {
      this.current.finishedAt = new Date().toISOString()
    }
  }

  /** Downloads every tile of the set that is not there yet; returns how many failed (to try again next time). */
  private async crawl(set: TileSet) {
    const queue: string[] = []
    for (let zoom = set.minZoom; zoom <= set.maxZoom; zoom++) {
      const axis = tilesPerAxis(zoom, set.tileSize)
      for (let x = 0; x < axis; x++) for (let y = 0; y < axis; y++) queue.push(`${set.path}/${zoom}/${x}/${y}.png`)
    }
    let failed = 0
    let checked = 0
    const worker = async () => {
      for (;;) {
        const path = queue.shift()
        if (!path) return
        this.current.tiles.done += 1
        if (existsSync(join(this.dir, path))) continue
        if (++checked % 2000 === 0 && await this.diskFull()) { this.current.state = 'disk-full'; queue.length = 0; return }
        try {
          const bytes = await this.get(`${ASSETS}${path}`)
          if (!bytes) { this.current.tiles.missing += 1; continue }
          if (!isPng(bytes)) { failed += 1; continue }
          await this.save(path, bytes)
          this.current.tiles.saved += 1
        } catch {
          failed += 1
        }
      }
    }
    await Promise.all(Array.from({ length: this.concurrency }, worker))
    return failed
  }
}
