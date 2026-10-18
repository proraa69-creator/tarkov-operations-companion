/**
 * Pixels of a stash photo and the small pictures cut out of it. Pure arithmetic on RGBA buffers (canvas `ImageData`
 * on the phone, sharp in tests): no DOM here.
 */
export interface Rgba {
  width: number
  height: number
  /** 4 bytes per pixel, RGBA. */
  data: Uint8Array | Uint8ClampedArray
}

export type Point = readonly [number, number]
/** Corners of a cell (or of several cells) in the photo: top left, top right, bottom right, bottom left. */
export type Quad = readonly [Point, Point, Point, Point]

/** Brightness 0–255 of every pixel (the mean of the three channels). */
export function grayOf(image: Rgba): Float32Array {
  const out = new Float32Array(image.width * image.height)
  for (let p = 0, i = 0; p < out.length; p += 1, i += 4) out[p] = (image.data[i]! + image.data[i + 1]! + image.data[i + 2]!) / 3
  return out
}

/**
 * The quad of the photo straightened into a `width` × `height` picture: every output pixel is the bilinear mix of the
 * four photo pixels around the point it maps to (bilinear between the quad's corners, enough for a flat screen seen at a
 * moderate angle, cell by cell).
 */
export function sampleQuad(image: Rgba, quad: Quad, width: number, height: number): Rgba {
  const [[ax, ay], [bx, by], [cx, cy], [dx, dy]] = quad
  const out = new Uint8ClampedArray(width * height * 4)
  const { width: w, height: h, data } = image
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height
    // left and right edges at this height
    const lx = ax + (dx - ax) * v, ly = ay + (dy - ay) * v
    const rx = bx + (cx - bx) * v, ry = by + (cy - by) * v
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width
      const sx = Math.min(w - 1.001, Math.max(0, lx + (rx - lx) * u - 0.5))
      const sy = Math.min(h - 1.001, Math.max(0, ly + (ry - ly) * u - 0.5))
      const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0
      const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4
      const o = (y * width + x) * 4
      for (let ch = 0; ch < 3; ch += 1) {
        out[o + ch] = (data[i00 + ch]! * (1 - tx) + data[i10 + ch]! * tx) * (1 - ty) + (data[i01 + ch]! * (1 - tx) + data[i11 + ch]! * tx) * ty
      }
      out[o + 3] = 255
    }
  }
  return { width, height, data: out }
}

/** The picture shrunk to `width` × `height` by averaging the source pixels each output pixel covers. */
export function resizeArea(image: Rgba, width: number, height: number): Rgba {
  const out = new Uint8ClampedArray(width * height * 4)
  const sx = image.width / width, sy = image.height / height
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let r = 0, g = 0, b = 0, n = 0
      for (let yy = y0; yy < y1 && yy < image.height; yy += 1) {
        for (let xx = x0; xx < x1 && xx < image.width; xx += 1) {
          const i = (yy * image.width + xx) * 4
          r += image.data[i]!; g += image.data[i + 1]!; b += image.data[i + 2]!; n += 1
        }
      }
      const o = (y * width + x) * 4
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255
    }
  }
  return { width, height, data: out }
}

/** A part of the picture copied out (clamped to the picture). */
export function crop(image: Rgba, x: number, y: number, width: number, height: number): Rgba {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y))
  const x1 = Math.min(image.width, Math.round(x + width)), y1 = Math.min(image.height, Math.round(y + height))
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let row = 0; row < h; row += 1) out.set(image.data.subarray(((y0 + row) * image.width + x0) * 4, ((y0 + row) * image.width + x0 + w) * 4), row * w * 4)
  return { width: w, height: h, data: out }
}
