import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ITEM_IMAGE_SCHEME } from './itemImages.js'

/**
 * The part pictures of «Сборка оружия» (src/arsenal/partPictures.ts: one picture, one depth picture per module, rendered by the game
 * in its offline copy) ship inside the app in dist/gun-parts. The page is a file:// page, where fetch cannot read files: they come
 * through the app's own scheme, `raidos-img://parts/<file>`, from that folder only, by a strict name.
 */
const PART_FILE = /^(?:[0-9a-f]{24}(?:\.webp|\.d\.png)|index\.json)$/
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', json: 'application/json' }

export function gunPartFile(url: string): string | null {
  try {
    const parsed = new URL(url)
    const file = parsed.pathname.replace(/^\//, '')
    return parsed.protocol === `${ITEM_IMAGE_SCHEME}:` && parsed.hostname === 'parts' && !parsed.search && PART_FILE.test(file) ? file : null
  } catch {
    return null
  }
}

export function createGunPartResponder(folder: string, read: (path: string) => Promise<Uint8Array> = readFile) {
  return async (url: string): Promise<Response> => {
    const file = gunPartFile(url)
    const headers = { 'access-control-allow-origin': '*' }
    if (!file) return new Response(null, { status: 404, headers })
    try {
      const bytes = await read(join(folder, file))
      return new Response(Buffer.from(bytes), { status: 200, headers: { ...headers, 'content-type': TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream', 'cache-control': 'public, max-age=604800' } })
    } catch {
      return new Response(null, { status: 404, headers })
    }
  }
}
