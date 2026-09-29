import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, desktopCapturer, nativeImage, screen, type NativeImage } from 'electron'
import { countScanFrames, saveScanFrame } from './scanFrameBuffer.js'

const require = createRequire(import.meta.url)
interface OcrLine { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
const { createWorker } = require('tesseract.js') as {
  createWorker: (langs?: string, oem?: number, options?: Record<string, unknown>) => Promise<{
    recognize: (image: Buffer, options?: Record<string, unknown>, output?: Record<string, boolean>) => Promise<{ data: { text?: string; blocks?: Array<{ paragraphs: Array<{ lines: OcrLine[] }> }> | null } }>
    setParameters: (params: Record<string, string>) => Promise<unknown>
  }>
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
let lastWatch: { fingerprint: Buffer; text: string; sourceName: string } | null = null

export async function captureQuestFrame(watch = false, detail = false) {
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
    if (!detail && fingerprint && lastWatch && sameFrame(fingerprint, lastWatch.fingerprint)) {
      return { text: lastWatch.text, sourceName: lastWatch.sourceName, gameWindow: true }
    }
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1080 } })
    const game = sources.find((source) => isTarkovWindow(source.name))
    if (!game || game.thumbnail.isEmpty()) return { text: '', sourceName: game?.name ?? '', gameWindow: Boolean(game) }
    const result = await recognizeQuestImage(prepareImage(game.thumbnail, detail ? 1500 : 1100), game.name)
    lastWatch = fingerprint ? { fingerprint, ...result } : null
    return { ...result, gameWindow: true }
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
  return { ...result, gameWindow, storedFrames }
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

/** A text line near the cursor: its text and centre in the coordinates of the image passed in. */
export interface RegionLine { text: string; x: number; y: number; height: number }

let itemWorker: Promise<OcrWorker> | null = null
function itemOcr() {
  itemWorker ??= (async () => {
    const langPath = tessdataDirectory()
    await mkdir(langPath, { recursive: true })
    await ensureLanguageData(langPath)
    const next = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
    // Sparse text: the tooltip and cell labels are scattered short lines, not a paragraph.
    await next.setParameters({ tessedit_pageseg_mode: '11' })
    return next
  })().catch((error) => { itemWorker = null; throw error })
  return itemWorker
}

/** OCR of the area around the cursor with the position of every line, so the nearest text can win. */
export async function recognizeRegionLines(image: NativeImage): Promise<RegionLine[]> {
  const { width } = image.getSize()
  const factor = width && width < 1000 ? 2 : 1
  const scaled = factor > 1 ? image.resize({ width: width * factor, quality: 'best' }) : image
  const ocr = await itemOcr()
  const result = await ocr.recognize(scaled.toPNG(), {}, { text: true, blocks: true })
  const lines = (result.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
  return lines
    .filter((line) => line.text.trim().length >= 2)
    .map((line) => ({
      text: line.text.trim(),
      x: (line.bbox.x0 + line.bbox.x1) / 2 / factor,
      y: (line.bbox.y0 + line.bbox.y1) / 2 / factor,
      height: (line.bbox.y1 - line.bbox.y0) / factor,
    }))
}

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
  const texts = await Promise.all(tiles.map((tile, index) => workers[index % workers.length]!.recognize(tile.toPNG()).then((result) => result.data.text ?? '').catch(() => '')))
  return { text: texts.join('\n'), gameWindow: Boolean(game) }
}

/** Loads the OCR model ahead of the first lookup. */
export async function warmUpOcr() {
  await itemOcr()
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
  const payload = Buffer.isBuffer(image) ? image : image.toPNG()
  const result = await ocr.recognize(payload)
  return { text: result.data.text ?? '', sourceName }
}

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

function prepareImage(image: NativeImage, maxWidth = 1500) {
  const size = image.getSize()
  if (!size.width || !size.height) return image
  const widescreen = size.width / size.height >= 1.3 && size.width >= 700
  // The Tasks table and the story pane start at the very left edge (tabs, chapter title,
  // «Главные задачи»); only the right-hand «Предметы» panel is dropped.
  const cropped = widescreen
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
