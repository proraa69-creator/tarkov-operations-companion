import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, desktopCapturer, nativeImage, type NativeImage } from 'electron'
import { countScanFrames, saveScanFrame } from './scanFrameBuffer.js'

const require = createRequire(import.meta.url)
const { createWorker } = require('tesseract.js') as {
  createWorker: (langs?: string, oem?: number, options?: Record<string, unknown>) => Promise<{
    recognize: (image: Buffer) => Promise<{ data: { text?: string } }>
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

/** Loads the OCR model ahead of the first lookup. */
export async function warmUpOcr() {
  await getWorker()
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
