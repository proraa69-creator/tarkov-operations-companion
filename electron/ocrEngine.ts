import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import type { OcrWordBox } from '../src/import/storyPaneLayout.js'
import { ocrModel, ocrModelFiles, resolveGameLanguage } from '../src/import/gameLanguage.js'
import { readSettings } from './experimental/settings.js'
import { buildDefaultServerUrl } from './buildEdition.js'
import { OCR_MODEL_SHA256 } from './ocrModels.js'

/** Tesseract (tesseract.js) for the quest scanner, the item card and the Collector scan. */
const require = createRequire(import.meta.url)
export interface OcrLine { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
export const { createWorker } = require('tesseract.js') as {
  createWorker: (langs?: string, oem?: number, options?: Record<string, unknown>) => Promise<{
    recognize: (image: Buffer, options?: Record<string, unknown>, output?: Record<string, boolean>) => Promise<{ data: { text?: string; blocks?: Array<{ paragraphs: Array<{ lines: Array<OcrLine & { words: OcrWordBox[] }> }> }> | null } }>
    setParameters: (params: Record<string, string>) => Promise<unknown>
    terminate: () => Promise<unknown>
  }>
}
export type OcrWorker = Awaited<ReturnType<typeof createWorker>>

/**
 * Each OCR engine keeps its two language models in memory (~100 MB). Engines are freed after a while unused and
 * started again on the next request (a second or two), so an idle app stays light.
 */
export function idleRelease(ms: number, release: () => void) {
  let timer: NodeJS.Timeout | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; release() }, ms)
    timer.unref?.()
  }
}

const appDir = dirname(fileURLToPath(import.meta.url))
const TESSDATA_URL = 'https://github.com/tesseract-ocr/tessdata_fast/raw/main'
/** The release's own models on the site (scripts/publish-app-delta.cjs → /app-delta/resources/tessdata/). */
const RELEASE_TESSDATA_PATH = '/app-delta/resources/tessdata'

/**
 * The folder with the models a Tesseract language string needs («rus+eng», «deu+eng»…): the ones shipped with the app
 * (all eleven game languages since 24.11.2026); otherwise the app's own folder, where a missing model is put once — from
 * the shipped folder when it is there, else downloaded. A copy updated in parts keeps the folder its installer made
 * (owner, 25.11.2026: «установилось один раз … только частичное обновление»), so a language added later is downloaded.
 * Every model used has the SHA-256 the app knows for it (electron/ocrModels.ts; security review, 27.11.2026): a shipped
 * one that does not is not used, one in the app's own folder that does not is put there again, and a download is taken
 * only with exactly those bytes.
 */
export async function ocrLanguagePath(model = 'rus+eng') {
  const files = ocrModelFiles(model)
  const langPath = tessdataDirectory(files)
  await mkdir(langPath, { recursive: true })
  await ensureLanguageData(langPath, files)
  return langPath
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
/** The model's bytes are the ones the app knows for this language (none known: never). */
const modelBytesVerified = (lang: string, bytes: Buffer) => Object.hasOwn(OCR_MODEL_SHA256, lang) && sha256(bytes) === OCR_MODEL_SHA256[lang]

/** Files already checked, by path, size and time: a model is hashed once a run, not at every new engine. */
const checked = new Map<string, string>()
/** A model file on disk with the bytes the app knows for its language. */
function modelFileVerified(lang: string, file: string) {
  try {
    const info = statSync(file)
    if (!info.isFile()) return false
    const key = `${info.size}:${info.mtimeMs}`
    if (checked.get(file) === key) return true
    if (!modelBytesVerified(lang, readFileSync(file))) return false
    checked.set(file, key)
    return true
  } catch {
    return false
  }
}

/** The shipped folder that holds every model asked for; else the app's own folder (the models put there). */
function tessdataDirectory(files: string[]) {
  for (const folder of shippedFolders()) {
    if (files.every((lang) => modelFileVerified(lang, join(folder, `${lang}.traineddata`)))) return folder
  }
  // Never written into the installed app's folder (Program Files): the app's own folder takes what is missing.
  return join(app.getPath('userData'), 'tessdata')
}

function shippedFolders() {
  return [join(process.resourcesPath, 'tessdata'), join(appDir, '../../electron/tessdata')]
}

/** Where a missing model comes from: the release's copy on the site first, the Tesseract project's as before. */
function modelSources(lang: string) {
  const site = buildDefaultServerUrl()
  return [...(site.startsWith('https://') ? [`${site}${RELEASE_TESSDATA_PATH}/${lang}.traineddata`] : []), `${TESSDATA_URL}/${lang}.traineddata`]
}

/** The model's bytes from the shipped folder or a download, only when they are the ones the app knows; else null. */
async function modelBytes(lang: string) {
  const shipped = shippedFolders().map((folder) => join(folder, `${lang}.traineddata`)).find((path) => modelFileVerified(lang, path))
  if (shipped) {
    const bytes = await readFile(shipped)
    if (modelBytesVerified(lang, bytes)) return bytes
  }
  for (const url of modelSources(lang)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) }).catch(() => null)
    if (!response?.ok || !/octet-stream|binary|application\/x-|^$/.test(response.headers.get('content-type') ?? '')) continue
    const body = Buffer.from(await response.arrayBuffer())
    // The site's page, an error answer or any other file is not the model.
    if (modelBytesVerified(lang, body)) return body
  }
  return null
}

async function ensureLanguageData(directory: string, files: string[]) {
  for (const lang of files) {
    const file = join(directory, `${lang}.traineddata`)
    if (modelFileVerified(lang, file)) continue
    // Missing, or not the model it should be (an older download, a changed file): put there again.
    await rm(file, { force: true })
    const data = await modelBytes(lang)
    if (!data) throw new Error('Не удалось подготовить распознавание текста. Нужен интернет при первом сканировании.')
    // Whole or not at all: a download cut short never leaves a model Tesseract would choke on.
    const part = `${file}.part`
    await writeFile(part, data)
    await rename(part, file).catch(async (error: unknown) => { await rm(part, { force: true }); throw error })
  }
}

/**
 * The game's language for every reader: the player's choice in «Язык игры» (English by default). Nothing of the game is
 * read for it. Each engine is made for the language's models and made again when the choice changes.
 */
export async function gameLanguageNow() {
  const setting = resolveGameLanguage(readSettings().gameLanguage)
  return { setting, language: setting, model: ocrModel(setting) }
}

/**
 * One OCR engine of a reader, for the game's language: `make(model)` starts one; `get()` gives the engine of the language
 * now — the one kept while the language stays, a new one once it changed (the old one is ended). `drop()` ends it (idle,
 * a hung engine).
 */
export function languageEngine(make: (model: string) => Promise<OcrWorker>) {
  let engine: { model: string; worker: Promise<OcrWorker> } | null = null
  const drop = () => {
    const current = engine
    engine = null
    void current?.worker.then((worker) => worker.terminate()).catch(() => {})
  }
  return {
    async get(model: string): Promise<OcrWorker> {
      if (engine && engine.model !== model) drop()
      if (!engine) {
        const next = { model, worker: make(model) }
        engine = next
        next.worker.catch(() => { if (engine === next) engine = null })
      }
      return engine.worker
    },
    drop,
    model: () => engine?.model ?? null,
  }
}
