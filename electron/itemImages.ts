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

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }

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
  let lastReport = 0

  async function fromSource(source: ItemImageSource, file: string): Promise<Uint8Array | string> {
    const url = source.url(file)
    if (!url) return 'no address'
    try {
      const response = await source.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response.ok) return `HTTP ${response.status}`
      const bytes = new Uint8Array(await response.arrayBuffer())
      return bytes.length && bytes.length <= MAX_BYTES ? bytes : `size ${bytes.length}`
    } catch (error) {
      return error instanceof Error ? `${error.name}: ${error.message}` : 'failed'
    }
  }

  async function download(file: string): Promise<Uint8Array | null> {
    const failures: Record<string, string> = {}
    for (const source of sources) {
      const result = await fromSource(source, file)
      if (typeof result === 'string') { failures[source.name] = result; continue }
      // written aside first, so a half-written file is never served
      const target = join(folder, file)
      void mkdir(folder, { recursive: true })
        .then(() => writeFile(`${target}.part`, result))
        .then(() => rename(`${target}.part`, target))
        .catch(() => undefined)
      return result
    }
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
    return new Response(Buffer.from(bytes), { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' } })
  }
}
