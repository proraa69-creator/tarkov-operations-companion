import { desktopCapturer, screen } from 'electron'
import { runOcrJob } from './ocrQueue.js'
import { createWorker, idleRelease, ocrLanguagePath, type OcrWorker } from './ocrEngine.js'
import { captureScreenRegion, gameCaptureAvailable, visibleGameRect } from './experimental/win32.js'
import { isGameWindowTitle } from './experimental/gameWindow.js'
import type { Raster } from '../src/kappa/labelScan.js'
import { createLabelReader, toPgm, type FrameReading } from '../src/kappa/labelReader.js'

/**
 * «Сканировать» on the Kappa items page (owner, 12.10.2026: «ищет долго и находит не все предметы… начинает фризить»).
 * One call reads one frame of the game; the page calls again while the player scrolls the stash.
 *   - Only the game's own pixels: its window while the player can see it (one GDI copy, a few ms) — never the whole
 *     desktop, where this app's own list of item names would be read as found.
 *   - Only the item labels (src/kappa/labelScan.ts) of the part of the screen that changed, enlarged and stacked into one
 *     small picture for one OCR engine; each label once per scan, a few dozen per call (src/kappa/labelReader.ts).
 */
export interface CollectorScan extends FrameReading {
  /** The game's picture was read. */
  gameWindow: boolean
  /** The game is not on screen (closed, minimised or covered): the page asks to open it. */
  waiting?: boolean
}

let engine: Promise<OcrWorker> | null = null
const release = idleRelease(60_000, () => {
  const current = engine
  engine = null
  void current?.then((worker) => worker.terminate()).catch(() => {})
})

/** One OCR engine: one processor core at most, so the game keeps the rest (two made the game stutter). */
function ocr() {
  engine ??= (async () => {
    const langPath = await ocrLanguagePath()
    const worker = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
    // Sparse text: one short label per line, with room around it. The picture carries no resolution: say it.
    await worker.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '300' })
    return worker
  })().catch((error) => { engine = null; throw error })
  return engine
}

const reader = createLabelReader(async (picture) => {
  const worker = await ocr()
  try {
    const image = toPgm(picture)
    const result = await runOcrJob(worker, () => worker.recognize(Buffer.from(image.buffer, image.byteOffset, image.byteLength), {}, { blocks: true }))
    return (result.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
      .map((line) => ({ text: line.text, top: line.bbox.y0, bottom: line.bbox.y1 }))
  } finally {
    release()
  }
})

/**
 * `restart` starts a new scan (everything on screen is read again); `names`: the wanted items' labels, a misread one
 * near them is read a second time.
 */
export async function scanCollectorScreen(options: { restart?: boolean; names?: string[] } = {}): Promise<CollectorScan> {
  if (options.restart) reader.reset(options.names)
  const frame = await captureGame()
  if (!frame) return { text: '', gameWindow: false, waiting: true, labels: 0, read: 0, pending: 0 }
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
  const game = sources.find((source) => isGameWindowTitle(source.name) && !source.thumbnail.isEmpty())
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
