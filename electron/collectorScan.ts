import { desktopCapturer, screen } from 'electron'
import { runOcrJob } from './ocrQueue.js'
import { createWorker, idleRelease, ocrLanguagePath, type OcrWorker } from './ocrEngine.js'
import { captureScreenRegion, gameCaptureAvailable, isTarkovTitle, visibleGameRect } from './experimental/win32.js'
import type { Raster } from '../src/kappa/labelScan.js'
import { createLabelReader, toPgm, type FrameReading } from '../src/kappa/labelReader.js'

/**
 * «Сканировать» on the Kappa items page (owner, 12.10.2026: «ищет долго и находит не все предметы… начинает фризить»).
 * One call reads one frame of the game; the page calls again while the player scrolls the stash.
 *   - Only the game's own pixels: its window while the player can see it (one GDI copy, a few ms) — never the whole
 *     desktop, where this app's own list of item names would be read as found.
 *   - Only the item labels (src/kappa/labelScan.ts), enlarged and stacked into one small picture per OCR engine; each
 *     label once per scan, nothing while the frame stays the same (src/kappa/labelReader.ts).
 */
export interface CollectorScan extends FrameReading {
  /** The game's picture was read. */
  gameWindow: boolean
  /** The game is not on screen (closed, minimised or covered): the page asks to open it. */
  waiting?: boolean
}

const ENGINES = 2

let pool: Promise<OcrWorker[]> | null = null
const release = idleRelease(60_000, () => {
  const engines = pool
  pool = null
  void engines?.then((list) => Promise.all(list.map((engine) => engine.terminate()))).catch(() => {})
})

function engines() {
  pool ??= (async () => {
    const langPath = await ocrLanguagePath()
    return Promise.all(Array.from({ length: ENGINES }, async () => {
      const engine = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
      // Sparse text: one short label per line, with room around it. The picture carries no resolution: say it.
      await engine.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '300' })
      return engine
    }))
  })().catch((error) => { pool = null; throw error })
  return pool
}

const reader = createLabelReader(async (pictures) => {
  const list = await engines()
  try {
    return await Promise.all(pictures.map((picture, index) => {
      const engine = list[index % list.length]!
      const image = toPgm(picture)
      return runOcrJob(engine, () => engine.recognize(Buffer.from(image.buffer, image.byteOffset, image.byteLength))).then((result) => result.data.text ?? '')
    }))
  } finally {
    release()
  }
}, ENGINES)

export async function scanCollectorScreen(options: { restart?: boolean } = {}): Promise<CollectorScan> {
  if (options.restart) reader.reset()
  const frame = await captureGame()
  if (!frame) return { text: '', gameWindow: false, waiting: true, labels: 0, read: 0 }
  return { ...(await reader.readFrame(frame)), gameWindow: true }
}

/**
 * The game's picture: its client area on screen while the player can see it (Windows GDI). Without the Windows
 * functions, the game window's own thumbnail (desktopCapturer renders every window for it: slower, used only then).
 */
async function captureGame(): Promise<Raster | null> {
  if (process.platform !== 'win32') return null
  if (gameCaptureAvailable()) {
    const rect = visibleGameRect()
    if (!rect) return null
    const shot = captureScreenRegion(rect.x, rect.y, rect.width, rect.height)
    return shot && !blank(shot.data) ? { ...shot, order: 'bgra' } : null
  }
  const display = screen.getPrimaryDisplay()
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) }
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: false })
  const game = sources.find((source) => isTarkovTitle(source.name) && !source.thumbnail.isEmpty())
  if (!game) return null
  const { width, height } = game.thumbnail.getSize()
  const data = game.thumbnail.toBitmap()
  return blank(data) ? null : { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), order: 'bgra' }
}

/** An exclusive full-screen game copies as black. */
function blank(data: Uint8Array) {
  for (let index = 0; index < data.length; index += 4 * 997) if (data[index]! > 8 || data[index + 1]! > 8 || data[index + 2]! > 8) return false
  return true
}
