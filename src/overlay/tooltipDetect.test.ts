import { describe, expect, it } from 'vitest'
import { findTooltip, tooltipForOcr, type Bitmap } from './tooltipDetect'

function canvas(width: number, height: number, grey = 24): Bitmap {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < data.length; index += 4) { data[index] = grey; data[index + 1] = grey; data[index + 2] = grey; data[index + 3] = 255 }
  return { width, height, data }
}

function fill(image: Bitmap, x: number, y: number, w: number, h: number, value: number) {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) {
      const index = (row * image.width + column) * 4
      image.data[index] = value; image.data[index + 1] = value; image.data[index + 2] = value
    }
  }
}

/** The EFT name tooltip: black box, 1 px grey frame, a line of white "letters". */
function tooltip(image: Bitmap, x: number, y: number, w: number, h: number) {
  fill(image, x, y, w, h, 138)
  fill(image, x + 1, y + 1, w - 2, h - 2, 10)
  for (let letter = x + 10; letter < x + w - 14; letter += 9) fill(image, letter, y + Math.round(h / 2) - 6, 5, 12, 225)
}

/** An inventory cell: grey frame around an item picture (mid-grey noise) with a short white label. */
function cell(image: Bitmap, x: number, y: number, size: number) {
  fill(image, x, y, size, size, 110)
  fill(image, x + 1, y + 1, size - 2, size - 2, 70)
  fill(image, x + size - 30, y + 3, 26, 8, 230)
}

describe('game item tooltip', () => {
  it('finds the name box next to the cursor among inventory cells', () => {
    const image = canvas(600, 300)
    for (let x = 20; x < 580; x += 64) for (let y = 20; y < 280; y += 64) cell(image, x, y, 63)
    tooltip(image, 262, 120, 160, 38)
    const rect = findTooltip(image, { x: 255, y: 150 })!
    expect(rect.y).toBe(122)
    expect(Math.abs(rect.x - 264)).toBeLessThanOrEqual(3)
    expect(Math.abs(rect.width - 157)).toBeLessThanOrEqual(5)
  })

  it('ignores empty grid cells and boxes without text', () => {
    const image = canvas(400, 200)
    fill(image, 50, 50, 120, 36, 138)
    fill(image, 51, 51, 118, 34, 10)
    expect(findTooltip(image, { x: 60, y: 60 })).toBeNull()
  })

  it('scales with the screen (1440p)', () => {
    const image = canvas(900, 400)
    tooltip(image, 300, 150, 260, 50)
    const rect = findTooltip(image, { x: 290, y: 200 }, 1440 / 1080)!
    expect(rect.y).toBe(152)
    expect(Math.abs(rect.x - 302)).toBeLessThanOrEqual(3)
  })

  it('prepares black text on white, upscaled, for OCR', () => {
    const image = canvas(300, 100)
    tooltip(image, 20, 20, 120, 36)
    const rect = findTooltip(image, { x: 15, y: 30 })!
    const prepared = tooltipForOcr(image, rect, 3)
    expect(prepared.width).toBe(rect.width * 3)
    expect(prepared.data[0]).toBe(255)
    const letter = ((Math.round(36 / 2) - 4) * 3 * prepared.width + (10 * 3)) * 4
    expect(prepared.data[letter]).toBe(0)
  })
})
