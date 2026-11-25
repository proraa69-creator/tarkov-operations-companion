// @vitest-environment node
/**
 * «Найти ключи» on frames of the game. Report 236 (25.11.2026): the player's stash held «Общ 110», «Общ 103», «Общ 203» and
 * «Общ 303»; the scan found those and «Ключ РБ-СТ», which he does not have. Owner, 25.11.2026: «запусти SPT… добавь все
 * ключи из игры… научись правильно находить ключи», «Все ключи в СПТ должны быть изучены, и только потом начинай поиск».
 *
 * Frames (__fixtures__): the offline copy's stash holding one of each of its 241 keys and keycards (SPT 4.1.6, client 0.16.9,
 * Russian, 1920×1080, every key examined), shot at the top, the middle and the bottom, as is and with a key's tooltip open
 * beside it — which key lies in which cell comes from the game's own views (key-frames.json, made by
 * E:\SPT-photo\keyscan\build_fixtures.py); and the player's own frame of report 236 (1440p). The reading and the matching
 * are the app's own: the label reader (src/kappa/labelReader.ts) and the key scan's matching (keyScanLists,
 * quests/keyMatch.ts), pass after pass as the app runs them.
 *
 * KEY_SCAN_TABLE=<file.json> also writes, for every key, what its label was read as and what it was taken for (the study
 * of every key: key-scan-table.md is made from it by E:\SPT-photo\keyscan\make_table.py).
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { createLabelReader, type LabelReading, type PictureLine } from '../kappa/labelReader'
import type { Raster } from '../kappa/labelScan'
import { keyScanLists } from './keyScan'
import { createKeyMatcher, keyShape } from './keyMatch'

const require = createRequire(import.meta.url)
const sharp = require('sharp') as typeof import('sharp').default
type OcrWorker = { setParameters: (params: Record<string, string>) => Promise<unknown>; recognize: (image: Buffer, options: object, output: object) => Promise<{ data: { blocks?: Array<{ paragraphs: Array<{ lines: Array<{ text: string; bbox: { y0: number; y1: number } }> }> }> } }>; terminate: () => Promise<unknown> }
const { createWorker } = require('tesseract.js') as { createWorker: (langs: string, oem: number, options: Record<string, unknown>) => Promise<OcrWorker> }

interface Cell { tpl: string; box: [number, number, number, number]; label: boolean; covered?: boolean; hovered?: boolean }
interface Frame {
  file: string
  lang: 'ru' | 'en'
  /** The game's picture the frame was cut from, and where. */
  screen: [number, number]
  at: [number, number]
  /** The tooltip's box on the frame, when one is open. */
  tip: [number, number, number, number] | null
  cells: Cell[]
  /** Report 236: the keys on the frame, nothing else may be found. */
  only?: string[]
  /** The player's quests' keys (the second look's names first). */
  wanted?: string[]
}
interface KeyInfo { tpl: string; sptCode?: string; sptName?: string; sptShort?: string; sptShortEn?: string; appShort?: string | null; appShortEn?: string | null; inApp: boolean; cell: [number, number] }

const root = join(__dirname, '../..')
const fixtures = join(__dirname, '__fixtures__')
const meta = JSON.parse(readFileSync(join(fixtures, 'key-frames.json'), 'utf8')) as { frames: Frame[]; keys: KeyInfo[] }
const catalogs: Record<Frame['lang'], Item[]> = {
  ru: JSON.parse(readFileSync(join(fixtures, 'key-items-ru.json'), 'utf8')) as Item[],
  en: JSON.parse(readFileSync(join(fixtures, 'key-items-en.json'), 'utf8')) as Item[],
}
const appKeys = new Set(catalogs.ru.filter((item) => item.category === 'Ключ').map((item) => item.id))
/**
 * Keys a label tells that no frame of the language found, when written (25.11.2026): Russian 45 of 192 (five frames; 115 of
 * 230 before, the matching and reading of release/production), English 72 of 197 (two frames). OCR of 1080p labels still
 * fails on these (letters broken, key art under the label). Room for Tesseract versions.
 */
const MISSES_ALLOWED: Record<Frame['lang'], number> = { ru: 50, en: 78 }

/** The frame where it was on the game's picture, the rest of the picture dark (the reader sizes cells by its height). */
async function gamePicture(frame: Frame): Promise<Raster> {
  const { data, info } = await sharp(join(fixtures, frame.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const [width, height] = frame.screen
  const out = new Uint8Array(width * height * 4)
  for (let p = 0; p < width * height; p += 1) out.set([8, 10, 12, 255], p * 4)
  for (let y = 0; y < info.height; y += 1) out.set(data.subarray(y * info.width * 4, (y + 1) * info.width * 4), ((y + frame.at[1]) * width + frame.at[0]) * 4)
  return { width, height, data: out, order: 'rgba' }
}

interface LabelSeen extends LabelReading { cell?: Cell; ids: string[] }
interface FrameResult { frame: Frame; found: string[]; labels: LabelSeen[] }

let worker: OcrWorker
const results = new Map<string, FrameResult>()

/** One «Найти ключи» on a frame: the app's passes until every label on it is read. */
async function scanFrame(frame: Frame): Promise<FrameResult> {
  const { matcher, names } = keyScanLists(catalogs[frame.lang], frame.wanted ?? [])
  const labels: LabelReading[] = []
  const reader = createLabelReader(async (picture) => {
    const pgm = Buffer.concat([Buffer.from(`P5\n${picture.width} ${picture.height}\n255\n`, 'ascii'), Buffer.from(picture.data)])
    const result = await worker.recognize(pgm, {}, { blocks: true })
    return (result.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
      .map((line): PictureLine => ({ text: line.text, top: line.bbox.y0, bottom: line.bbox.y1 }))
  }, { onLabel: (label) => labels.push(label) })
  reader.reset(names)
  const raster = await gamePicture(frame)
  const found = new Set<string>()
  for (let pass = 0; pass < 30; pass += 1) {
    const reading = await reader.readFrame(raster)
    for (const id of matcher.count(reading.text).keys()) found.add(id)
    if (!reading.pending) break
  }
  // A label is the top right of its item's cell.
  const cellOf = (label: LabelReading) => {
    const x = label.box.x + label.box.width - 2 - frame.at[0], y = label.box.y + 2 - frame.at[1]
    return frame.cells.find(({ box: [x0, y0, x1, y1] }) => x0 <= x && x < x1 && y0 <= y && y < y1)
  }
  return { frame, found: [...found], labels: labels.map((label) => ({ ...label, cell: cellOf(label), ids: matcher.line(label.text) })) }
}

const labelIn = (key: KeyInfo, lang: Frame['lang']) => ({ spt: lang === 'ru' ? key.sptShort : key.sptShortEn, app: lang === 'ru' ? key.appShort : key.appShortEn })
/**
 * The app's keys a label of the offline copy is in the live game: the key itself, or — for a key the app's catalog does not
 * have (SPT 0.16.9 keeps old and switched-off ones: «Спецтех», «Black KC») — the app's key of that label or of its first word.
 */
const liveKeys = (lang: Frame['lang']) => new Map(meta.keys.map((key) => {
  const spt = keyShape(labelIn(key, lang).spt ?? '')
  return [key.tpl, key.inApp
    ? [key.tpl]
    : catalogs[lang].filter((item) => item.category === 'Ключ' && spt && [spt, spt.split(' ')[0]].includes(keyShape(item.shortName ?? ''))).map((item) => item.id)]
}))
/**
 * The keys a label alone cannot tell (keyMatch.ts): several keys or other items carry it («Сейф», «Авто», «Завод»), or the
 * offline copy labels the key otherwise than the live game («Спальня» for «Ключ (Меченый)»).
 */
const untold = (lang: Frame['lang']) => {
  const byLabel = createKeyMatcher(catalogs[lang].filter((item) => item.category === 'Ключ'), catalogs[lang])
  return new Set(meta.keys.filter((key) => {
    const { spt, app } = labelIn(key, lang)
    return key.inApp && (!spt || keyShape(spt) !== keyShape(app ?? '') || !byLabel.line(app ?? '').includes(key.tpl))
  }).map((key) => key.tpl))
}
const told = { ru: untold('ru'), en: untold('en') }
const live = { ru: liveKeys('ru'), en: liveKeys('en') }

/** Found, false and missed keys of a frame. A key whose cell shows with its label cut or under the tooltip may be found. */
function verdict({ frame, found }: FrameResult) {
  const shown = new Set(frame.only ?? frame.cells.flatMap((cell) => live[frame.lang].get(cell.tpl) ?? [cell.tpl]))
  const expected = frame.only ?? frame.cells.filter((cell) => cell.label && appKeys.has(cell.tpl)).map((cell) => cell.tpl)
  const wrong = found.filter((id) => !shown.has(id))
  const missed = expected.filter((id) => !found.includes(id))
  return { expected, right: found.filter((id) => shown.has(id)), wrong, missed }
}

const short = (id: string) => catalogs.ru.find((item) => item.id === id)?.shortName ?? meta.keys.find((key) => key.tpl === id)?.sptShort ?? id

beforeAll(async () => {
  const langPath = join(root, 'electron/tessdata')
  worker = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
  // The app's settings (electron/collectorScan.ts).
  await worker.setParameters({ tessedit_pageseg_mode: '11', user_defined_dpi: '300' })
  for (const frame of meta.frames) results.set(frame.file, await scanFrame(frame))
}, 600_000)

afterAll(async () => {
  await worker?.terminate()
  const out = process.env.KEY_SCAN_TABLE
  if (!out) return
  writeFileSync(out, JSON.stringify({
    frames: [...results.values()].map((result) => ({ file: result.frame.file, ...verdict(result) })),
    untold: [...told.ru],
    untoldEn: [...told.en],
    labels: [...results.values()].flatMap(({ frame, labels }) => labels.map((label) => ({
      frame: frame.file, text: label.text, second: label.second, box: label.box, tpl: label.cell?.tpl ?? null, labelShown: label.cell?.label ?? null, ids: label.ids,
    }))),
  }, null, 1))
})

describe('«Найти ключи» on the frames of the game', () => {
  it('report 236: the four dorm keys of the player\'s frame, and no «РБ-СТ»', () => {
    const result = results.get('report-236.webp')!
    const { wrong, missed } = verdict(result)
    const read = result.labels.map((label) => label.text).join(' | ')
    expect(wrong.map(short), read).toEqual([])
    expect(missed.map(short), read).toEqual([])
  })

  // Owner, 25.11.2026 («проводи тесты и обучение до тех пор пока не научишь определять в точности ключи»): his own frame of the
  // live game at 3440×1440 — the search window of his stash with «Времянка», «Спецтех», «Заводская», «ЭП подс.», «Охрана».
  it('the owner\'s frame of the live game: the four keys a label tells, «Времянка» asked to hover, nothing else', () => {
    const result = results.get('owner-live-3440.webp')!
    const { wrong, missed } = verdict(result)
    const read = result.labels.map((label) => label.text).join(' | ')
    expect(wrong.map(short), read).toEqual([])
    expect(missed.map(short), read).toEqual([])
    const { matcher } = keyScanLists(catalogs.ru, [])
    expect(matcher.shared(result.labels.map((label) => label.text).join('\n')).map((entry) => entry.label), read).toEqual(['Времянка'])
  })

  it('takes no label of the offline stash for another key', () => {
    for (const result of results.values()) {
      if (result.frame.only) continue
      const { wrong } = verdict(result)
      const reads = result.labels.filter((label) => label.ids.some((id) => wrong.includes(id))).map((label) => `${label.text} → ${label.ids.map(short).join(', ')} (${label.cell ? short(label.cell.tpl) : '?'})`)
      expect(wrong.map(short), `${result.frame.file}: ${reads.join('; ')}`).toEqual([])
    }
  })

  it('finds the keys of the offline stash a label tells, some misses allowed', () => {
    for (const lang of ['ru', 'en'] as const) {
      const frames = [...results.values()].filter((result) => !result.frame.only && result.frame.lang === lang)
      const expected = new Set(frames.flatMap((result) => verdict(result).expected))
      const tellable = [...expected].filter((id) => !told[lang].has(id))
      // A key counts as found when one of its frames found it.
      const never = tellable.filter((id) => !frames.some((result) => result.found.includes(id)))
      expect(tellable.length, lang).toBeGreaterThan(180)
      expect(never.length, `${lang}: ${never.map(short).join(', ')}`).toBeLessThanOrEqual(MISSES_ALLOWED[lang])
    }
  })
})
