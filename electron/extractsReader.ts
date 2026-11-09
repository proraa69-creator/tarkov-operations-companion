/**
 * The game's exit list (report №105, owner 09.11.2026: «при двойном нажатии О… появляется окно выходов. Тебе нужно читать
 * эти выходы»): a quick double O in the raid shows the exits at the top right of the screen for a few seconds. The key is
 * only watched (GetAsyncKeyState, experimental/index.ts), never pressed; the app copies the top-right corner of the game's
 * display (GDI, the same way as the item lookup), turns it into dark text on white and reads it. The text goes to the
 * page, which parses and matches it (src/maps/raidExtracts.ts). Any resolution: the corner is a share of the display, its
 * width measured by the height (the game's interface scales by the height, so a 21:9 screen keeps the same corner).
 */
import { nativeImage, screen } from 'electron'
import { recognizeRegion } from './screenOcr.js'
import { captureScreenRegion, foregroundDisplayMode } from './experimental/win32.js'

/** Two presses this close make a «double O». */
export const DOUBLE_PRESS_MS = 550
/** The list fades in: read after this, and once more a little later (the better reading wins). */
const READ_DELAYS_MS = [450, 1100]
/** The corner: its height and its width, as shares of the display's height (16:9: about 47 % of the width). */
const CORNER = { height: 0.45, width: 0.84 }

let busy = false

/** Rising edges of the O key → whether this one completes a double press. */
export function createDoublePress(windowMs = DOUBLE_PRESS_MS) {
  let last = 0
  return (now: number) => {
    const double = last > 0 && now - last <= windowMs
    last = double ? 0 : now
    return double
  }
}

/** Dark text on white from the game's light (white, red, green) letters on a dark list: the brightest channel, inverted. */
export function listForOcr(data: Uint8Array, width: number, height: number) {
  const out = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    const b = data[index * 4]!, g = data[index * 4 + 1]!, r = data[index * 4 + 2]!
    const light = Math.max(r, g, b)
    const value = light > 150 ? 0 : light < 90 ? 255 : 255 - Math.round((light - 90) * (255 / 60))
    out[index * 4] = value; out[index * 4 + 1] = value; out[index * 4 + 2] = value; out[index * 4 + 3] = 255
  }
  return out
}

async function readCorner() {
  const point = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point)
  const physical = process.platform === 'win32' ? screen.dipToScreenRect(null, display.bounds) : display.bounds
  const height = Math.round(physical.height * CORNER.height)
  const width = Math.min(physical.width, Math.round(physical.height * CORNER.width))
  const left = physical.x + physical.width - width
  const shot = captureScreenRegion(left, physical.y, width, height)
  if (!shot) return ''
  const image = nativeImage.createFromBitmap(listForOcr(shot.data, shot.width, shot.height), { width: shot.width, height: shot.height })
  return recognizeRegion(image).catch(() => '')
}

/** A double O while the game is in front: reads the list and hands the text over (`send`). */
export async function readExtractsPanel(send: (payload: { text: string; at: number }) => void) {
  // An exclusive full-screen game hides from screen copies.
  if (busy || foregroundDisplayMode() === 'exclusive') return
  busy = true
  try {
    let best = ''
    let waited = 0
    for (const delay of READ_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delay - waited))
      waited = delay
      const text = await readCorner()
      if ((text.match(/ВЫХ|EXF|BЫX/gi) ?? []).length > (best.match(/ВЫХ|EXF|BЫX/gi) ?? []).length) best = text
    }
    if (best) send({ text: best, at: Date.now() })
  } finally {
    busy = false
  }
}
