import { describe, expect, it } from 'vitest'
import { inkParts, type GrayPicture, type PixelBox } from './levelDigits'
import { checkNameGlyphs, type OcrSymbol } from './nameGlyphs'
import { closeUp, wholeBox } from './__fixtures__/levelDigitLines'

/**
 * The nickname's glyphs checked by their shapes (owner, 25.11.2026: «это не O, это цифра 0 … научись правильно читать,
 * разделять, где цифра, а где буква»). On the game's own font: «1023456789» drawn in Bender as the close-up sees it.
 */
function benderLine() {
  const picture = closeUp('digits-20')
  const parts = inkParts(picture, wholeBox(picture))!
  // One box a glyph, left to right, in the picture's coordinates (Tesseract's symbol boxes hug the ink the same way).
  const boxes: PixelBox[] = parts.glyphs.filter((glyph) => glyph.pixels >= 6).sort((a, b) => a.x0 - b.x0)
    .map((glyph) => ({ x0: parts.x0 + glyph.x0, y0: parts.y0 + glyph.y0, x1: parts.x0 + glyph.x1, y1: parts.y0 + glyph.y1 }))
  return { picture, boxes }
}

/** A word Tesseract read on those glyphs: one character a glyph. */
function wordOf(text: string, boxes: PixelBox[]) {
  const symbols: OcrSymbol[] = [...text].map((char, index) => ({ text: char, bbox: boxes[index]! }))
  const bbox = { x0: Math.min(...boxes.map((box) => box.x0)), y0: Math.min(...boxes.map((box) => box.y0)), x1: Math.max(...boxes.map((box) => box.x1)), y1: Math.max(...boxes.map((box) => box.y1)) }
  return { text, bbox, symbols }
}

describe('checkNameGlyphs on the game\'s font', () => {
  it('the slashed zero is the digit whatever the OCR read: «O», «2», «a», «G»', () => {
    const { picture, boxes } = benderLine()
    expect(boxes).toHaveLength(10)
    for (const misread of ['O', '2', 'a', 'G', 'd', '8']) {
      // The first glyph «1» read as the letter «l»: letters are never changed by their shapes.
      const text = `l${misread}23456789`
      expect(checkNameGlyphs(picture, wordOf(text, boxes), text)).toEqual({ nickname: 'l023456789', zeros: '.0........' })
    }
  })

  it('a digit the OCR read is the digit its shape shows: the font\'s «3» read «8» or «5»', () => {
    const { picture, boxes } = benderLine()
    expect(checkNameGlyphs(picture, wordOf('l028456789', boxes), 'l028456789')?.nickname).toBe('l023456789')
    expect(checkNameGlyphs(picture, wordOf('l025456789', boxes), 'l025456789')?.nickname).toBe('l023456789')
  })

  it('one slashed zero read as two characters («62a» for «60») is one «0»', () => {
    const { picture, boxes } = benderLine()
    const zero = boxes[1]!
    const middle = Math.round((zero.x0 + zero.x1) / 2)
    const split = [boxes[0]!, { ...zero, x1: middle }, { ...zero, x0: middle + 1 }, ...boxes.slice(2)]
    expect(checkNameGlyphs(picture, wordOf('l2a23456789', split), 'l2a23456789')).toEqual({ nickname: 'l023456789', zeros: '.0........' })
  })

  it('only the nickname part of the word is checked, and nothing it cannot check', () => {
    const { picture, boxes } = benderLine()
    // The word went on past the name (the bar and the level read into it): only the name's characters count.
    expect(checkNameGlyphs(picture, wordOf('lO23456789', boxes), 'lO234')).toEqual({ nickname: 'l0234', zeros: '.0...' })
    // No symbols, or as many symbols as characters no more: nothing to check.
    expect(checkNameGlyphs(picture, { text: 'lO23', bbox: wordOf('lO23', boxes).bbox }, 'lO23')).toBeNull()
    expect(checkNameGlyphs(picture, { ...wordOf('lO2', boxes.slice(0, 3)), text: 'lO23' }, 'lO23')).toBeNull()
    // Not in the word, or no nickname of the game when checked (no letter in it).
    expect(checkNameGlyphs(picture, wordOf('lO23456789', boxes), 'Zed')).toBeNull()
    expect(checkNameGlyphs(picture, wordOf('1O23456789', boxes), '1O23456789')).toBeNull()
  })
})

/** Light glyphs on the game's dark panel, drawn: bars, rings (O, o) and a ring with the font's slash. */
function drawn(glyphs: Array<{ kind: 'bar' | 'ring' | 'slashed'; x: number; size: number }>): { picture: GrayPicture; boxes: PixelBox[] } {
  const width = 200, height = 60, gray = new Uint8Array(width * height).fill(30)
  const boxes: PixelBox[] = []
  for (const { kind, x, size } of glyphs) {
    const bottom = 50, top = bottom - size, half = size / 2, cx = x + half * 0.8, cy = top + half
    for (let py = top; py < bottom; py += 1) for (let px = x; px < x + size * 1.6; px += 1) {
      let ink: boolean
      if (kind === 'bar') ink = px < x + 6
      else {
        const dx = (px - cx) / (half * 0.8), dy = (py - cy) / half
        const r = Math.hypot(dx, dy)
        ink = r <= 1 && r >= 0.62
        // The slash from the upper right to the lower left.
        if (kind === 'slashed' && r < 0.7 && Math.abs(dx + dy) < 0.22) ink = true
      }
      if (ink && px < width) gray[py * width + px] = 230
    }
    const right = kind === 'bar' ? x + 5 : Math.ceil(cx + half * 0.8)
    boxes.push({ x0: kind === 'bar' ? x : Math.floor(cx - half * 0.8), y0: top, x1: right, y1: bottom - 1 })
  }
  return { picture: { width, height, gray }, boxes }
}

describe('checkNameGlyphs on drawn glyphs', () => {
  it('a «0» the OCR read on a round letter without the slash is that letter: O as tall as the line, o lower', () => {
    const { picture, boxes } = drawn([{ kind: 'bar', x: 10, size: 40 }, { kind: 'bar', x: 30, size: 40 }, { kind: 'ring', x: 50, size: 40 }, { kind: 'ring', x: 110, size: 26 }])
    const word = wordOf('ll00', boxes)
    expect(checkNameGlyphs(picture, word, 'll00')).toEqual({ nickname: 'llOo', zeros: '..oo' })
  })

  it('a ring with the slash is the zero', () => {
    const { picture, boxes } = drawn([{ kind: 'bar', x: 10, size: 40 }, { kind: 'bar', x: 30, size: 40 }, { kind: 'slashed', x: 50, size: 40 }])
    expect(checkNameGlyphs(picture, wordOf('llO', boxes), 'llO')).toEqual({ nickname: 'll0', zeros: '..0' })
  })
})
