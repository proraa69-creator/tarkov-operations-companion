import { readFile } from 'node:fs/promises'
import { openPartPack, PART_PACK_FILE, type PartPack } from '../src/arsenal/partPack.js'
import { ITEM_IMAGE_SCHEME } from './itemImages.js'

/**
 * The part pictures of «Сборка оружия» (src/arsenal/partPictures.ts: one picture, one depth picture per module, rendered by the game
 * in its offline copy) ship inside the app as one encrypted pack, dist/gun-parts.pack (src/arsenal/partPack.ts; owner, 22.11.2026:
 * nobody is to copy them out of the app). The page is a file:// page, where fetch cannot read files: they come through the app's
 * own scheme, `raidos-img://parts/<file>`, each opened from the pack in memory when asked for, by a strict name.
 */
const PART_FILE = PART_PACK_FILE
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', json: 'application/json' }

export function gunPartFile(url: string, host = 'parts', pattern: RegExp = PART_FILE): string | null {
  try {
    const parsed = new URL(url)
    const file = parsed.pathname.replace(/^\//, '')
    return parsed.protocol === `${ITEM_IMAGE_SCHEME}:` && parsed.hostname === host && !parsed.search && pattern.test(file) ? file : null
  } catch {
    return null
  }
}

/** Also the range's pictures (src/range/rangeFigures.ts): `raidos-img://range/<file>` from range-figures.pack. */
export function createGunPartResponder(packPath: string, read: (path: string) => Promise<Uint8Array> = readFile, host = 'parts', pattern: RegExp = PART_FILE) {
  // the pack read once, at the first picture; a pack that could not be read is tried again at the next ask
  let packLoad: Promise<PartPack | null> | null = null
  const pack = () => {
    packLoad ??= read(packPath).then((bytes) => openPartPack(new Uint8Array(bytes))).catch(() => null)
    return packLoad.then((opened) => { if (!opened) packLoad = null; return opened })
  }
  return async (url: string): Promise<Response> => {
    const file = gunPartFile(url, host, pattern)
    const headers = { 'access-control-allow-origin': '*' }
    if (!file) return new Response(null, { status: 404, headers })
    try {
      const bytes = await (await pack())?.file(file)
      if (!bytes) return new Response(null, { status: 404, headers })
      return new Response(Buffer.from(bytes), { status: 200, headers: { ...headers, 'content-type': TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream', 'cache-control': 'public, max-age=604800' } })
    } catch {
      return new Response(null, { status: 404, headers })
    }
  }
}
