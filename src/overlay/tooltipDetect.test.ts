import { describe, expect, it } from 'vitest'
import { findTooltip, ocrVariants, tooltipForOcr, type Bitmap } from './tooltipDetect'

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

/** Blends a black box over what is there (the game draws its tooltip semi-transparent). */
function shade(image: Bitmap, x: number, y: number, w: number, h: number, alpha: number) {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) {
      const index = (row * image.width + column) * 4
      for (let channel = 0; channel < 3; channel += 1) image.data[index + channel] = Math.round(image.data[index + channel]! * (1 - alpha) + 10 * alpha)
    }
  }
}

/** The EFT name tooltip: black box, 1 px grey frame, a line of white "letters" with equal padding. */
function tooltip(image: Bitmap, x: number, y: number, w: number, h: number, alpha = 1) {
  fill(image, x, y, w, 1, 138); fill(image, x, y + h - 1, w, 1, 138); fill(image, x, y, 1, h, 138); fill(image, x + w - 1, y, 1, h, 138)
  shade(image, x + 1, y + 1, w - 2, h - 2, alpha)
  for (let letter = x + 12; letter + 5 <= x + w - 12; letter += 9) fill(image, letter, y + Math.round(h / 2) - 6, 5, 12, 225)
}

/** An inventory cell: grey frame around an item picture with a short white label. */
function cell(image: Bitmap, x: number, y: number, size: number, picture = 70) {
  fill(image, x, y, size, size, 80)
  fill(image, x + 1, y + 1, size - 2, size - 2, 24)
  fill(image, x + 8, y + 14, size - 16, size - 24, picture)
  fill(image, x + size - 30, y + 3, 26, 8, 230)
}

/** The mouse arrow: white with a black outline, hotspot at (x, y). */
function arrow(image: Bitmap, x: number, y: number) {
  for (let row = 0; row < 18; row += 1) fill(image, x, y + row, Math.max(1, Math.round(row * 0.7)), 1, row % 17 ? 245 : 0)
  fill(image, x, y, 1, 18, 0)
}

describe('game item tooltip', () => {
  it('finds the name box next to the cursor among inventory cells', () => {
    const image = canvas(600, 300)
    for (let x = 20; x < 580; x += 64) for (let y = 20; y < 280; y += 64) cell(image, x, y, 63)
    tooltip(image, 262, 120, 160, 34)
    const rect = findTooltip(image, { x: 251, y: 150 })!
    expect(rect).not.toBeNull()
    expect(Math.abs(rect.y - 122)).toBeLessThanOrEqual(1)
    expect(Math.abs(rect.x - 264)).toBeLessThanOrEqual(2)
    expect(Math.abs(rect.width - 156)).toBeLessThanOrEqual(4)
  })

  it('ignores inventory cells, empty boxes and a container header bar', () => {
    const image = canvas(700, 300)
    for (let x = 20; x < 680; x += 64) for (let y = 20; y < 280; y += 64) cell(image, x, y, 63, 40)
    // An empty framed box, and a header: a wide bar with its caption at one side.
    fill(image, 50, 50, 120, 36, 138); fill(image, 51, 51, 118, 34, 10)
    fill(image, 300, 200, 360, 26, 120); fill(image, 301, 201, 358, 24, 8)
    for (let letter = 330; letter < 400; letter += 9) fill(image, letter, 207, 5, 12, 220)
    expect(findTooltip(image, { x: 60, y: 60 })).toBeNull()
    expect(findTooltip(image, { x: 400, y: 150 })).toBeNull()
  })

  it('finds the box when the mouse arrow covers its edge', () => {
    const image = canvas(500, 200)
    tooltip(image, 111, 80, 200, 34)
    arrow(image, 100, 84)
    const rect = findTooltip(image, { x: 100, y: 84 })!
    expect(rect).not.toBeNull()
    expect(Math.abs(rect.x - 113)).toBeLessThanOrEqual(2)
  })

  it('finds a semi-transparent box drawn over a big item picture, far from the cursor', () => {
    const image = canvas(900, 500)
    // A 4×4 backpack: bright picture; its tooltip at the item's corner, ~200 px from the cursor.
    fill(image, 300, 150, 252, 252, 150)
    for (let stripe = 310; stripe < 540; stripe += 23) fill(image, stripe, 160, 6, 230, 210)
    tooltip(image, 305, 120, 230, 36, 0.85)
    const rect = findTooltip(image, { x: 430, y: 330 })!
    expect(rect).not.toBeNull()
    expect(Math.abs(rect.y - 122)).toBeLessThanOrEqual(1)
  })

  it('scales with the screen (1440p)', () => {
    const image = canvas(900, 400)
    tooltip(image, 300, 150, 260, 46)
    const rect = findTooltip(image, { x: 285, y: 170 }, 1440 / 1080)!
    expect(Math.abs(rect.y - 153)).toBeLessThanOrEqual(1)
    expect(Math.abs(rect.x - 303)).toBeLessThanOrEqual(1)
  })

  it('prepares black text on white, upscaled smoothly, with a margin', () => {
    const image = canvas(300, 100)
    tooltip(image, 20, 20, 120, 36)
    const rect = findTooltip(image, { x: 9, y: 30 })!
    const prepared = tooltipForOcr(image, rect, 3)
    expect(prepared.width).toBe(rect.width * 3 + 24)
    expect(prepared.data[0]).toBe(255)
    const inside = (x: number, y: number) => prepared.data[((12 + (y - rect.y) * 3) * prepared.width + 12 + (x - rect.x) * 3 + 1) * 4]
    expect(inside(34, 38)).toBe(0)
    expect(inside(30, 24)).toBe(255)
    const variants = ocrVariants(image, rect, { x: 9, y: 30 })
    expect(variants).toHaveLength(3)
    // Pure black and white in the first variant.
    expect(new Set(Array.from(variants[0]!.data.filter((_, index) => index % 4 === 0)))).toEqual(new Set([0, 255]))
  })
})
