import { describe, expect, it } from 'vitest'
import { bgraToPgm, bgraToPpm, picturePrint, PRINT_SIZE } from './ocrPicture'
import { similarFrame, unchangedFrame } from '../src/import/storyScanTiming'

/** A BGRA picture filled with one colour. */
function picture(width: number, height: number, [b, g, r]: [number, number, number]) {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < data.length; index += 4) { data[index] = b; data[index + 1] = g; data[index + 2] = r; data[index + 3] = 255 }
  return data
}

/** The same bytes at an odd offset (no 32-bit view possible). */
function unaligned(data: Uint8Array) {
  const copy = new Uint8Array(data.length + 1)
  copy.set(data, 1)
  return copy.subarray(1)
}

function fill(data: Uint8Array, width: number, rect: { x: number; y: number; w: number; h: number }, [b, g, r]: [number, number, number]) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) data.set([b, g, r, 255], (y * width + x) * 4)
}

describe('OCR pictures without PNG', () => {
  it('writes a binary PGM with the grey Tesseract would take (0.3 R + 0.5 G + 0.2 B)', () => {
    const data = new Uint8Array([
      0, 0, 0, 255, 255, 255, 255, 255, 120, 120, 120, 255,
      0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255,
    ])
    const pgm = bgraToPgm(data, 3, 2)
    const head = 'P5\n3 2\n255\n'
    expect(pgm.subarray(0, head.length).toString('latin1')).toBe(head)
    // black, white and a grey stay what they are; red, green and blue weigh 0.3, 0.5 and 0.2
    expect([...pgm.subarray(head.length)]).toEqual([0, 255, 120, 77, 128, 51])
    expect(bgraToPgm(unaligned(data), 3, 2).equals(pgm)).toBe(true)
  })

  it('keeps every grey level of a black-and-white tooltip picture exactly', () => {
    const data = new Uint8Array(256 * 4)
    for (let level = 0; level < 256; level += 1) data.set([level, level, level, 255], level * 4)
    expect([...bgraToPgm(data, 256, 1).subarray('P5\n256 1\n255\n'.length)]).toEqual(Array.from({ length: 256 }, (_, level) => level))
  })

  it('writes a binary PPM with the colours in RGB order', () => {
    const data = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255])
    const ppm = bgraToPpm(data, 2, 1)
    const head = 'P6\n2 1\n255\n'
    expect(ppm.subarray(0, head.length).toString('latin1')).toBe(head)
    expect([...ppm.subarray(head.length)]).toEqual([30, 20, 10, 60, 50, 40])
    expect(bgraToPpm(unaligned(data), 2, 1).equals(ppm)).toBe(true)
  })
})

describe('the print of the game screen', () => {
  it('is the mean colour of each cell', () => {
    const print = picturePrint(picture(1920, 1080, [12, 34, 56]), 1920, 1080)
    expect(print.length).toBe(PRINT_SIZE.width * PRINT_SIZE.height * 4)
    for (let index = 0; index < print.length; index += 4) expect([...print.subarray(index, index + 4)]).toEqual([12, 34, 56, 255])
  })

  it('shows a changed counter, but not a few levels of noise', () => {
    const width = 1920, height = 1080
    const before = picture(width, height, [30, 30, 30])
    const noise = before.slice()
    for (let index = 0; index < noise.length; index += 4 * 7) noise[index] = 33
    expect(unchangedFrame(picturePrint(before, width, height), picturePrint(noise, width, height))).toBe(true)
    // «2/5» → «3/5»: a digit's strokes change inside one 16 × 16 cell.
    const counter = before.slice()
    fill(counter, width, { x: 805, y: 403, w: 3, h: 11 }, [220, 220, 220])
    fill(counter, width, { x: 809, y: 403, w: 3, h: 6 }, [220, 220, 220])
    const a = picturePrint(before, width, height), b = picturePrint(counter, width, height)
    expect(unchangedFrame(a, b)).toBe(false)
    expect(similarFrame(a, b)).toBe(true)
  })

  it('reads a 4K copy with as many samples a cell as a 1080p one', () => {
    const small = picture(1920, 1080, [0, 0, 0]), large = picture(3840, 2160, [0, 0, 0])
    fill(small, 1920, { x: 0, y: 0, w: 960, h: 1080 }, [200, 100, 50])
    fill(large, 3840, { x: 0, y: 0, w: 1920, h: 2160 }, [200, 100, 50])
    expect(unchangedFrame(picturePrint(small, 1920, 1080), picturePrint(large, 3840, 2160))).toBe(true)
    expect(picturePrint(unaligned(small), 1920, 1080)).toEqual(picturePrint(small, 1920, 1080))
  })
})
