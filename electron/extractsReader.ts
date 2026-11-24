/**
 * The game's exit list (report №105, owner 09.11.2026: «при двойном нажатии О… появляется окно выходов. Тебе нужно читать
 * эти выходы»): a quick double O in the raid shows the exits at the top right of the screen for a few seconds. The key is
 * only watched (GetAsyncKeyState, experimental/index.ts), never pressed; the app copies the top-right corner of the game's
 * display (GDI, the same way as the item lookup), turns it into dark text on white and reads it. The text goes to the
 * page, which parses and matches it (src/maps/raidExtracts.ts). Any resolution: the corner is a share of the display, its
 * width measured by the height (the game's interface scales by the height, so a 21:9 screen keeps the same corner).
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, nativeImage, screen, type NativeImage } from 'electron'
import { recognizeRegion } from './screenOcr.js'
import { gameLanguageNow } from './ocrEngine.js'
import type { GameLanguage } from '../src/import/gameLanguage.js'
import { anyGameWord, languageWords } from '../src/import/gameWordPatterns.js'
import { captureScreenRegion, foregroundDisplayMode, visibleGameRect } from './experimental/win32.js'

export interface ScreenRect { x: number; y: number; width: number; height: number }

/**
 * Where the game's picture is (physical pixels): its window, wherever the pointer is — the owner plays on a 3440×1440
 * screen with a 1920×1080 one beside it (19.11.2026: «опять нажимаю О… ничего не происходит»), and the display under the
 * pointer, which the game hides in a raid, may be the other one. The pointer's display only when the window is not found.
 */
export function listArea(game: ScreenRect | null, pointerDisplay: ScreenRect): ScreenRect {
  return game && game.width > 0 && game.height > 0 ? game : pointerDisplay
}

/** The top-right corner the list is read from (CORNER), inside the game's picture. */
export function cornerRect(area: ScreenRect): ScreenRect {
  const height = Math.round(area.height * CORNER.height)
  const width = Math.min(area.width, Math.round(area.height * CORNER.width))
  return { x: area.x + area.width - width, y: area.y, width, height }
}

/** The thin strip inside the list's green header (HEADER_STRIP). */
export function headerStripRect(area: ScreenRect): ScreenRect {
  const h = area.height
  return {
    x: area.x + area.width - Math.round(h * HEADER_STRIP.from),
    y: area.y + Math.round(h * HEADER_STRIP.top),
    width: Math.round(h * (HEADER_STRIP.from - HEADER_STRIP.to)),
    height: Math.max(2, Math.round(h * HEADER_STRIP.height)),
  }
}

function pointerDisplay(): ScreenRect {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return process.platform === 'win32' ? screen.dipToScreenRect(null, display.bounds) : display.bounds
}

const gameArea = () => listArea(visibleGameRect(), pointerDisplay())

/** Two presses this close make a «double O». */
export const DOUBLE_PRESS_MS = 550
/** The list seen on screen (its header): read after this, and once more a little later (the better reading wins). */
const READ_DELAYS_MS = [450, 1100]
/**
 * One O in the raid (owner, 18.11.2026: «по нажатию один раз буквы O… включается сканирование через 3 секунды и смотрит
 * какие выходы»): the list is read 3 s after the press, and once more a little later. The key's place counts, not the
 * keyboard's language (the virtual key of that key is O in the Russian layout too).
 */
export const AFTER_PRESS_MS = [3000, 3700]
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

async function readCorner(model: string) {
  const corner = cornerRect(gameArea())
  const shot = captureScreenRegion(corner.x, corner.y, corner.width, corner.height)
  if (!shot) return { text: '', corner, image: null }
  const image = nativeImage.createFromBitmap(listForOcr(shot.data, shot.width, shot.height), { width: shot.width, height: shot.height })
  return { text: await recognizeRegion(image, model).catch(() => ''), corner, image }
}

/** How often the header strip is looked at, and how long after a reading the same open list is not read again. */
const HEADER_POLL_MS = 500
const HEADER_REREAD_MS = 20_000

/**
 * While the game is in front: the list's header appearing (or still open after a while) starts a reading, as a double O
 * does. A few kilobytes copied twice a second; nothing while the game is not in front or runs exclusive full screen.
 */
export function watchExtractsHeader(gameInFront: () => boolean, send: (payload: ExtractsPayload) => void) {
  let open = false
  let lastRead = 0
  const timer = setInterval(() => {
    if (process.platform !== 'win32' || !gameInFront() || foregroundDisplayMode() === 'exclusive') { open = false; return }
    const at = headerStripRect(gameArea())
    const strip = captureScreenRegion(at.x, at.y, at.width, at.height)
    const now = strip ? headerShare(strip.data, strip.width, strip.height) >= HEADER_MIN_SHARE : false
    if (now && (!open || Date.now() - lastRead >= HEADER_REREAD_MS)) {
      lastRead = Date.now()
      void readExtractsPanel(send, READ_DELAYS_MS, 'header')
    }
    open = now
  }, HEADER_POLL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

/** What goes to the page: the list's text, when it was read, and the game's language it was read in. */
export interface ExtractsPayload { text: string; at: number; language: GameLanguage }

/** An O while the game is in front (or the list seen): reads the list after `delays` and hands the text over (`send`). */
export async function readExtractsPanel(send: (payload: ExtractsPayload) => void, delays: readonly number[] = AFTER_PRESS_MS, trigger: 'key' | 'header' = 'key') {
  if (busy) return
  // An exclusive full-screen game hides from screen copies.
  if (foregroundDisplayMode() === 'exclusive') { void logReading({ trigger, outcome: 'exclusive-full-screen' }); return }
  busy = true
  // The game's language: its model reads the list, its words count the list's lines (listWords).
  const { language, model } = await gameLanguageNow().catch(() => ({ language: 'ru' as GameLanguage, model: 'rus+eng' }))
  const started = Date.now()
  const reads: Array<{ after: number; ms: number; chars: number; words: number }> = []
  let best = ''
  let bestImage: NativeImage | null = null
  let corner: ScreenRect | null = null
  try {
    let waited = 0
    for (const delay of delays) {
      await new Promise((resolve) => setTimeout(resolve, delay - waited))
      waited = delay
      const at = Date.now()
      const read = await readCorner(model)
      corner = read.corner
      const text = read.text
      reads.push({ after: at - started, ms: Date.now() - at, chars: text.trim().length, words: listWords(text, language) })
      // the better reading: more of the list's words, else more text (the names are matched without them, raidExtracts.ts)
      if (listWords(text, language) > listWords(best, language) || (listWords(text, language) === listWords(best, language) && text.trim().length > best.trim().length)) { best = text; bestImage = read.image }
    }
    if (best) send({ text: best, at: Date.now(), language })
  } finally {
    busy = false
    void logReading({ trigger, outcome: best ? 'sent' : 'nothing-read', corner, reads, text: best, language }, bestImage)
  }
}

/** The list's own words in a reading: «ВЫХОД» / «EXFIL», and the game's own («脱出地点», «撤离点»: src/import/gameWords.ts). */
export function listWords(value: string, language?: GameLanguage | null) {
  const own = (languageWords(language)?.words.exits.exfil ?? []).filter((word) => !/^exfil$/i.test(word))
  const extra = own.length ? (value.match(new RegExp(anyGameWord(own), 'giu')) ?? []).length : 0
  return (value.match(/ВЫХ|EXF|BЫX/gi) ?? []).length + extra
}

/** The last readings kept for a look into a report (owner, 19.11.2026: nothing happened after O), like the item lookups'. */
const READINGS_KEPT = 20
export const exitReadingsDir = () => join(app.getPath('userData'), 'raid-exits')

/** One reading's record: what started it, where it copied, what it read, and the picture it read. Diagnostics only. */
async function logReading(entry: Record<string, unknown>, image: NativeImage | null = null) {
  try {
    const dir = exitReadingsDir()
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await writeFile(join(dir, `${stamp}.json`), `${JSON.stringify(entry, null, 2)}
`)
    if (image) await writeFile(join(dir, `${stamp}.png`), image.resize({ width: Math.round(image.getSize().width / 2) }).toPNG())
    const files = (await readdir(dir)).sort()
    const stamps = [...new Set(files.map((name) => name.split('.')[0]!))]
    const keep = new Set(stamps.slice(-READINGS_KEPT))
    for (const name of files) if (!keep.has(name.split('.')[0]!)) await rm(join(dir, name), { force: true })
  } catch { /* diagnostics only */ }
}
