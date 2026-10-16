import type { GrayPicture } from '../levelDigits'
import lines from './levelDigits.json'

/**
 * Lines in the game's font (Bender), light on dark as the game draws them, cut to their ink (rendered for the tests of
 * 14.10.2026): «1023456789» at 15 and 20 px and bold at 18, the player's «| 39» at 18 and 22 px, «| 59», «| 50»,
 * «LVL 39» and «LVL 37» of the traders' screen.
 */
const fixtures = new Map((lines as Array<{ name: string; width: number; height: number; gray: string }>).map((line) => [line.name, line]))

/** A line as the close-up the app reads (×3, electron/screenOcr.ts), here resized bilinearly. */
export function closeUp(name: string, scale = 3): GrayPicture {
  const fixture = fixtures.get(name)
  if (!fixture) throw new Error(`no fixture ${name}`)
  const { width, height } = fixture
  const pixels = Uint8Array.from(atob(fixture.gray), (char) => char.charCodeAt(0))
  const w = width * scale, h = height * scale
  const gray = new Uint8Array(w * h)
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const sx = Math.min(width - 1, Math.max(0, (x + 0.5) / scale - 0.5)), sy = Math.min(height - 1, Math.max(0, (y + 0.5) / scale - 0.5))
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1)
    const fx = sx - x0, fy = sy - y0
    const top = pixels[y0 * width + x0]! * (1 - fx) + pixels[y0 * width + x1]! * fx
    const bottom = pixels[y1 * width + x0]! * (1 - fx) + pixels[y1 * width + x1]! * fx
    gray[y * w + x] = Math.round(top * (1 - fy) + bottom * fy)
  }
  return { width: w, height: h, gray }
}

/** The whole picture as a box. */
export const wholeBox = (picture: GrayPicture) => ({ x0: 0, y0: 0, x1: picture.width - 1, y1: picture.height - 1 })
