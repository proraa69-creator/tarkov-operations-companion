/**
 * Pictures for the quest scanner and for Tesseract, made straight from the screen copy's BGRA bytes (Windows GDI, Electron
 * bitmaps) on the main process:
 *   - the print that tells whether the game's screen changed since the last look: one pass over the copy, before any
 *     image object exists, so an unchanged screen costs no image work at all;
 *   - the OCR input as Netpbm (a header and the raw pixels, which Tesseract reads as they are) instead of PNG: compressing
 *     a 1920 × 1080 screen to PNG took hundreds of milliseconds of the main process for every reading, and Tesseract only
 *     unpacked it again. Grey pictures (the item card's tooltip, the Collector's labels) go as PGM; a colour game frame
 *     goes as PPM — the same pixels as the PNG had, so Tesseract reads exactly what it read before.
 */

const header = (magic: 'P5' | 'P6', width: number, height: number) => `${magic}\n${width} ${height}\n255\n`

/** The bytes as 32-bit words (BGRA little-endian: B in the low byte) when they are aligned for it; else null. */
function words(data: Uint8Array, pixels: number) {
  return data.byteOffset % 4 === 0 && data.byteLength >= pixels * 4 ? new Uint32Array(data.buffer, data.byteOffset, pixels) : null
}

/**
 * Binary PGM (P5) of a BGRA picture, in one allocation. The grey is Leptonica's (pixConvertRGBToGray: 0.3 R + 0.5 G
 * + 0.2 B): for a grey picture (B = G = R) exactly its value, as Tesseract would take it from a PNG.
 */
export function bgraToPgm(data: Uint8Array, width: number, height: number): Buffer {
  const head = header('P5', width, height)
  const pixels = width * height
  const out = Buffer.allocUnsafe(head.length + pixels)
  out.write(head, 0, 'latin1')
  const packed = words(data, pixels)
  if (packed) {
    for (let pixel = 0, target = head.length; pixel < pixels; pixel += 1, target += 1) {
      const value = packed[pixel]!
      out[target] = ((value & 255) * 51 + ((value >>> 8) & 255) * 128 + ((value >>> 16) & 255) * 77 + 128) >> 8
    }
  } else {
    for (let pixel = 0, index = 0, target = head.length; pixel < pixels; pixel += 1, index += 4, target += 1) {
      out[target] = (data[index]! * 51 + data[index + 1]! * 128 + data[index + 2]! * 77 + 128) >> 8
    }
  }
  return out
}

/** Binary PPM (P6) of a BGRA picture: RGB, three bytes a pixel, in one allocation. */
export function bgraToPpm(data: Uint8Array, width: number, height: number): Buffer {
  const head = header('P6', width, height)
  const pixels = width * height
  const out = Buffer.allocUnsafe(head.length + pixels * 3)
  out.write(head, 0, 'latin1')
  const packed = words(data, pixels)
  if (packed) {
    for (let pixel = 0, target = head.length; pixel < pixels; pixel += 1, target += 3) {
      const value = packed[pixel]!
      out[target] = (value >>> 16) & 255
      out[target + 1] = (value >>> 8) & 255
      out[target + 2] = value & 255
    }
  } else {
    for (let pixel = 0, index = 0, target = head.length; pixel < pixels; pixel += 1, index += 4, target += 3) {
      out[target] = data[index + 2]!
      out[target + 1] = data[index + 1]!
      out[target + 2] = data[index]!
    }
  }
  return out
}

/** The print's grid: about 16 × 16 screen pixels a cell at 1080p, so a changed digit shows. */
export const PRINT_SIZE = { width: 120, height: 68 }

/**
 * The mean colour of each cell of a `PRINT_SIZE` grid over a BGRA picture (4 bytes a cell, BGRA, alpha 255). About 8 × 8
 * samples a cell whatever the screen (every other pixel at 1080p, every fourth at 4K): plenty for a cell's mean, and a
 * 4K copy costs no more than a 1080p one.
 */
export function picturePrint(data: Uint8Array, width: number, height: number, size = PRINT_SIZE): Uint8Array {
  const print = new Uint8Array(size.width * size.height * 4)
  if (width <= 0 || height <= 0) return print
  const step = Math.max(1, Math.round(Math.min(width / size.width, height / size.height) / 8))
  const sums = new Float64Array(size.width * 3)
  const counts = new Uint32Array(size.width)
  // The cell column of every pixel column.
  const cellOf = new Uint16Array(width)
  for (let x = 0; x < width; x += 1) cellOf[x] = Math.min(size.width - 1, Math.floor(x * size.width / width))
  const packed = words(data, width * height)
  for (let row = 0; row < size.height; row += 1) {
    sums.fill(0)
    counts.fill(0)
    const y0 = Math.floor(row * height / size.height)
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * height / size.height))
    for (let y = y0; y < y1; y += step) {
      for (let x = 0; x < width; x += step) {
        const cell = cellOf[x]!
        const at = cell * 3
        if (packed) {
          const value = packed[y * width + x]!
          sums[at] += value & 255
          sums[at + 1] += (value >>> 8) & 255
          sums[at + 2] += (value >>> 16) & 255
        } else {
          const index = (y * width + x) * 4
          sums[at] += data[index]!
          sums[at + 1] += data[index + 1]!
          sums[at + 2] += data[index + 2]!
        }
        counts[cell] += 1
      }
    }
    for (let cell = 0; cell < size.width; cell += 1) {
      const count = counts[cell] || 1
      const target = (row * size.width + cell) * 4
      print[target] = Math.round(sums[cell * 3]! / count)
      print[target + 1] = Math.round(sums[cell * 3 + 1]! / count)
      print[target + 2] = Math.round(sums[cell * 3 + 2]! / count)
      print[target + 3] = 255
    }
  }
  return print
}
