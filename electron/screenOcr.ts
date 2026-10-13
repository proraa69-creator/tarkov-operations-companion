import { desktopCapturer, nativeImage, screen, type NativeImage } from 'electron'
import { countScanFrames, saveScanFrame } from './scanFrameBuffer.js'
import { runOcrJob } from './ocrQueue.js'
import { createWorker, idleRelease, ocrLanguagePath, type OcrWorker } from './ocrEngine.js'
import { captureScreenRegion, isTarkovForeground } from './experimental/win32.js'
import { TOOLTIP_OCR_PARAMETERS } from '../src/overlay/tooltipDetect.js'
import { screenshotsFolder } from './experimental/positionTracker.js'
import { readFreshQuestScreenshot } from './questScreenshot.js'
import { reuseQuestReading, reuseStableReading, unchangedFrame } from '../src/import/storyScanTiming.js'
import { isStoryObjectivesText, isStoryPaneOcr, isStoryTitleText, ocrWordBoxes, storyPaneRects, storyPaneText, type OcrWordBox, type PaneRect, type StoryPaneReading, type StoryPaneRects } from '../src/import/storyPaneLayout.js'
import { cardLevelWord, confirmCards, confirmTraderLevel, findNameLevel, foldNickname, isModeSelectText, isTraderScreenText, modeSelectHeaders, ocrLines, parseTraderLevel, parseTraderNickname, traderLevelWord, traderScreenParts, type CardReadings, type ModeSelectCard, type TraderScreenReading } from '../src/import/modeSelectScreen.js'
import { grayPicture, readLevelShapes } from '../src/import/levelDigits.js'
import { classifyLoyaltyBadge, confirmLoyalty, traderBadgeRects } from '../src/import/traderLoyalty.js'

let worker: OcrWorker | null = null
let preparing: Promise<OcrWorker> | null = null

/** getSources renders a thumbnail of every open window, so the probe stays tiny. */
const PROBE_SIZE = { width: 160, height: 90 }
/** Mean per-channel difference (0–255) below which two probes count as the same picture. */
const SAME_FRAME_DIFF = 3
/** The last reading of the game: a coarse print (moves a little: re-read soon), a fine one (unchanged: see reuseStableReading). */
let lastWatch: { fingerprint: Buffer; fine: Buffer; text: string; sourceName: string; story?: StoryPaneReading; profiles?: ModeSelectCard[]; trader?: TraderScreenReading; at: number; detail: boolean; reads: number } | null = null
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
      const fine = fineFingerprint(image)
      const capturedAt = Date.now()
      const unchanged = unchangedFrame(lastWatch?.fine, fine)
      if (lastWatch && (reuseStableReading(lastWatch, capturedAt, detail, unchanged) || reuseQuestReading(lastWatch, capturedAt, detail, sameFrame(fingerprint, lastWatch.fingerprint)))) {
        return { text: lastWatch.text, sourceName: lastWatch.sourceName, gameWindow: true, observedAt: lastWatch.at, ...(lastWatch.story ? { story: lastWatch.story } : {}), ...(lastWatch.profiles ? { profiles: lastWatch.profiles } : {}), ...(lastWatch.trader ? { trader: lastWatch.trader } : {}) }
      }
      const result = await readQuestFrame(image, detail, 'EscapeFromTarkov')
      lastWatch = { fingerprint, fine, ...result, at: capturedAt, detail, reads: unchanged && lastWatch?.detail === detail ? lastWatch.reads + 1 : 1 }
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
    // The probe itself (160 × 90) is the fine print.
    const fine = fingerprint ? probe.thumbnail.toBitmap() : null
    const unchanged = Boolean(fine && unchangedFrame(lastWatch?.fine, fine))
    // Hideout and menus barely move between checks — reuse the last reading instead of OCR.
    if (fingerprint && lastWatch && (reuseStableReading(lastWatch, Date.now(), detail, unchanged) || reuseQuestReading(lastWatch, Date.now(), detail, sameFrame(fingerprint, lastWatch.fingerprint)))) {
      return { text: lastWatch.text, sourceName: lastWatch.sourceName, gameWindow: true, observedAt: lastWatch.at, ...(lastWatch.story ? { story: lastWatch.story } : {}), ...(lastWatch.profiles ? { profiles: lastWatch.profiles } : {}), ...(lastWatch.trader ? { trader: lastWatch.trader } : {}) }
    }
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1080 } })
    const game = sources.find((source) => isTarkovWindow(source.name))
    if (!game || game.thumbnail.isEmpty()) return { text: '', sourceName: game?.name ?? '', gameWindow: Boolean(game) }
    const capturedAt = Date.now()
    const result = await readQuestFrame(game.thumbnail, detail, game.name)
    lastWatch = fingerprint && fine ? { fingerprint, fine, ...result, at: capturedAt, detail, reads: unchanged && lastWatch?.detail === detail ? lastWatch.reads + 1 : 1 } : null
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
    const langPath = await ocrLanguagePath()
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
async function readQuestFrame(image: NativeImage, detail: boolean, sourceName: string, remember = true): Promise<{ text: string; sourceName: string; story?: StoryPaneReading; profiles?: ModeSelectCard[]; trader?: TraderScreenReading }> {
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
  // «Выбор профиля и режима» at the game's start: the nickname and every mode's level (src/import/modeSelectScreen.ts).
  if (isModeSelectText(full.text)) {
    const profiles = await readModeSelect(prepared, full.words)
    return { text: full.text, sourceName, ...(profiles.length ? { profiles } : {}) }
  }
  // The traders' screen: the nickname and the level of the mode the game is in (the player is there often).
  const trader = isTraderScreenText(full.text) ? await readTraderScreen(prepared, full.words) : null
  const extra = trader ? { trader } : {}
  if (!isStoryPaneOcr(full.text)) return { text: full.text, sourceName, ...extra }
  const rects = storyPaneRects(size, full.words, true)
  const story = rects ? await readStoryPane(prepared, rects) : null
  if (!story) return { text: full.text, sourceName, ...extra }
  // The next frames start the body under the banner: another chapter's description has another length.
  const layout = storyPaneRects(size, full.words)
  if (remember) storyLayout = layout ? { width: size.width, height: size.height, rects: layout } : null
  return { text: full.text, sourceName, story, ...extra }
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
      const body = await read(rects.body, 1, '6')
      // Either part proves the pane: the name may sit on bright art, the headings may be scrolled away.
      if (!isStoryTitleText(title) && !isStoryObjectivesText(body)) return null
      const status = await read(rects.status, 2, '7')
      return { title, status, body }
    })
  } finally {
    touchQuestWorker()
  }
}

/** The grey pixels of a close-up, for reading the level's digits from their shapes (src/import/levelDigits.ts). */
function closeUpPicture(image: NativeImage) {
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  return bitmap.length >= width * height * 4 ? grayPicture(bitmap, width, height) : null
}

/**
 * The mode selection screen: each card's «ник | уровень» line once more, close up (3×), next to what the whole pass read,
 * and the level's digits read from their shapes in that close-up. Only the levels an OCR reading and the shapes agree on
 * are returned (confirmCards). A few small reads, and only while this screen is open.
 */
async function readModeSelect(image: NativeImage, words: OcrWordBox[]): Promise<ModeSelectCard[]> {
  const headers = modeSelectHeaders(words, image.getSize())
  if (!headers.length) return []
  const ocr = await getWorker()
  try {
    const readings = await runOcrJob(ocr, async () => {
      const result: CardReadings[] = []
      for (const header of headers) {
        // The line the whole pass found, as one line; otherwise the band under the card's title, as a block.
        const rect = header.full?.box ?? header.band
        const scaled = image.crop(rect).resize({ width: rect.width * 3, quality: 'best' })
        if (header.full) await ocr.setParameters({ tessedit_pageseg_mode: '7' })
        let data: Awaited<ReturnType<OcrWorker['recognize']>>['data']
        try {
          data = (await ocr.recognize(scaled.toPNG(), {}, { text: true, blocks: true })).data
        } finally {
          if (header.full) await ocr.setParameters({ tessedit_pageseg_mode: '6' })
        }
        const line = findNameLevel(data.text ?? '')
        const full = header.full ? { nickname: header.full.nickname, level: header.full.level } : undefined
        const word = cardLevelWord(ocrLines(data.blocks), Boolean(header.full))
        const picture = word ? closeUpPicture(scaled) : null
        const digits = word && picture ? readLevelShapes(picture, word.bbox, [line?.level, full?.level]) : undefined
        result.push({ mode: header.mode, ...(full ? { full } : {}), ...(line ? { line } : {}), ...(digits ? { digits } : {}) })
      }
      return result
    })
    return confirmCards(readings)
  } finally {
    touchQuestWorker()
  }
}

/**
 * The traders' screen: «LVL 12» of the current standing and the name before «(вы)», each once more close up (3×). The
 * level counts when an OCR reading and its digits' shapes agree, the name when the whole pass and the close-up do; null
 * when nothing does.
 */
async function readTraderScreen(image: NativeImage, words: OcrWordBox[]): Promise<TraderScreenReading | null> {
  const loyalty = readTraderLoyalty(image, words)
  const parts = traderScreenParts(words, image.getSize())
  if (!parts.level && !parts.nickname) return loyalty ? { loyalty } : null
  const ocr = await getWorker()
  try {
    return await runOcrJob(ocr, async () => {
      const read = async (rect: { x: number; y: number; width: number; height: number }) => {
        const scaled = image.crop(rect).resize({ width: rect.width * 3, quality: 'best' })
        await ocr.setParameters({ tessedit_pageseg_mode: '7' })
        try {
          const { data } = await ocr.recognize(scaled.toPNG(), {}, { text: true, blocks: true })
          return { text: data.text ?? '', lines: ocrLines(data.blocks), scaled }
        } finally {
          await ocr.setParameters({ tessedit_pageseg_mode: '6' })
        }
      }
      const reading: TraderScreenReading = {}
      if (parts.level) {
        const close = await read(parts.level.box)
        const closeLevel = parseTraderLevel(close.text)
        const word = traderLevelWord(close.lines)
        const picture = word ? closeUpPicture(close.scaled) : null
        const digits = word && picture ? readLevelShapes(picture, word.bbox, [closeLevel, parts.level.value]) : undefined
        const level = confirmTraderLevel(parts.level.value, closeLevel, digits)
        if (level) reading.level = level
      }
      if (parts.nickname) {
        const close = parseTraderNickname((await read(parts.nickname.box)).text)
        if (close && foldNickname(close) === foldNickname(parts.nickname.value)) reading.nickname = close
      }
      if (loyalty) reading.loyalty = loyalty
      return reading.level || reading.nickname || reading.loyalty ? reading : null
    })
  } finally {
    touchQuestWorker()
  }
}

/** The loyalty badges of the last frames: a level counts once the next frame shows it too (confirmLoyalty). */
let lastLoyalty: { at: number; levels: Record<string, number> } | null = null

/**
 * The traders' loyalty levels: each badge in the top left of a portrait (I, II, III, a crown for IV), read from its
 * shape, not by OCR (src/import/traderLoyalty.ts). A few dozen pixels a trader, no OCR at all.
 */
function readTraderLoyalty(image: NativeImage, words: OcrWordBox[]): Record<string, number> | undefined {
  const levels: Record<string, number> = {}
  for (const badge of traderBadgeRects(words, image.getSize())) {
    const bitmap = image.crop(badge.rect).toBitmap()
    const { width, height } = badge.rect
    if (bitmap.length < width * height * 4) continue
    const gray = new Uint8Array(width * height)
    for (let index = 0; index < gray.length; index += 1) gray[index] = Math.round((bitmap[index * 4]! + bitmap[index * 4 + 1]! + bitmap[index * 4 + 2]!) / 3)
    const level = classifyLoyaltyBadge(gray, width, height)
    if (level) levels[badge.key] = level
  }
  const now = Date.now()
  const previous = lastLoyalty && now - lastLoyalty.at < 30_000 ? lastLoyalty.levels : {}
  lastLoyalty = { at: now, levels }
  const confirmed = confirmLoyalty(levels, previous)
  return Object.keys(confirmed).length ? confirmed : undefined
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

/** About 16 × 16 screen pixels a sample at 1080p: a changed digit shows. */
function fineFingerprint(image: NativeImage) {
  return image.resize({ width: 120, height: 68, quality: 'good' }).toBitmap()
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
    const langPath = await ocrLanguagePath()
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
