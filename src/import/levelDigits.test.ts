import { describe, expect, it } from 'vitest'
import { classifyDigit, grayPicture, readDigitShapes, readLevelShapes } from './levelDigits'
import { closeUp, wholeBox as all } from './__fixtures__/levelDigitLines'

describe('the level\'s digits read from their shapes', () => {
  it('reads every digit of the game\'s font, regular and bold', () => {
    for (const name of ['digits-20', 'digits-bold-18']) {
      const picture = closeUp(name)
      expect(readDigitShapes(picture, all(picture), 10)).toBe(1023456789)
    }
  })

  it('reads the player\'s «39» as 39 where Tesseract read «59», and a real «59» as 59', () => {
    // Tesseract on these very pixels (the app's models): card-39-18 and card-39-22 — whole pass «39», close-up «59»;
    // trader-39-20 — «LVL 59» both times; card-50-16 — «58» both times.
    for (const [name, level] of [['card-39-18', 39], ['card-39-22', 39], ['trader-39-20', 39], ['card-59-18', 59], ['card-50-16', 50]] as const) {
      const picture = closeUp(name)
      expect(readDigitShapes(picture, all(picture), 2)).toBe(level)
    }
  })

  it('a reading with another count of digits is not this number: «7» read for «37»', () => {
    const picture = closeUp('trader-37-19')
    expect(readDigitShapes(picture, all(picture), 2)).toBe(37)
    expect(readDigitShapes(picture, all(picture), 1)).toBeNull()
    expect(readLevelShapes(picture, all(picture), [7, 37, 37, null, undefined])).toEqual({ 1: null, 2: 37 })
  })

  it('dark digits on a light ground read the same', () => {
    const picture = closeUp('card-39-22')
    const inverted = { ...picture, gray: Uint8Array.from(picture.gray as Uint8Array, (value) => 255 - value) }
    expect(readDigitShapes(inverted, all(inverted), 2)).toBe(39)
  })

  it('no guess: touching glyphs, a flat or tiny picture give nothing', () => {
    // At 15 px the «0» and the «2» of the strip run together.
    const touching = closeUp('digits-15')
    expect(readDigitShapes(touching, all(touching), 10)).toBeNull()
    const flat = { width: 60, height: 30, gray: new Uint8Array(1800).fill(40) }
    expect(readDigitShapes(flat, all(flat), 2)).toBeNull()
    const tiny = { width: 12, height: 6, gray: Uint8Array.from({ length: 72 }, (_, index) => (index % 3 ? 30 : 220)) }
    expect(readDigitShapes(tiny, all(tiny), 1)).toBeNull()
  })

  it('a bare bar or a filled block is no digit', () => {
    expect(classifyDigit({ width: 3, height: 30, ink: () => true })).toBeNull()
    expect(classifyDigit({ width: 22, height: 30, ink: () => true })).toBeNull()
  })

  it('takes the grey of a BGRA bitmap (Electron\'s toBitmap)', () => {
    expect(Array.from(grayPicture([30, 60, 90, 255, 255, 255, 255, 255], 2, 1).gray)).toEqual([60, 255])
  })
})
