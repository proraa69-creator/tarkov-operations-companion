// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The OCR models of a copy updated in parts (owner, 25.11.2026: «установилось один раз … только частичное обновление
 * внутри приложения»): its installed folder keeps the models its installer brought, so a language a later release added
 * is put into the app's own folder — from the shipped folder what is there, the rest from the release's copy on the site
 * (the Tesseract project's as before when the site has none). Never written into the installed folder.
 * Security review, 27.11.2026: every model used has the SHA-256 the app knows for it (electron/ocrModels.ts).
 */
const dir = mkdtempSync(join(tmpdir(), 'raidos-models-'))
const shipped = join(dir, 'resources', 'tessdata')
const userData = join(dir, 'userData')
const model = (name: string) => Buffer.alloc(150_000, name.charCodeAt(0))
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
// This test's «real» models: rus = r…, eng = e…, pol = p….
const known = vi.hoisted(() => ({ hashes: {} as Record<string, string> }))
vi.mock('./ocrModels.js', () => ({ OCR_MODEL_SHA256: known.hashes }))
Object.assign(known.hashes, { rus: sha256(model('r')), eng: sha256(model('e')), pol: sha256(model('p')) })
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('./buildEdition.js', () => ({ buildDefaultServerUrl: () => 'https://raidos.app' }))
vi.mock('./experimental/settings.js', () => ({ readSettings: () => ({}) }))
vi.mock('tesseract.js', () => ({ createWorker: vi.fn() }))

const octet = (bytes: Buffer) => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/octet-stream' } })
/** What each source answers for pol: the model, another file, or the site's page. */
const answers = { site: model('p') as Buffer | 'page', github: model('p') as Buffer | 'missing' }
const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith('https://raidos.app/')) return answers.site === 'page' ? new Response('<!doctype html><title>Raid OS</title>', { headers: { 'content-type': 'text/html' } }) : octet(answers.site)
  return answers.github === 'missing' ? new Response('Not Found', { status: 404 }) : octet(answers.github)
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
  answers.site = model('p')
  answers.github = model('p')
})

const { ocrLanguagePath } = await import('./ocrEngine')

describe('ocrLanguagePath on a copy whose folder lacks a language', () => {
  it('the shipped folder when it has every model', async () => {
    expect(await ocrLanguagePath('rus+eng')).toBe(shipped)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a missing one: the app\'s own folder, the shipped models copied, the missing one from the release\'s copy on the site', async () => {
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
    answers.site = 'page'
    const path = await ocrLanguagePath('pol+eng')
    expect(readFileSync(join(path, 'pol.traineddata'))).toEqual(model('p'))
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://raidos.app/app-delta/resources/tessdata/pol.traineddata',
      'https://github.com/tesseract-ocr/tessdata_fast/raw/main/pol.traineddata',
    ])
    expect(existsSync(join(shipped, 'pol.traineddata'))).toBe(false)
  })
})

// Security review, 27.11.2026: models were taken as downloaded (any answer over 100 KB) and as found on disk.
describe('only the models the app knows', () => {
  it('a download with other bytes is not taken: the next source\'s is, and none at all is a clear error with nothing written', async () => {
    answers.site = model('x')
    const path = await ocrLanguagePath('pol+eng')
    expect(readFileSync(join(path, 'pol.traineddata'))).toEqual(model('p'))
    expect(fetchMock).toHaveBeenCalledTimes(2)

    rmSync(join(path, 'pol.traineddata'))
    answers.github = model('y')
    await expect(ocrLanguagePath('pol+eng')).rejects.toThrow(/Не удалось подготовить распознавание текста/)
    expect(readdirSync(path).filter((name) => name.startsWith('pol'))).toEqual([])
  })

  it('a model in the app\'s own folder with other bytes (an older download, a changed file) is put there again', async () => {
    const own = join(userData, 'tessdata')
    mkdirSync(own, { recursive: true })
    writeFileSync(join(own, 'pol.traineddata'), model('x'))
    writeFileSync(join(own, 'eng.traineddata'), model('e'))
    expect(await ocrLanguagePath('pol+eng')).toBe(own)
    expect(readFileSync(join(own, 'pol.traineddata'))).toEqual(model('p'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a shipped model with other bytes is neither used nor copied: the app\'s own folder gets the real one', async () => {
    writeFileSync(join(shipped, 'eng.traineddata'), model('z'))
    answers.github = 'missing'
    await expect(ocrLanguagePath('rus+eng')).rejects.toThrow(/Не удалось подготовить распознавание текста/)
    // The site has the real English model: taken from there, the shipped folder left as it is.
    answers.site = model('e')
    const path = await ocrLanguagePath('rus+eng')
    expect(path).toBe(join(userData, 'tessdata'))
    expect(readFileSync(join(path, 'eng.traineddata'))).toEqual(model('e'))
    expect(readFileSync(join(path, 'rus.traineddata'))).toEqual(model('r'))
    expect(readFileSync(join(shipped, 'eng.traineddata'))).toEqual(model('z'))
  })

  it('a language the app has no hash for is never taken', async () => {
    await expect(ocrLanguagePath('xyz+eng')).rejects.toThrow(/Не удалось подготовить распознавание текста/)
  })
})
