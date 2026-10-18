/**
 * Item pictures of the desktop app through the main process (owner, 18.10.2026: «не отображаются картинки» in the
 * weapon builder and the hideout, while the same files answered 200 from the server).
 *
 * The pages ask for `https://raidos.app/v1/item-images/<file>`; Chromium fetched those itself, on its own network path
 * (system proxy, its DNS), while every data request goes through the main process — so on some PCs the data came and
 * the pictures did not, except the few already in Chromium's cache. Now such a request is redirected to
 * `raidos-img://item/<file>` and answered here: the file from the local cache, else downloaded the same way as the data
 * (Node's fetch) and kept. The pages and the catalogue keep their https addresses (the item lookup compares the
 * catalogue icons too), only the transport changes.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const ITEM_IMAGE_SCHEME = 'raidos-img'
export const ITEM_IMAGE_ORIGIN = 'https://raidos.app/v1/item-images/'
/** The server's own file names (server/src/routes/itemImages.ts). */
const FILE = /^[a-z0-9]{16,48}-(?:icon|grid|base)\.(?:webp|jpg|jpeg|png)$/
/** A picture no source has is asked again only after this (right after a server deploy the files may be missing). */
const MISSING_MS = 60_000
const TIMEOUT_MS = 20_000
const MAX_BYTES = 2 * 1024 * 1024

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' }

/** The local address for a server picture address, or null for anything else (left to Chromium). */
export function itemImageRedirect(url: string): string | null {
  if (!url.startsWith(ITEM_IMAGE_ORIGIN)) return null
  const file = url.slice(ITEM_IMAGE_ORIGIN.length)
  return FILE.test(file) ? `${ITEM_IMAGE_SCHEME}://item/${file}` : null
}

/** The file name a local address asks for, or null. */
export function itemImageFile(url: string): string | null {
  try {
    const parsed = new URL(url)
    const file = parsed.pathname.replace(/^\//, '')
    return parsed.protocol === `${ITEM_IMAGE_SCHEME}:` && parsed.hostname === 'item' && !parsed.search && FILE.test(file) ? file : null
  } catch {
    return null
  }
}

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>
/** One place a picture may come from: its address for the file and how it is fetched. */
export interface ItemImageSource { name: string; url: (file: string) => string | null; fetch: Fetch }

/** A source that has not answered by then gets company: the next one starts alongside (owner, 18.10.2026: «опять проблема с загрузкой карт»). */
export const HEDGE_MS = 1200
/** A source that failed on the network (not a 404) goes to the end of the line for this long. */
const DOWN_MS = 60_000
const NETWORK_FAILURE = /abort|timeout|fetch failed|network|socket|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ERR_/i

/**
 * Asks the sources for one file. They were asked strictly one after another, each with a 20 s timeout: on a PC where
 * Node's own network hangs (a system proxy it does not use) every map tile waited 20 s before Chromium's network was
 * tried — hundreds of tiles, no map. Now the next source starts as soon as one fails or after HEDGE_MS without an
 * answer; the first file wins and the others are cancelled. The source that won goes first next time, one that failed on
 * the network goes last for DOWN_MS, so after the first files a PC asks only the source that works for it.
 */
export function createSourceRace(sources: ItemImageSource[], maxBytes: number) {
  let preferred: ItemImageSource | null = null
  const downUntil = new Map<ItemImageSource, number>()

  function order(key: string) {
    const now = Date.now()
    const usable = sources.filter((source) => source.url(key))
    const up = usable.filter((source) => (downUntil.get(source) ?? 0) <= now)
    const first = preferred && up.includes(preferred) ? [preferred] : []
    return [...first, ...up.filter((source) => !first.includes(source)), ...usable.filter((source) => !up.includes(source))]
  }

  async function attempt(source: ItemImageSource, url: string, signal: AbortSignal): Promise<Uint8Array | string> {
    try {
      const response = await source.fetch(url, { signal })
      if (!response.ok) return `HTTP ${response.status}`
      const bytes = new Uint8Array(await response.arrayBuffer())
      return bytes.length && bytes.length <= maxBytes ? bytes : `size ${bytes.length}`
    } catch (error) {
      return error instanceof Error ? `${error.name}: ${error.message}` : 'failed'
    }
  }

  return (key: string) => new Promise<{ bytes: Uint8Array } | { failures: Record<string, string> }>((resolve) => {
    const line = order(key)
    const failures: Record<string, string> = {}
    const controllers: AbortController[] = []
    let next = 0
    let running = 0
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: { bytes: Uint8Array } | { failures: Record<string, string> }) => {
      done = true
      clearTimeout(timer)
      for (const controller of controllers) controller.abort()
      resolve(result)
    }
    const startNext = () => {
      clearTimeout(timer)
      if (done) return
      if (next >= line.length) {
        if (!running) finish({ failures })
        return
      }
      const source = line[next++]
      const url = source.url(key)!
      const controller = new AbortController()
      controllers.push(controller)
      running += 1
      void attempt(source, url, AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)])).then((result) => {
        running -= 1
        const cancelled = controller.signal.aborted
        if (typeof result === 'string') {
          if (!cancelled && NETWORK_FAILURE.test(result)) downUntil.set(source, Date.now() + DOWN_MS)
          if (preferred === source && !cancelled) preferred = null
          if (done) return
          failures[source.name] = result
          startNext()
          return
        }
        downUntil.delete(source)
        if (done) return
        preferred = source
        finish({ bytes: result })
      })
      if (next < line.length) timer = setTimeout(startNext, HEDGE_MS)
    }
    startNext()
  })
}

/**
 * tarkov.dev's own file of a server picture name (the last resort): `-icon` stays, `-grid`/`-base` are
 * `-grid-image`/`-base-image` there.
 */
export function tarkovDevImageUrl(file: string) {
  const match = /^([a-f0-9]{24})-(icon|grid|base)\.webp$/.exec(file)
  if (!match) return null
  return `https://assets.tarkov.dev/${match[1]}-${match[2] === 'icon' ? 'icon' : `${match[2]}-image`}.webp`
}

/**
 * The protocol answer: the kept file, else the first source that has it (owner, 18.10.2026: «опять не загружаются
 * снимки» — the server alone was not enough on his PC), else 404. A picture no source has is not asked again for
 * MISSING_MS; why the sources failed is written to `last-failure.json` next to the kept files.
 */
export function createItemImageResponder(folder: string, sources: ItemImageSource[]) {
  const missing = new Map<string, number>()
  const pending = new Map<string, Promise<Uint8Array | null>>()
  const race = createSourceRace(sources, MAX_BYTES)
  let lastReport = 0

  async function download(file: string): Promise<Uint8Array | null> {
    const result = await race(file)
    if ('bytes' in result) {
      // written aside first, so a half-written file is never served
      const target = join(folder, file)
      void mkdir(folder, { recursive: true })
        .then(() => writeFile(`${target}.part`, result.bytes))
        .then(() => rename(`${target}.part`, target))
        .catch(() => undefined)
      return result.bytes
    }
    const { failures } = result
    missing.set(file, Date.now())
    if (Date.now() - lastReport > 60_000) {
      lastReport = Date.now()
      void mkdir(folder, { recursive: true })
        .then(() => writeFile(join(folder, 'last-failure.json'), JSON.stringify({ at: new Date().toISOString(), file, failures }, null, 2)))
        .catch(() => undefined)
    }
    return null
  }

  async function load(file: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await readFile(join(folder, file))) } catch { /* not kept yet */ }
    const lost = missing.get(file)
    if (lost && Date.now() - lost < MISSING_MS) return null
    return download(file)
  }

  // one read or download per file at a time: a page shows the same picture many times
  function bytesOf(file: string): Promise<Uint8Array | null> {
    let job = pending.get(file)
    if (!job) {
      job = load(file).finally(() => pending.delete(file))
      pending.set(file, job)
    }
    return job
  }

  return async (url: string): Promise<Response> => {
    const file = itemImageFile(url)
    const bytes = file ? await bytesOf(file) : null
    if (!file || !bytes) return new Response(null, { status: 404 })
    const type = TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream'
    return new Response(Buffer.from(bytes), { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' } })
  }
}

/**
 * Map files the same way (owner, 18.10.2026: «у людей не грузится карта»): tiles of «Спутник» and the schemes of
 * «Схема» (`https://raidos.app/v1/map-tiles/maps/…`) come through the main process too — the schemes are read with
 * fetch, which the page's policy did not even allow to raidos.app. Kept in memory only (up to MAP_CACHE_BYTES): the
 * tiles of every map would take gigabytes on the disk.
 */
export const MAP_FILE_ORIGIN = 'https://raidos.app/v1/map-tiles/'
const MAP_PATH = /^maps\/[A-Za-z0-9_./{}-]+\.(?:png|jpg|jpeg|webp|svg)$/
const MAP_CACHE_BYTES = 64 * 1024 * 1024

export function mapFileRedirect(url: string): string | null {
  if (!url.startsWith(MAP_FILE_ORIGIN)) return null
  const path = url.slice(MAP_FILE_ORIGIN.length)
  return MAP_PATH.test(path) && !path.includes('..') ? `${ITEM_IMAGE_SCHEME}://map/${path}` : null
}

export function mapFilePath(url: string): string | null {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/^\//, '')
    return parsed.protocol === `${ITEM_IMAGE_SCHEME}:` && parsed.hostname === 'map' && !parsed.search && MAP_PATH.test(path) && !path.includes('..') ? path : null
  } catch {
    return null
  }
}

/** tarkov.dev's own address of a map file (the last source). */
export const tarkovDevMapUrl = (path: string) => `https://assets.tarkov.dev/${path}`

export function createMapFileResponder(sources: ItemImageSource[], cacheBytes = MAP_CACHE_BYTES) {
  const kept = new Map<string, Uint8Array>()
  let keptBytes = 0
  const missing = new Map<string, number>()
  const pending = new Map<string, Promise<Uint8Array | null>>()
  const keep = (path: string, bytes: Uint8Array) => {
    kept.set(path, bytes)
    keptBytes += bytes.length
    for (const [oldest, old] of kept) {
      if (keptBytes <= cacheBytes) break
      kept.delete(oldest)
      keptBytes -= old.length
    }
  }
  const race = createSourceRace(sources, 8 * MAX_BYTES)
  async function download(path: string): Promise<Uint8Array | null> {
    const result = await race(path)
    if ('bytes' in result) {
      keep(path, result.bytes)
      return result.bytes
    }
    missing.set(path, Date.now())
    return null
  }
  function bytesOf(path: string): Promise<Uint8Array | null> {
    const known = kept.get(path)
    if (known) {
      // most recently used last, so the oldest go first
      kept.delete(path)
      kept.set(path, known)
      return Promise.resolve(known)
    }
    const lost = missing.get(path)
    if (lost && Date.now() - lost < MISSING_MS) return Promise.resolve(null)
    let job = pending.get(path)
    if (!job) {
      job = download(path).finally(() => pending.delete(path))
      pending.set(path, job)
    }
    return job
  }
  return async (url: string): Promise<Response> => {
    const path = mapFilePath(url)
    const bytes = path ? await bytesOf(path) : null
    if (!path || !bytes) return new Response(null, { status: 404, headers: { 'access-control-allow-origin': '*' } })
    const type = TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream'
    return new Response(Buffer.from(bytes), { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=604800', 'access-control-allow-origin': '*' } })
  }
}
