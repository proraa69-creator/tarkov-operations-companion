import { describe, expect, it } from 'vitest'
import type { Bitmap } from './tooltipDetect'
import { createLookupMemory, LOOKUP_MEMORY, readGameTooltip, retryOcrReadings, type LookupMemoryStorage, type TooltipShot } from './tooltipLookup'
import { foldTooltipText } from './tooltipMatch'
import { namesFromDictionaries } from './itemNames'

function screen(tooltipText: number | null): TooltipShot {
  const width = 400, height = 160
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < data.length; index += 4) { data[index] = 24; data[index + 1] = 24; data[index + 2] = 24; data[index + 3] = 255 }
  const fill = (x: number, y: number, w: number, h: number, value: number) => {
    for (let row = y; row < y + h; row += 1) for (let column = x; column < x + w; column += 1) {
      const index = (row * width + column) * 4
      data[index] = value; data[index + 1] = value; data[index + 2] = value
    }
  }
  if (tooltipText != null) {
    fill(111, 60, 180, 34, 138)
    fill(112, 61, 178, 32, 10)
    // Different "names" differ in letter width.
    for (let letter = 123; letter + 4 + tooltipText <= 111 + 180 - 12; letter += 9 + tooltipText) fill(letter, 71, 4 + tooltipText, 12, 225)
  }
  return { image: { width, height, data } satisfies Bitmap, cursor: { x: 100, y: 70 }, unit: 1 }
}

/** A clock the lookup advances by sleeping, and a scripted sequence of screens. */
function run(screens: Array<TooltipShot>, read: (index: number) => string, known: Record<string, string>) {
  let time = 0
  let grabs = 0
  const ocr: number[] = []
  const shown: number[] = []
  return readGameTooltip({
    grab: async () => screens[Math.min(grabs++, screens.length - 1)]!,
    recognize: async () => { ocr.push(grabs - 1); return read(grabs - 1) },
    match: async (text) => known[text] ?? null,
    onTooltip: () => shown.push(grabs - 1),
    now: () => time,
    sleep: async (ms) => { time += ms },
  }).then((result) => ({ ...result, grabs, ocr, shown, time }))
}

describe('reading the game tooltip after the key press', () => {
  it('widens capture when a large item places the tooltip outside the initial crop', async () => {
    let time = 0, wideGrabs = 0
    const result = await readGameTooltip({
      grab: async () => screen(null),
      grabWide: async () => { wideGrabs++; return screen(0) },
      recognize: async () => 'Большой рюкзак',
      match: async text => text === 'Большой рюкзак' ? 'backpack' : null,
      now: () => time,
      sleep: async ms => { time += ms },
    })
    expect(result.answer).toBe('backpack')
    expect(wideGrabs).toBe(1)
  })
  it('waits for the tooltip the game shows a moment after pointing, reading only once it is there', async () => {
    const screens = [screen(null), screen(null), screen(null), screen(null), screen(0)]
    const result = await run(screens, () => 'Бинт', { 'Бинт': 'bandage' })
    expect(result.answer).toBe('bandage')
    expect(result.ocr).toEqual([4])
    expect(result.shown).toEqual([4])
  })

  it('gives up when no tooltip appears in time', async () => {
    const result = await run([screen(null)], () => '', {})
    expect(result.answer).toBeNull()
    expect(result.rect).toBeNull()
    expect(result.ocr).toEqual([])
    expect(result.time).toBeGreaterThanOrEqual(900)
    expect(result.time).toBeLessThan(1000)
  })

  it('reads a changed tooltip again (the previous item’s name first, then this one’s)', async () => {
    const screens = [screen(0), screen(0), screen(0), screen(2)]
    const result = await run(screens, (index) => (index < 3 ? 'Шум' : 'Бинт'), { 'Бинт': 'bandage' })
    expect(result.answer).toBe('bandage')
    // The same unmatched tooltip is not read over and over: three variants once, then the new one.
    expect(result.ocr.filter((index) => index < 3)).toHaveLength(3)
    expect(result.tries.at(-1)).toBe('Бинт')
  })

  it('stops after a while when the tooltip cannot be matched', async () => {
    const result = await run([screen(0)], () => 'Шум', {})
    expect(result.answer).toBeNull()
    expect(result.rect).not.toBeNull()
    expect(result.tries).toEqual(['Шум', 'Шум', 'Шум'])
    expect(result.time).toBeGreaterThanOrEqual(1800)
  })

  it('keeps the first grab with the tooltip for the picture — before the app’s own card could show', async () => {
    const screens = [screen(null), screen(0), screen(2), screen(2)]
    const result = await run(screens, () => 'Шум', {})
    expect(result.answer).toBeNull()
    expect(result.first?.shot).toBe(screens[1])
    expect(result.shot).toBe(screens[3])
    expect(result.first?.unit).toBe(1)
    expect(result.unit).toBe(1)
    expect(result.latest).toBe(screens[3])
    expect(result.grabs).toBeGreaterThan(4)
  })

  it('reports the grabs when no tooltip shows, for the log', async () => {
    const result = await run([screen(null)], () => '', {})
    expect(result.first).toBeNull()
    expect(result.latest).not.toBeNull()
    expect(result.grabs).toBeGreaterThan(10)
  })
})

describe('second-attempt OCR readings', () => {
  /** A tooltip box with one or two lines of "letters". */
  function box(lines: number): TooltipShot {
    const width = 300, height = 90
    const data = new Uint8Array(width * height * 4)
    for (let index = 0; index < data.length; index += 4) data.set([12, 12, 12, 255], index)
    for (let line = 0; line < lines; line += 1) {
      const top = 14 + line * 20
      for (let y = top; y < top + 11; y += 1) for (let x = 20; x < 250; x += 1) if (x % 7 < 4) data.set([220, 220, 220, 255], (y * width + x) * 4)
    }
    return { image: { width, height, data }, cursor: { x: 290, y: 85 }, unit: 1 }
  }
  const rect = { x: 4, y: 4, width: 290, height: 60 }

  it('reads the whole box other ways than the first pass', () => {
    const shot = box(1)
    const readings = retryOcrReadings(shot.image, rect, shot.cursor, shot.unit)
    expect(readings).toHaveLength(2)
    expect(readings.every((reading) => reading.length === 1)).toBe(true)
    // Black text on white, cut at the box's own level: the letters black, the background white.
    const [cut] = readings[0]!
    const values = new Set<number>()
    for (let index = 0; index < cut!.data.length; index += 4) values.add(cut!.data[index]!)
    expect([...values].sort((a, b) => a - b)).toEqual([0, 255])
  })

  it('reads each line on its own when the box holds two (the OCR reads one line)', () => {
    const shot = box(2)
    const readings = retryOcrReadings(shot.image, rect, shot.cursor, shot.unit)
    expect(readings).toHaveLength(3)
    expect(readings[2]).toHaveLength(2)
    expect(readings[2]![0]!.height).toBeLessThan(readings[0]![0]!.height)
  })

  it('gives nothing for a box too small to read', () => {
    const shot = box(1)
    expect(retryOcrReadings(shot.image, { x: 4, y: 4, width: 3, height: 3 }, shot.cursor, 1)).toEqual([])
  })
})

describe('remembering what the second attempt found', () => {
  const storage = () => {
    const values = new Map<string, string>()
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, values }
  }

  it('names the item at once for the same reading, also written with look-alike letters', () => {
    const store = storage()
    const memory = createLookupMemory(() => store, foldTooltipText)
    memory.remember(['Пачка патр0нов 5.45х39мм БП', ''], 'bp-pack')
    expect(memory.recall('Пачка патр0нов 5.45x39мм БП')).toBe('bp-pack')
    expect(memory.recall('Пачка патронов 5.45x39мм БС')).toBeNull()
    // Lives in storage: another app start reads it back.
    expect(createLookupMemory(() => store, foldTooltipText).recall('Пачка патр0нов 5.45х39мм БП')).toBe('bp-pack')
  })

  it('keeps only readings long enough and plausible, and drops one whose item no longer fits', () => {
    const memory = createLookupMemory(() => storage(), foldTooltipText)
    memory.remember(['ПМ', 'Шум и мусор', 'Магазин на 10 патронов'], 'mag', (text) => text !== 'Шум и мусор')
    expect(memory.recall('ПМ')).toBeNull()
    expect(memory.recall('Шум и мусор')).toBeNull()
    expect(memory.recall('Магазин на 10 патронов', (id) => id !== 'mag')).toBeNull()
    expect(memory.recall('Магазин на 10 патронов')).toBeNull()
  })

  it('holds a bounded number of readings, the least recently used going first', () => {
    const memory = createLookupMemory(() => storage(), foldTooltipText, { ...LOOKUP_MEMORY, limit: 3 })
    memory.remember(['reading one'], 'a')
    memory.remember(['reading two'], 'b')
    memory.remember(['reading three'], 'c')
    expect(memory.recall('reading one')).toBe('a')
    memory.remember(['reading four'], 'd')
    expect(memory.recall('reading two')).toBeNull()
    expect(memory.recall('reading one')).toBe('a')
    expect(memory.recall('reading four')).toBe('d')
    expect(LOOKUP_MEMORY.limit).toBe(500)
  })

  it('works without storage (private window, full or broken storage)', () => {
    const broken: LookupMemoryStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') } }
    const memory = createLookupMemory(() => broken, foldTooltipText)
    memory.remember(['Изолента синяя'], 'tape')
    expect(memory.recall('Изолента синяя')).toBe('tape')
    const garbled = { getItem: () => '{not json', setItem: () => {} }
    expect(createLookupMemory(() => garbled, foldTooltipText).recall('Изолента синяя')).toBeNull()
    expect(createLookupMemory(() => null, foldTooltipText).recall('Изолента синяя')).toBeNull()
  })
})

describe('item names in both game languages', () => {
  it('collects names and short names by id from tarkov.dev dictionaries', () => {
    const names = namesFromDictionaries([
      { '5448be9a4bdc2dfd2f8b456a Name': 'Ручная граната РГД-5', '5448be9a4bdc2dfd2f8b456a ShortName': 'РГД-5', '5448be9a4bdc2dfd2f8b456a Description': '…', Other: 'x' },
      { '5448be9a4bdc2dfd2f8b456a Name': 'RGD-5 hand grenade', '5448be9a4bdc2dfd2f8b456a ShortName': 'RGD-5' },
    ])
    expect(names.get('5448be9a4bdc2dfd2f8b456a')).toEqual([{ name: 'Ручная граната РГД-5', shortName: 'РГД-5' }, { name: 'RGD-5 hand grenade', shortName: 'RGD-5' }])
    expect(names.size).toBe(1)
  })
})
