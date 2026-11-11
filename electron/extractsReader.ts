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
/**
 * The corner: its height and its width, as shares of the display's height. Measured on the owner's 3440×1440 screenshots: the
 * list is 0.53 of the height wide from the right edge, its rows 0.048 high; twelve exits and transits reach 0.65. A wider
 * corner took in the scenery, whose bits the OCR put before «ВЫХОД» (owner, 11.11.2026: «Мы делали эту функцию… она не
 * работала»); a narrower one is also small enough to be read at twice its size (screenOcr.ts recognizeRegion).
 */
export const CORNER = { height: 0.7, width: 0.56 }

/**
 * The list's green header («Найдите зону выхода»), sought in a thin strip without any key (owner, 11.11.2026): the game
 * started by the BSG launcher runs elevated, and Windows then hides its keys from the app, so a double O was never seen.
 * The strip: 2.2–3.4 % of the height down, from 0.50 to 0.20 of the height left of the right edge (inside the header).
 */
export const HEADER_STRIP = { top: 0.022, height: 0.012, from: 0.5, to: 0.2 }

/** The header covers 59–62 % of the strip (its icon and words the rest); 316 other screenshots stay under 30 %. */
export const HEADER_MIN_SHARE = 0.45

/** The header's lime green (#7cb518-like) under the game's light: green bright, red half of it, blue low. */
export function headerShare(data: Uint8Array, width: number, height: number) {
  let lime = 0
  for (let index = 0; index < width * height; index += 1) {
    const b = data[index * 4]!, g = data[index * 4 + 1]!, r = data[index * 4 + 2]!
    if (g >= 140 && g - r >= 25 && r >= 60 && b <= 90) lime += 1
  }
  return width * height ? lime / (width * height) : 0
}

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

/** How often the header strip is looked at, and how long after a reading the same open list is not read again. */
const HEADER_POLL_MS = 500
const HEADER_REREAD_MS = 20_000

/**
 * While the game is in front: the list's header appearing (or still open after a while) starts a reading, as a double O
 * does. A few kilobytes copied twice a second; nothing while the game is not in front or runs exclusive full screen.
 */
export function watchExtractsHeader(gameInFront: () => boolean, send: (payload: { text: string; at: number }) => void) {
  let open = false
  let lastRead = 0
  const timer = setInterval(() => {
    if (process.platform !== 'win32' || !gameInFront() || foregroundDisplayMode() === 'exclusive') { open = false; return }
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const physical = screen.dipToScreenRect(null, display.bounds)
    const h = physical.height
    const left = physical.x + physical.width - Math.round(h * HEADER_STRIP.from)
    const width = Math.round(h * (HEADER_STRIP.from - HEADER_STRIP.to))
    const strip = captureScreenRegion(left, physical.y + Math.round(h * HEADER_STRIP.top), width, Math.max(2, Math.round(h * HEADER_STRIP.height)))
    const now = strip ? headerShare(strip.data, strip.width, strip.height) >= HEADER_MIN_SHARE : false
    if (now && (!open || Date.now() - lastRead >= HEADER_REREAD_MS)) {
      lastRead = Date.now()
      void readExtractsPanel(send)
    }
    open = now
  }, HEADER_POLL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
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
