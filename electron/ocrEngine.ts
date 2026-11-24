import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import type { OcrWordBox } from '../src/import/storyPaneLayout.js'
import { ocrModel, ocrModelFiles, resolveGameLanguage } from '../src/import/gameLanguage.js'
import { readSettings } from './experimental/settings.js'

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

/**
 * The folder with the models a Tesseract language string needs («rus+eng», «deu+eng»…): shipped with the app (Russian,
 * English, German, Japanese, Simplified Chinese), downloaded once into the app's own folder when missing there.
 */
export async function ocrLanguagePath(model = 'rus+eng') {
  const files = ocrModelFiles(model)
  const langPath = tessdataDirectory(files)
  await mkdir(langPath, { recursive: true })
  await ensureLanguageData(langPath, files)
  return langPath
}

/** The shipped folder that holds every model asked for; else the app's own folder (models downloaded there). */
function tessdataDirectory(files: string[]) {
  const packaged = join(process.resourcesPath, 'tessdata')
  const development = join(appDir, '../../electron/tessdata')
  for (const folder of [packaged, development]) {
    if (files.every((lang) => existsSync(join(folder, `${lang}.traineddata`)))) return folder
  }
  // The Russian and English models as before: a folder with the Russian one gets the English one added.
  if (files.join('+') === 'rus+eng') {
    if (existsSync(join(packaged, 'rus.traineddata'))) return packaged
    if (existsSync(join(development, 'rus.traineddata'))) return development
  }
  return join(app.getPath('userData'), 'tessdata')
}

async function ensureLanguageData(directory: string, files: string[]) {
  for (const lang of files) {
    const file = join(directory, `${lang}.traineddata`)
    if (existsSync(file)) continue
    const response = await fetch(`${TESSDATA_URL}/${lang}.traineddata`)
    if (!response.ok) throw new Error('Не удалось подготовить распознавание текста. Нужен интернет при первом сканировании.')
    await writeFile(file, Buffer.from(await response.arrayBuffer()))
  }
}

/**
 * The game's language for every reader: the player's choice in «Язык игры» (English by default). Nothing of the game is
 * read for it. Each engine is made for the language's models and made again when the choice changes.
 */
export async function gameLanguageNow(_fresh = false) {
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
