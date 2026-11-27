// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OCR_MODEL_FILES } from '../src/import/gameLanguage'
import { OCR_MODEL_SHA256 } from './ocrModels'

const tessdata = join(dirname(fileURLToPath(import.meta.url)), 'tessdata')
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

// Security review, 27.11.2026: a model the app puts into its own folder is used only with these bytes (ocrEngine.ts).
describe('the OCR models\' SHA-256 (electron/ocrModels.ts)', () => {
  it('every language of the app has one', () => {
    expect([...OCR_MODEL_FILES].sort()).toEqual(Object.keys(OCR_MODEL_SHA256).sort())
    for (const hash of Object.values(OCR_MODEL_SHA256)) expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  // The shipped models are the ones the release publishes on the site: a model replaced in electron/tessdata needs its
  // new hash in ocrModels.ts, or the app would refuse its own copy.
  it.runIf(existsSync(tessdata))('they are the shipped models\' (electron/tessdata)', () => {
    const shipped = readdirSync(tessdata).filter((name) => name.endsWith('.traineddata')).map((name) => name.replace(/\.traineddata$/, '')).sort()
    expect(shipped).toEqual(Object.keys(OCR_MODEL_SHA256).sort())
    for (const lang of shipped) expect(sha256(join(tessdata, `${lang}.traineddata`)), lang).toBe(OCR_MODEL_SHA256[lang])
  })
})
