import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, desktopCapturer, nativeImage, screen, type NativeImage } from 'electron'
import { countScanFrames, saveScanFrame } from './scanFrameBuffer.js'
import { runOcrJob } from './ocrQueue.js'
import { captureScreenRegion, isTarkovForeground } from './experimental/win32.js'
import { TOOLTIP_OCR_PARAMETERS } from '../src/overlay/tooltipDetect.js'
import { screenshotsFolder } from './experimental/positionTracker.js'
import { readFreshQuestScreenshot } from './questScreenshot.js'
import { reuseQuestReading } from '../src/import/storyScanTiming.js'
import { isStoryPaneOcr, isStoryTitleText, ocrWordBoxes, storyPaneRects, storyPaneText, type OcrWordBox, type PaneRect, type StoryPaneReading, type StoryPaneRects } from '../src/import/storyPaneLayout.js'

const require = createRequire(import.meta.url)
interface OcrLine { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
const { createWorker } = require('tesseract.js') as {
  createWorker: (langs?: string, oem?: number, options?: Record<string, unknown>) => Promise<{
    recognize: (image: Buffer, options?: Record<string, unknown>, output?: Record<string, boolean>) => Promise<{ data: { text?: string; blocks?: Array<{ paragraphs: Array<{ lines: Array<OcrLine & { words: OcrWordBox[] }> }> }> | null } }>
    setParameters: (params: Record<string, string>) => Promise<unknown>
    terminate: () => Promise<unknown>
  }>
}

/**
 * Each OCR engine keeps both language models in memory (~100 MB). Engines are freed after a while unused and
 * started again on the next request (a second or two), so an idle app stays light.
 */
function idleRelease(ms: number, release: () => void) {
  let timer: NodeJS.Timeout | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; release() }, ms)
    timer.unref?.()
  }
}

type OcrWorker = Awaited<ReturnType<typeof createWorker>>

const appDir = dirname(fileURLToPath(import.meta.url))
const TESSDATA_URL = 'https://github.com/tesseract-ocr/tessdata_fast/raw/main'

let worker: OcrWorker | null = null
let preparing: Promise<OcrWorker> | null = null

/** getSources renders a thumbnail of every open window, so the probe stays tiny. */
const PROBE_SIZE = { width: 160, height: 90 }
/** Mean per-channel difference (0–255) below which two probes count as the same picture. */
const SAME_FRAME_DIFF = 3
let lastWatch: { fingerprint: Buffer; text: string; sourceName: string; story?: StoryPaneReading; at: number; detail: boolean } | null = null
let lastScreenshot: { key: string; text: string; sourceName: string; story?: StoryPaneReading; observedAt: number } | null = null
/** Where the parts of the last story pane were: while it stays open (flipping chapters) no whole-screen pass is needed. */
let storyLayout: { width: number; height: number; rects: StoryPaneRects } | null = null

/**
 * The game's screen while it is in front: one GDI copy of its display (a few ms) instead of desktopCapturer,
 * which renders a thumbnail of every open window (browser, Discord, …) on each call. Null when unavailable.
 */
function grabGameDisplay() {
  if (process.platform !== 'win32' || !isTarkovForeground()) return null
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const rect = screen.dipToScreenRect(null, display.bounds)
  const shot = captureScreenRegion(rect.x, rect.y, rect.width, rect.height)
  if (!shot) return null
  let blank = true
  for (let index = 0; index < shot.data.length; index += 4 * 997) if (shot.data[index]! > 8 || shot.data[index + 1]! > 8 || shot.data[index + 2]! > 8) { blank = false; break }
  if (blank) return null
  const image = nativeImage.createFromBitmap(Buffer.from(shot.data.buffer, shot.data.byteOffset, shot.data.byteLength), { width: shot.width, height: shot.height })
  return shot.width > 1920 ? image.resize({ width: 1920, quality: 'good' }) : image
}

export async function captureQuestFrame(watch = false, detail = false) {
  if (watch && process.platform === 'win32') {
    // Nothing to read unless the game is in front; then one cheap copy of its screen.
    if (!isTarkovForeground()) return { text: '', sourceName: '', gameWindow: false }
    const image = grabGameDisplay()
    if (image) {
      const fingerprint = frameFingerprint(image)
      const capturedAt = Date.now()
      if (lastWatch && reuseQuestReading(lastWatch, capturedAt, detail, sameFrame(fingerprint, lastWatch.fingerprint))) {
        return { text: lastWatch.text, sourceName: lastWatch.sourceName, gameWindow: true, observedAt: lastWatch.at, ...(lastWatch.story ? { story: lastWatch.story } : {}) }
      }
      const result = await readQuestFrame(image, detail, 'EscapeFromTarkov')
      lastWatch = { fingerprint, ...result, at: capturedAt, detail }
      return { ...result, gameWindow: true, observedAt: lastWatch.at }
    }
  }
  if (watch) {
    const names = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
    if (!names.some((source) => isTarkovWindow(source.name))) {
      lastWatch = null
      return { text: '', sourceName: '', gameWindow: false }
    }
    const windows = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: PROBE_SIZE })
    const probe = windows.find((source) => isTarkovWindow(source.name))
    if (!probe) {
      lastWatch = null
      return { text: '', sourceName: '', gameWindow: false }
    }
    const fingerprint = probe.thumbnail.isEmpty() ? null : frameFingerprint(probe.thumbnail)
    // Hideout and menus barely move between checks — reuse the last reading instead of OCR.
    if (fingerprint && lastWatch && reuseQuestReading(lastWatch, Date.now(), detail, sameFrame(fingerprint, lastWatch.fingerprint))) {
      return { text: lastWatch.text, sourceName: lastWatch.sourceName, gameWindow: true, observedAt: lastWatch.at, ...(lastWatch.story ? { story: lastWatch.story } : {}) }
    }
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1080 } })
    const game = sources.find((source) => isTarkovWindow(source.name))
    if (!game || game.thumbnail.isEmpty()) return { text: '', sourceName: game?.name ?? '', gameWindow: Boolean(game) }
    const capturedAt = Date.now()
    const result = await readQuestFrame(game.thumbnail, detail, game.name)
    lastWatch = fingerprint ? { fingerprint, ...result, at: capturedAt, detail } : null
    return { ...result, gameWindow: true, observedAt: capturedAt }
  }
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 1920, height: 1080 },
  })
  const game = sources.find((source) => isTarkovWindow(source.name))
  const preferred = game ?? sources.find((source) => source.id.startsWith('screen'))
  if (!preferred) return { text: '', sourceName: '', gameWindow: false, storedFrames: await countScanFrames() }
  const gameWindow = Boolean(game) || isTarkovWindow(preferred.name)
  const prepared = prepareImage(preferred.thumbnail)
  const result = await recognizeQuestImage(prepared, preferred.name)
  const storedFrames = await persistFrame(prepared)
  return { ...result, gameWindow, storedFrames, observedAt: Date.now() }
}

/** Fallback for capture failures: a screenshot taken after this profile/mode watch started. */
export async function captureQuestScreenshot(after: number) {
  const file = await readFreshQuestScreenshot(screenshotsFolder(), after)
  if (!file) return null
  const key = `${file.file}:${file.modifiedAt}:${file.size}`
  if (lastScreenshot?.key === key) return { ...lastScreenshot, gameWindow: true }
  const image = nativeImage.createFromBuffer(file.data)
  if (image.isEmpty()) return null
  const result = await readQuestFrame(image, true, 'EFT screenshot', false)
  lastScreenshot = { key, ...result, observedAt: file.modifiedAt }
  return { ...lastScreenshot, gameWindow: true }
}

export async function recognizeQuestPng(png: Buffer, sourceName = 'screenshot') {
  const image = nativeImage.createFromBuffer(png)
  if (!image.getSize().width) {
    const result = await recognizeQuestImage(png, sourceName)
    const storedFrames = await persistFrame(png)
    return { ...result, gameWindow: true, storedFrames }
  }
  const prepared = prepareImage(image)
  const result = await recognizeQuestImage(prepared, sourceName)
  const storedFrames = await persistFrame(prepared)
  return { ...result, gameWindow: true, storedFrames }
}

/** OCR for a small screen region (item tooltip under the cursor); small UI text is upscaled first. */
export async function recognizeRegion(image: NativeImage) {
  const { width } = image.getSize()
  const scaled = width && width < 1000 ? image.resize({ width: width * 2, quality: 'best' }) : image
  return (await recognizeQuestImage(scaled, 'region')).text
}

let tooltipWorker: Promise<OcrWorker> | null = null
function tooltipOcr() {
  tooltipWorker ??= (async () => {
    const langPath = tessdataDirectory()
    await mkdir(langPath, { recursive: true })
    await ensureLanguageData(langPath)
    const next = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
    // One line: the item name inside the game's tooltip.
    await next.setParameters(TOOLTIP_OCR_PARAMETERS)
    return next
  })().catch((error) => { tooltipWorker = null; throw error })
  return tooltipWorker
}

/** The text of the game's name tooltip, prepared as black-on-white BGRA pixels (see tooltipForOcr). */
export async function recognizeTooltip(pixels: { width: number; height: number; data: Uint8Array }) {
  const image = nativeImage.createFromBitmap(Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength), { width: pixels.width, height: pixels.height })
  const ocr = await tooltipOcr()
  try {
    const result = await runOcrJob(ocr, () => ocr.recognize(image.toPNG()))
    return (result.data.text ?? '').replace(/\s+/g, ' ').trim()
  } finally {
    touchTooltip()
  }
}

const touchTooltip = idleRelease(10 * 60_000, () => {
  const engine = tooltipWorker
  tooltipWorker = null
  void engine?.then((next) => next.terminate()).catch(() => {})
})

const touchStash = idleRelease(60_000, () => {
  const pool = stashPool
  stashPool = null
  void pool?.then((workers) => Promise.all(workers.map((next) => next.terminate()))).catch(() => {})
})

/** Workers for the stash scan: sparse-text mode suits the short labels in inventory cells. */
const STASH_WORKERS = 3
let stashPool: Promise<OcrWorker[]> | null = null

function stashWorkers() {
  if (!stashPool) {
    stashPool = (async () => {
      const langPath = tessdataDirectory()
      await mkdir(langPath, { recursive: true })
      await ensureLanguageData(langPath)
      return Promise.all(Array.from({ length: STASH_WORKERS }, async () => {
        const next = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
        await next.setParameters({ tessedit_pageseg_mode: '11' })
        return next
      }))
    })().catch((error) => { stashPool = null; throw error })
  }
  return stashPool
}

/**
 * Reads the whole screen (stash, inventory) for the Collector checklist. The picture is cut into
 * overlapping tiles that are enlarged for the tiny cell labels and read in parallel.
 */
export async function scanScreenText() {
  const display = screen.getPrimaryDisplay()
  const scale = display.scaleFactor || 1
  const physical = { width: Math.round(display.bounds.width * scale), height: Math.round(display.bounds.height * scale) }
  const [workers, sources] = await Promise.all([
    stashWorkers(),
    desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: physical }),
  ])
  const game = sources.find((source) => isTarkovWindow(source.name) && !source.thumbnail.isEmpty())
  const source = game ?? sources.find((entry) => entry.id.startsWith('screen') && entry.display_id === String(display.id)) ?? sources.find((entry) => entry.id.startsWith('screen'))
  if (!source || source.thumbnail.isEmpty()) return { text: '', gameWindow: false }
  const image = source.thumbnail
  const { width, height } = image.getSize()
  const columns = 3
  const rows = 2
  const overlap = Math.round(height * 0.03)
  const tiles: NativeImage[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = Math.max(0, Math.round((column * width) / columns) - overlap)
      const y = Math.max(0, Math.round((row * height) / rows) - overlap)
      const w = Math.min(width - x, Math.round(width / columns) + overlap * 2)
      const h = Math.min(height - y, Math.round(height / rows) + overlap * 2)
      const tile = image.crop({ x, y, width: w, height: h })
      // Cell labels are ~9 px tall at 1080p; about 2x makes them readable for OCR.
      tiles.push(h < 900 ? tile.resize({ width: Math.round(w * 1.8), quality: 'best' }) : tile)
    }
  }
  const texts = await Promise.all(tiles.map((tile, index) => {
    const worker = workers[index % workers.length]!
    return runOcrJob(worker, () => worker.recognize(tile.toPNG())).then((result) => result.data.text ?? '')
  }))
  touchStash()
  return { text: texts.join('\n'), gameWindow: Boolean(game) }
}

/** Loads the OCR model ahead of the first lookup. */
export async function warmUpOcr() {
  await tooltipOcr()
  touchTooltip()
}

export { clearScanFrames, countScanFrames, MAX_SCAN_FRAMES } from './scanFrameBuffer.js'

async function persistFrame(image: Buffer | NativeImage) {
  try {
    const png = Buffer.isBuffer(image) ? image : image.toPNG()
    return await saveScanFrame(png)
  } catch {
    return countScanFrames()
  }
}

async function recognizeQuestImage(image: Buffer | NativeImage, sourceName: string) {
  const ocr = await getWorker()
  try {
    const payload = Buffer.isBuffer(image) ? image : image.toPNG()
    const result = await runOcrJob(ocr, () => ocr.recognize(payload))
    return { text: result.data.text ?? '', sourceName }
  } finally {
    touchQuestWorker()
  }
}

/** The whole-screen pass with word boxes: they place the story pane parts (anchors «ИСТОРИЯ», «Главные задачи»). */
async function recognizeQuestWords(image: NativeImage) {
  const ocr = await getWorker()
  try {
    const result = await runOcrJob(ocr, () => ocr.recognize(image.toPNG(), {}, { text: true, blocks: true }))
    return { text: result.data.text ?? '', words: ocrWordBoxes(result.data.blocks) }
  } finally {
    touchQuestWorker()
  }
}

/**
 * One game frame for the quest scanner. The story pane is read part by part (src/import/storyPaneLayout.ts): while it
 * stays open — the player flips chapters — straight from the last layout, without the whole-screen pass; otherwise
 * after a whole-screen pass has found it. Menu probes (`detail` off) are read as before.
 */
async function readQuestFrame(image: NativeImage, detail: boolean, sourceName: string, remember = true): Promise<{ text: string; sourceName: string; story?: StoryPaneReading }> {
  const prepared = prepareImage(image, detail ? 1920 : 1100, !detail)
  if (!detail) {
    const { text } = await recognizeQuestImage(prepared, sourceName)
    return { text, sourceName }
  }
  const size = prepared.getSize()
  if (storyLayout && storyLayout.width === size.width && storyLayout.height === size.height) {
    const story = await readStoryPane(prepared, storyLayout.rects)
    if (story) return { text: storyPaneText(story), sourceName, story }
    if (remember) storyLayout = null
  }
  const full = await recognizeQuestWords(prepared)
  if (!isStoryPaneOcr(full.text)) return { text: full.text, sourceName }
  const rects = storyPaneRects(size, full.words, true)
  const story = rects ? await readStoryPane(prepared, rects) : null
  if (!story) return { text: full.text, sourceName }
  // The next frames start the body under the banner: another chapter's description has another length.
  const layout = storyPaneRects(size, full.words)
  if (remember) storyLayout = layout ? { width: size.width, height: size.height, rects: layout } : null
  return { text: full.text, sourceName, story }
}

/** Title column 2× (the name on the banner art), status label 2× as one line, description and objectives as they are. */
async function readStoryPane(image: NativeImage, rects: StoryPaneRects): Promise<StoryPaneReading | null> {
  const ocr = await getWorker()
  try {
    // One queue job for the three reads, so another scan cannot run between them and the page mode is restored.
    return await runOcrJob(ocr, async () => {
      const read = async (rect: PaneRect, scale: number, mode: '6' | '7') => {
        const part = image.crop(rect)
        const scaled = scale === 1 ? part : part.resize({ width: Math.round(rect.width * scale), quality: 'best' })
        if (mode !== '6') await ocr.setParameters({ tessedit_pageseg_mode: mode })
        try {
          return (await ocr.recognize(scaled.toPNG())).data.text ?? ''
        } finally {
          if (mode !== '6') await ocr.setParameters({ tessedit_pageseg_mode: '6' })
        }
      }
      const title = await read(rects.title, 2, '6')
      if (!isStoryTitleText(title)) return null
      const status = await read(rects.status, 2, '7')
      const body = await read(rects.body, 1, '6')
      return { title, status, body }
    })
  } finally {
    touchQuestWorker()
  }
}

const touchQuestWorker = idleRelease(2 * 60_000, () => {
  const engine = worker
  worker = null
  preparing = null
  void engine?.terminate().catch(() => {})
})

function isTarkovWindow(name: string) {
  if (/companion|operations|chrome|cursor|code/i.test(name)) return false
  return /escape\s*from\s*tarkov|escapefromtarkov|\beft\b/i.test(name)
}

function frameFingerprint(image: NativeImage) {
  return image.resize({ width: 48, height: 27, quality: 'good' }).toBitmap()
}

function sameFrame(a: Buffer, b: Buffer) {
  if (a.length !== b.length || !a.length) return false
  let total = 0
  for (let index = 0; index < a.length; index += 4) {
    total += Math.abs(a[index]! - b[index]!) + Math.abs(a[index + 1]! - b[index + 1]!) + Math.abs(a[index + 2]! - b[index + 2]!)
  }
  return total / ((a.length / 4) * 3) < SAME_FRAME_DIFF
}

function prepareImage(image: NativeImage, maxWidth = 1500, cropTable = true) {
  const size = image.getSize()
  if (!size.width || !size.height) return image
  const widescreen = size.width / size.height >= 1.3 && size.width >= 700
  // The Tasks table and the story pane start at the very left edge (tabs, chapter title,
  // «Главные задачи»); only the right-hand «Предметы» panel is dropped.
  const cropped = widescreen && cropTable
    ? image.crop({
        x: 0,
        y: 0,
        width: Math.max(320, Math.round(size.width * 0.74)),
        height: size.height,
      })
    : image
  const width = cropped.getSize().width
  if (width < 900) return cropped.resize({ width: 1100, quality: 'better' })
  if (width > maxWidth + 100) return cropped.resize({ width: maxWidth, quality: 'better' })
  return cropped
}

async function getWorker() {
  if (worker) return worker
  if (preparing) return preparing
  preparing = (async () => {
    const langPath = tessdataDirectory()
    await mkdir(langPath, { recursive: true })
    await ensureLanguageData(langPath)
    const next = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
    await next.setParameters({ tessedit_pageseg_mode: '6' })
    worker = next
    return next
  })()
  try {
    return await preparing
  } catch (error) {
    preparing = null
    throw error
  }
}

function tessdataDirectory() {
  const packaged = join(process.resourcesPath, 'tessdata')
  const development = join(appDir, '../../electron/tessdata')
  if (existsSync(join(packaged, 'rus.traineddata'))) return packaged
  if (existsSync(join(development, 'rus.traineddata'))) return development
  return join(app.getPath('userData'), 'tessdata')
}

async function ensureLanguageData(directory: string) {
  for (const lang of ['rus', 'eng']) {
    const file = join(directory, `${lang}.traineddata`)
    if (existsSync(file)) continue
    const response = await fetch(`${TESSDATA_URL}/${lang}.traineddata`)
    if (!response.ok) throw new Error('Не удалось подготовить распознавание текста. Нужен интернет при первом сканировании.')
    await writeFile(file, Buffer.from(await response.arrayBuffer()))
  }
}
