import { describe, expect, it } from 'vitest'
import {
  cleanColor, confidenceToMask, dataUrlBase64, fitView, fontCss, frameToSource, fullMask, layoutText, maskBounds, maskCoverage, moved, newTextLayer, panView,
  PNG_SIDES, sourceSize, sourceToFrame, STICKER_FONTS, STICKER_SIDE, stampBrush, strokeBrush, TEXT_MARGIN, textAt, unionRect, wrapText, zoomAround,
  type TextLayer,
} from './stickerLayout'

/** «Новый стикер» of the iPhone admin (owner, 07.11.2026): the editor's parts that need no browser. */
/** A monospace measure: 10 frame pixels a character. */
const measure = (line: string) => Array.from(line).length * 10

describe('the photo in the sticker', () => {
  it('works on a photo scaled down to 1024 on its longest side', () => {
    expect(sourceSize(4032, 3024)).toEqual({ width: 1024, height: 768 })
    expect(sourceSize(600, 900)).toEqual({ width: 600, height: 900 })
    expect(sourceSize(3000, 10)).toEqual({ width: 1024, height: 3 })
  })

  it('fits the person (or the whole photo) into the frame with a margin, centred; frame and source points map back and forth', () => {
    const view = fitView(1000, 800, { x: 400, y: 100, width: 200, height: 600 })
    // 600 source pixels tall into 512 − 2 × 24.
    expect(view.scale).toBeCloseTo(464 / 600)
    expect(sourceToFrame(view, { x: 500, y: 400 })).toEqual({ x: 256, y: 256 })
    const whole = fitView(1000, 500, null)
    expect(whole.scale).toBeCloseTo(0.464)
    expect(sourceToFrame(whole, { x: 0, y: 0 })).toEqual({ x: 24, y: 140 })
    const point = { x: 123, y: 456 }
    const back = frameToSource(view, sourceToFrame(view, point))
    expect(back.x).toBeCloseTo(point.x)
    expect(back.y).toBeCloseTo(point.y)
  })

  it('zooms around a point that stays where it is, within its limits; moves by a finger', () => {
    const view = { scale: 0.5, x: 10, y: 20 }
    const centre = { x: 256, y: 256 }
    const zoomed = zoomAround(view, 2, centre)
    expect(zoomed.scale).toBe(1)
    const under = frameToSource(view, centre)
    const after = sourceToFrame(zoomed, under)
    expect(after.x).toBeCloseTo(256)
    expect(after.y).toBeCloseTo(256)
    expect(zoomAround(view, 1000, centre).scale).toBe(8)
    expect(zoomAround(view, 0.0001, centre).scale).toBe(0.05)
    expect(panView(view, 5, -5)).toEqual({ scale: 0.5, x: 15, y: 15 })
  })
})

describe('the cut-out mask', () => {
  it('turns the segmenter\'s confidence into a soft-edged mask; finds the person\'s bounds and share', () => {
    expect(Array.from(confidenceToMask([0, 90, 127, 165, 255]))).toEqual([0, 0, 126, 255, 255])
    const width = 10
    const height = 8
    const mask = new Uint8ClampedArray(width * height)
    for (let y = 2; y <= 5; y += 1) for (let x = 3; x <= 6; x += 1) mask[y * width + x] = 255
    expect(maskBounds(mask, width, height)).toEqual({ x: 3, y: 2, width: 4, height: 4 })
    expect(maskCoverage(mask)).toBeCloseTo(16 / 80)
    expect(maskBounds(new Uint8ClampedArray(80), width, height)).toBeNull()
    expect(maskCoverage(new Uint8ClampedArray(0))).toBe(0)
    expect(Array.from(fullMask(2, 2))).toEqual([255, 255, 255, 255])
  })

  it('«Стереть» clears a round dab with a soft edge, «Вернуть» brings it back; only inside the photo', () => {
    const width = 40
    const height = 40
    const mask = fullMask(width, height)
    const changed = stampBrush(mask, width, height, 20, 20, 6, 'erase')
    expect(changed).toEqual({ x: 14, y: 14, width: 13, height: 13 })
    expect(mask[20 * width + 20]).toBe(0)
    // Soft towards the edge, untouched outside.
    expect(mask[20 * width + 25]).toBeGreaterThan(0)
    expect(mask[20 * width + 25]).toBeLessThan(255)
    expect(mask[20 * width + 30]).toBe(255)
    // Erasing never adds back; restoring never takes away.
    const before = mask[20 * width + 25]!
    stampBrush(mask, width, height, 20, 20, 2, 'erase')
    expect(mask[20 * width + 25]).toBe(before)
    stampBrush(mask, width, height, 20, 20, 6, 'restore')
    expect(mask[20 * width + 20]).toBe(255)
    expect(stampBrush(mask, width, height, -50, -50, 5, 'erase')).toBeNull()
    expect(stampBrush(mask, width, height, 0, 0, 3, 'erase')).toEqual({ x: 0, y: 0, width: 4, height: 4 })
  })

  it('a stroke leaves no gaps between its dabs, and says what it changed', () => {
    const width = 100
    const height = 20
    const mask = fullMask(width, height)
    const changed = strokeBrush(mask, width, height, { x: 5, y: 10 }, { x: 95, y: 10 }, 4, 'erase')
    for (let x = 5; x <= 95; x += 1) expect(mask[10 * width + x]).toBe(0)
    expect(changed).toEqual({ x: 1, y: 6, width: 99, height: 9 })
    expect(unionRect(null, { x: 1, y: 1, width: 1, height: 1 })).toEqual({ x: 1, y: 1, width: 1, height: 1 })
    expect(unionRect({ x: 0, y: 0, width: 2, height: 2 }, { x: 5, y: 5, width: 1, height: 1 })).toEqual({ x: 0, y: 0, width: 6, height: 6 })
  })
})

describe('the words', () => {
  const layer = (change: Partial<TextLayer> = {}): TextLayer => ({ ...newTextLayer([]), text: 'Привет', strokeWidth: 0, size: 40, ...change })

  it('five fonts with Cyrillic; a font\'s canvas name; colours of the colour inputs only', () => {
    expect(STICKER_FONTS.map((font) => font.id)).toEqual(['oswald', 'montserrat', 'rubik-mono', 'pacifico', 'pixel'])
    expect(fontCss('montserrat', 63.6)).toBe('900 64px "Raid Sticker Montserrat", "Arial Black", Arial, sans-serif')
    expect(fontCss('unknown', 20)).toBe(fontCss('oswald', 20))
    expect(cleanColor('#FFAA00', '#000000')).toBe('#ffaa00')
    expect(cleanColor('red', '#000000')).toBe('#000000')
  })

  it('a new line of words goes to the top, the next to the bottom; white with a black outline', () => {
    const first = newTextLayer([])
    const second = newTextLayer([first])
    expect([first.place, second.place]).toEqual(['top', 'bottom'])
    expect(first.id).not.toBe(second.id)
    expect([first.color, first.stroke, first.strokeWidth, first.text]).toEqual(['#ffffff', '#000000', 6, 'Текст'])
  })

  it('wraps by words, keeps the owner\'s line breaks, breaks a word longer than a line', () => {
    expect(wrapText('Голова глаза', 1000, measure)).toEqual(['Голова глаза'])
    expect(wrapText('Голова глаза ноги', 110, measure)).toEqual(['Голова', 'глаза ноги'])
    expect(wrapText('Раз\nдва', 1000, measure)).toEqual(['Раз', 'два'])
    expect(wrapText('Ааааааааааааааа', 50, measure)).toEqual(['Ааааа', 'ааааа', 'ааааа'])
    expect(wrapText('\n\nТекст\n\n', 1000, measure)).toEqual(['Текст'])
    expect(wrapText('', 100, measure)).toEqual([''])
  })

  it('lays the words out at the top, at the bottom or where a finger put them, always inside the sticker', () => {
    const top = layoutText(layer({ place: 'top' }), measure)
    expect(top.box.y).toBeCloseTo(TEXT_MARGIN)
    expect(top.x).toBe(STICKER_SIDE / 2)
    expect(top.box.width).toBe(60)
    const bottom = layoutText(layer({ place: 'bottom', text: 'Раз\nдва' }), measure)
    expect(bottom.box.y + bottom.box.height).toBeCloseTo(STICKER_SIDE - TEXT_MARGIN)
    expect(bottom.ys).toHaveLength(2)
    expect(bottom.ys[1]! - bottom.ys[0]!).toBeCloseTo(bottom.lineHeight)
    const free = layoutText(layer({ place: 'free', x: 100, y: 300 }), measure)
    expect(free.x).toBeCloseTo(100)
    expect(free.box.y + free.box.height / 2).toBeCloseTo(300)
    // Dragged past the edge: kept inside.
    const edge = layoutText(layer({ place: 'free', x: -500, y: 9000 }), measure)
    expect(edge.box.x).toBeCloseTo(TEXT_MARGIN)
    expect(edge.box.y + edge.box.height).toBeCloseTo(STICKER_SIDE - TEXT_MARGIN)
  })

  it('a tap finds the topmost words under it', () => {
    const layers = [layer({ id: 1, place: 'free', x: 256, y: 256 }), layer({ id: 2, place: 'free', x: 260, y: 256 }), layer({ id: 3, place: 'top' })]
    const layouts = layers.map((entry) => layoutText(entry, measure))
    expect(textAt(layers, layouts, { x: 256, y: 256 })?.id).toBe(2)
    expect(textAt(layers, layouts, { x: 256, y: 30 })?.id).toBe(3)
    expect(textAt(layers, layouts, { x: 20, y: 480 })).toBeUndefined()
  })
})

describe('order and saving', () => {
  it('moves a pack or a sticker one step; the same at an end', () => {
    expect(moved(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moved(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moved(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moved(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
    expect(moved(['a'], 'x', 1)).toEqual(['a'])
  })

  it('saves 512 × 512 first, smaller only for a busy photo; uploads the base64 of the PNG', () => {
    expect(PNG_SIDES[0]).toBe(512)
    expect([...PNG_SIDES].sort((a, b) => b - a)).toEqual([...PNG_SIDES])
    expect(dataUrlBase64('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=')
  })
})
