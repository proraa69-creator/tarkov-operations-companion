import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import type { OcrWordBox } from '../src/import/storyPaneLayout.js'

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
 * Each OCR engine keeps both language models in memory (~100 MB). Engines are freed after a while unused and
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

/** The folder with the Russian and English models (shipped with the app; downloaded once if missing). */
export async function ocrLanguagePath() {
  const langPath = tessdataDirectory()
  await mkdir(langPath, { recursive: true })
  await ensureLanguageData(langPath)
  return langPath
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
