// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The OCR models of a copy updated in parts (owner, 25.11.2026: «установилось один раз … только частичное обновление
 * внутри приложения»): its installed folder keeps the models its installer brought, so a language a later release added
 * is put into the app's own folder — from the shipped folder what is there, the rest from the release's copy on the site
 * (the Tesseract project's as before when the site has none). Never written into the installed folder.
 */
const dir = mkdtempSync(join(tmpdir(), 'raidos-models-'))
const shipped = join(dir, 'resources', 'tessdata')
const userData = join(dir, 'userData')
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('./buildEdition.js', () => ({ buildDefaultServerUrl: () => 'https://raidos.app' }))
vi.mock('./experimental/settings.js', () => ({ readSettings: () => ({}) }))
vi.mock('tesseract.js', () => ({ createWorker: vi.fn() }))

const model = (name: string) => Buffer.alloc(150_000, name.charCodeAt(0))
const site = { has: true }
const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith('https://raidos.app/')) {
    return site.has
      ? new Response(new Uint8Array(model('p')), { headers: { 'content-type': 'application/octet-stream' } })
      : new Response('<!doctype html><title>Raid OS</title>', { headers: { 'content-type': 'text/html' } })
  }
  return new Response(new Uint8Array(model('g')), { headers: { 'content-type': 'application/octet-stream' } })
})
vi.stubGlobal('fetch', fetchMock)
Object.defineProperty(process, 'resourcesPath', { value: join(dir, 'resources'), configurable: true })
afterAll(() => rmSync(dir, { recursive: true, force: true }))

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(shipped, { recursive: true })
  // An older copy's folder: the Russian and English models only.
  writeFileSync(join(shipped, 'rus.traineddata'), model('r'))
  writeFileSync(join(shipped, 'eng.traineddata'), model('e'))
  fetchMock.mockClear()
  site.has = true
})

describe('ocrLanguagePath on a copy whose folder lacks a language', () => {
  it('the shipped folder when it has every model', async () => {
    const { ocrLanguagePath } = await import('./ocrEngine')
    expect(await ocrLanguagePath('rus+eng')).toBe(shipped)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a missing one: the app\'s own folder, the shipped models copied, the missing one from the release\'s copy on the site', async () => {
    const { ocrLanguagePath } = await import('./ocrEngine')
    const path = await ocrLanguagePath('pol+eng')
    expect(path).toBe(join(userData, 'tessdata'))
    expect(readFileSync(join(path, 'eng.traineddata'))).toEqual(model('e'))
    expect(readFileSync(join(path, 'pol.traineddata'))).toEqual(model('p'))
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['https://raidos.app/app-delta/resources/tessdata/pol.traineddata'])
    // Nothing written into the installed folder, no piece of a download left.
    expect(readdirSync(shipped).sort()).toEqual(['eng.traineddata', 'rus.traineddata'])
    expect(readdirSync(path).filter((name) => name.endsWith('.part'))).toEqual([])
  })

  it('the site without the model (its page instead): the Tesseract project\'s copy as before', async () => {
    site.has = false
    const { ocrLanguagePath } = await import('./ocrEngine')
    const path = await ocrLanguagePath('pol+eng')
    expect(readFileSync(join(path, 'pol.traineddata'))).toEqual(model('g'))
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://raidos.app/app-delta/resources/tessdata/pol.traineddata',
      'https://github.com/tesseract-ocr/tessdata_fast/raw/main/pol.traineddata',
    ])
    expect(existsSync(join(shipped, 'pol.traineddata'))).toBe(false)
  })
})
