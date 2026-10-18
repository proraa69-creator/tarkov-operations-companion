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
/** A picture the server does not have is asked again only after this (the cache job adds files over time). */
const MISSING_MS = 10 * 60_000
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

/** The protocol answer: cache → server → 404. `folder`: where the files are kept (userData/item-images). */
export function createItemImageResponder(folder: string, fetchImpl: Fetch = fetch) {
  const missing = new Map<string, number>()
  const pending = new Map<string, Promise<Uint8Array | null>>()

  async function download(file: string): Promise<Uint8Array | null> {
    const response = await fetchImpl(`${ITEM_IMAGE_ORIGIN}${file}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) {
      if (response.status === 404) missing.set(file, Date.now())
      return null
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_BYTES) return null
    // written aside first, so a half-written file is never served
    const target = join(folder, file)
    void mkdir(folder, { recursive: true })
      .then(() => writeFile(`${target}.part`, bytes))
      .then(() => rename(`${target}.part`, target))
      .catch(() => undefined)
    return bytes
  }

  async function load(file: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await readFile(join(folder, file))) } catch { /* not kept yet */ }
    const lost = missing.get(file)
    if (lost && Date.now() - lost < MISSING_MS) return null
    return download(file).catch(() => null)
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
