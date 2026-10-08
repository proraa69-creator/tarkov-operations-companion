import { describe, expect, it } from 'vitest'
import type { Bitmap } from './tooltipDetect'
import { readGameTooltip, type TooltipShot } from './tooltipLookup'
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
