/**
 * The Collector scan reads only the item labels of the stash / container on screen, not the whole picture (owner,
 * 12.10.2026: «сканирование ищет долго и находит не все предметы… учитывай… когда они перевернуты или подсвечиваются
 * синей рамкой… начинает фризить»). Labels are the game's short names in light grey, drawn level at the top right of
 * every item — whether the item is turned or not. So:
 *   1. light, unsaturated pixels are label ink; item art is mostly coloured or dark;
 *   2. long straight runs of ink are frames (the blue frame of a highlighted item, borders), not letters: dropped;
 *   3. ink that lines up into a short, low strip crossing many strokes is a label; a label resting on light art is cut
 *      out of it;
 *   4. the labels are enlarged and stacked into one small picture for OCR.
 * Pure arithmetic on a pixel buffer: runs the same in the Electron main process and in tests.
 */
export interface Raster {
  width: number
  height: number
  /** 4 bytes per pixel, BGRA (Windows GDI, Electron bitmaps) or RGBA. */
  data: Uint8Array | Uint8ClampedArray
  order?: 'bgra' | 'rgba'
}

export interface Box { x: number; y: number; width: number; height: number }

/** Label ink: light grey with little colour (white labels; not the gold, red or blue of item art and frames). */
const MIN_BRIGHT = 140
const MAX_SATURATION = 55

/** How much of a label's ink the pixel is (0–255): full for light grey, fading with colour and darkness. */
function inkOf(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const saturation = max - Math.min(r, g, b)
  if (max < MIN_BRIGHT - 40 || saturation > MAX_SATURATION + 30) return 0
  const bright = Math.min(1, Math.max(0, (max - (MIN_BRIGHT - 40)) / 80))
  const grey = saturation <= MAX_SATURATION ? 1 : 1 - (saturation - MAX_SATURATION) / 30
  return Math.round(255 * bright * grey)
}

function channels(raster: Raster) {
  return raster.order === 'rgba' ? [0, 1, 2] as const : [2, 1, 0] as const
}

/** 1 where the pixel is label ink (light, unsaturated). */
export function inkMask(raster: Raster): Uint8Array {
  const { width, height, data } = raster
  const [ri, gi, bi] = channels(raster)
  const mask = new Uint8Array(width * height)
  for (let p = 0, i = 0; p < mask.length; p += 1, i += 4) {
    const r = data[i + ri]!, g = data[i + gi]!, b = data[i + bi]!
    const max = Math.max(r, g, b)
    mask[p] = max >= MIN_BRIGHT && max - Math.min(r, g, b) <= MAX_SATURATION ? 1 : 0
  }
  return mask
}

/**
 * The label strips on screen. `cell` is the inventory cell size in pixels (≈ 63 at 1080p, 85 at 1440p): labels are about
 * a sixth of a cell tall and never taller than a third of it.
 */
export function labelBoxes(raster: Raster, cell = Math.round(raster.height / 17)): Box[] {
  const { width, height } = raster
  const mask = dropLines(inkMask(raster), width, height, Math.max(12, Math.round(cell * 0.45)), Math.max(8, Math.round(cell * 0.3)))
  // Letters of a word, and words of one label, touch once small gaps are closed along the row.
  const joined = new Uint8Array(mask.length)
  const gap = Math.max(3, Math.round(cell * 0.06))
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    let last = -1
    for (let x = 0; x < width; x += 1) {
      if (!mask[row + x]) continue
      if (last >= 0 && x - last <= gap) joined.fill(1, row + last, row + x)
      joined[row + x] = 1
      last = x
    }
  }
  // Connected pieces of the joined ink.
  const label = new Int32Array(mask.length)
  const boxes: Array<Box & { ink: number }> = []
  const stack: number[] = []
  for (let start = 0; start < joined.length; start += 1) {
    if (!joined[start] || label[start]) continue
    const id = boxes.length + 1
    let x0 = width, y0 = height, x1 = -1, y1 = -1, ink = 0
    label[start] = id
    stack.push(start)
    while (stack.length) {
      const p = stack.pop()!
      const x = p % width, y = (p - x) / width
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      ink += mask[p]!
      if (x > 0 && joined[p - 1] && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1) }
      if (x < width - 1 && joined[p + 1] && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1) }
      if (y > 0 && joined[p - width] && !label[p - width]) { label[p - width] = id; stack.push(p - width) }
      if (y < height - 1 && joined[p + width] && !label[p + width]) { label[p + width] = id; stack.push(p + width) }
    }
    boxes.push({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, ink })
  }
  const minHeight = Math.max(5, Math.round(cell * 0.08))
  const maxHeight = Math.max(minHeight + 4, Math.round(cell * 0.3))
  const isLabel = (box: Box & { ink: number }) => {
    if (box.height < minHeight || box.height > maxHeight) return false
    if (box.width < box.height * 1.1 || box.width > cell * 4) return false
    // Text strokes cover part of their box; solid light patches (art highlights) cover most of it.
    const fill = box.ink / (box.width * box.height)
    return fill >= 0.12 && fill <= 0.75 && textLike(mask, width, box)
  }
  // A label resting on light item art (a keyring, a teddy bear) is joined to it. Labels sit at the top of the item, so
  // the piece's top rows are the letters: their columns give the label's width (the art reaches the lower rows only),
  // and the label ends where the ink in those columns thins out under the letters.
  const trimmed = (box: Box, piece: number): (Box & { ink: number }) | null => {
    const at = (x: number, y: number) => (mask[y * width + x] === 1 && label[y * width + x] === piece ? 1 : 0)
    const head = Math.max(3, Math.ceil(minHeight * 0.7))
    let left = width, right = -1
    for (let y = box.y; y < box.y + head; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) if (at(x, y)) { if (x < left) left = x; if (x > right) right = x }
    }
    if (right < left) return null
    const rowInk = (y: number) => { let ink = 0; for (let x = left; x <= right; x += 1) ink += at(x, y); return ink }
    let peak = 0
    for (let y = box.y; y < box.y + head; y += 1) peak = Math.max(peak, rowInk(y))
    const last = Math.min(box.y + box.height, box.y + maxHeight + 1)
    let cut = last, thinnest = -1, thinnestInk = Infinity
    for (let y = box.y + Math.round(minHeight * 1.25); y < last; y += 1) {
      const ink = rowInk(y)
      if (ink <= Math.max(1, peak * 0.25)) { cut = y; break }
      if (ink < thinnestInk) { thinnest = y; thinnestInk = ink }
    }
    if (cut === last && box.height > maxHeight) cut = thinnest
    if (cut < 0) return null
    let ink = 0
    for (let y = box.y; y < cut; y += 1) ink += rowInk(y)
    return { x: left, y: box.y, width: right - left + 1, height: cut - box.y, ink }
  }
  const labels = boxes.flatMap((box, index) => {
    if (isLabel(box)) return [box]
    const cut = trimmed(box, index + 1)
    return cut && isLabel(cut) ? [cut] : []
  }).sort((a, b) => a.y - b.y || a.x - b.x)
  // Words of one label («Loot Lord», «BEAR Buddy») side by side on one line: one strip.
  const merged: Box[] = []
  for (const box of labels) {
    const near = merged.find((other) => {
      const overlap = Math.min(other.y + other.height, box.y + box.height) - Math.max(other.y, box.y)
      const gapX = box.x > other.x ? box.x - (other.x + other.width) : other.x - (box.x + box.width)
      return overlap >= Math.min(other.height, box.height) * 0.6 && gapX <= cell * 0.15
    })
    if (!near) { merged.push({ x: box.x, y: box.y, width: box.width, height: box.height }); continue }
    const right = Math.max(near.x + near.width, box.x + box.width), bottom = Math.max(near.y + near.height, box.y + box.height)
    near.x = Math.min(near.x, box.x); near.y = Math.min(near.y, box.y)
    near.width = right - near.x; near.height = bottom - near.y
  }
  return merged
}

/**
 * Frame lines — the light outline of a selected or highlighted item (the blue frame), panel borders — are long straight
 * ink runs; no letter is. Removed, so a label under a frame is not joined to it.
 */
function dropLines(mask: Uint8Array, width: number, height: number, across: number, down: number) {
  const out = mask.slice()
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    let start = -1
    for (let x = 0; x <= width; x += 1) {
      const on = x < width && mask[row + x] === 1
      if (on && start < 0) start = x
      else if (!on && start >= 0) {
        if (x - start >= across) out.fill(0, row + start, row + x)
        start = -1
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    let start = -1
    for (let y = 0; y <= height; y += 1) {
      const on = y < height && mask[y * width + x] === 1
      if (on && start < 0) start = y
      else if (!on && start >= 0) {
        if (y - start >= down) for (let k = start; k < y; k += 1) out[k * width + x] = 0
        start = -1
      }
    }
  }
  return out
}

/**
 * Letters, not art: a row through a word crosses many strokes, and letters leave gaps between them. The round «found in
 * raid» marks, stack counters' boxes and bits of light item art cross one or two strokes and fill every column.
 */
function textLike(mask: Uint8Array, width: number, box: Box) {
  let rows = 0, runs = 0, columns = 0
  for (let y = box.y; y < box.y + box.height; y += 1) {
    let count = 0, previous = 0
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const on = mask[y * width + x]!
      if (on && !previous) count += 1
      previous = on
    }
    if (count) { rows += 1; runs += count }
  }
  for (let x = box.x; x < box.x + box.width; x += 1) {
    for (let y = box.y; y < box.y + box.height; y += 1) if (mask[y * width + x]) { columns += 1; break }
  }
  return rows > 0 && runs / rows >= 2.5 && columns / box.width <= 0.9
}

/**
 * The labels cut out, enlarged `scale` times (bilinear, then cut to black ink on white — the way OCR reads best) and
 * stacked one under another with a gap, as a single grey picture. Returns the picture (1 byte per pixel) and its size.
 */
export function stackLabels(raster: Raster, boxes: Box[], scale = 3, pad = 3, gapRows = 28): { width: number; height: number; data: Uint8Array } {
  const [ri, gi, bi] = channels(raster)
  const crops = boxes.map((box) => ({
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: Math.min(raster.width, box.x + box.width + pad) - Math.max(0, box.x - pad),
    height: Math.min(raster.height, box.y + box.height + pad) - Math.max(0, box.y - pad),
  }))
  const width = Math.max(1, ...crops.map((crop) => Math.round(crop.width * scale))) + gapRows * 2
  const height = crops.reduce((sum, crop) => sum + Math.round(crop.height * scale) + gapRows, gapRows)
  const out = new Uint8Array(width * height).fill(255)
  let top = gapRows
  for (const crop of crops) {
    const w = Math.round(crop.width * scale), h = Math.round(crop.height * scale)
    // Ink of the crop's pixels, sampled bilinearly.
    const ink = (sx: number, sy: number) => {
      const x = Math.min(raster.width - 1, Math.max(0, sx)), y = Math.min(raster.height - 1, Math.max(0, sy))
      const i = (y * raster.width + x) * 4
      return inkOf(raster.data[i + ri]!, raster.data[i + gi]!, raster.data[i + bi]!)
    }
    for (let y = 0; y < h; y += 1) {
      const fy = crop.y + (y + 0.5) / scale - 0.5
      const y0 = Math.floor(fy), ty = fy - y0
      for (let x = 0; x < w; x += 1) {
        const fx = crop.x + (x + 0.5) / scale - 0.5
        const x0 = Math.floor(fx), tx = fx - x0
        const value = (ink(x0, y0) * (1 - tx) + ink(x0 + 1, y0) * tx) * (1 - ty) + (ink(x0, y0 + 1) * (1 - tx) + ink(x0 + 1, y0 + 1) * tx) * ty
        out[(top + y) * width + gapRows + x] = value >= 110 ? 0 : 255
      }
    }
    top += h + gapRows
  }
  return { width, height, data: out }
}

/** How much the labels are enlarged for OCR: to about 34 px tall (×2.75 at 1440p, ×4 at 1080p). */
export function labelScale(boxes: Box[]) {
  if (!boxes.length) return 3
  const heights = boxes.map((box) => box.height).sort((a, b) => a - b)
  const median = heights[Math.floor(heights.length / 2)]!
  return Math.min(4, Math.max(2, Math.round((34 / median) * 4) / 4))
}

/**
 * The same label anywhere on screen gives the same key: its pixels (with the padding the OCR picture takes), not its
 * place. A scan reads each key once, so scrolling the stash reads only the rows that came into view.
 */
export function stripKey(raster: Raster, box: Box, pad = 3) {
  const x0 = Math.max(0, box.x - pad), y0 = Math.max(0, box.y - pad)
  const x1 = Math.min(raster.width, box.x + box.width + pad), y1 = Math.min(raster.height, box.y + box.height + pad)
  let hash = 0x811c9dc5 ^ (x1 - x0) ^ ((y1 - y0) << 16)
  for (let y = y0; y < y1; y += 1) {
    for (let i = (y * raster.width + x0) * 4, end = (y * raster.width + x1) * 4; i < end; i += 4) {
      hash = Math.imul(hash ^ raster.data[i]!, 0x01000193)
      hash = Math.imul(hash ^ raster.data[i + 1]!, 0x01000193)
      hash = Math.imul(hash ^ raster.data[i + 2]!, 0x01000193)
    }
  }
  return `${x1 - x0}x${y1 - y0}:${(hash >>> 0).toString(36)}`
}

/** A coarse print of the frame (64 × 36 samples): a scan does nothing while the screen stays the same. */
export function framePrint(raster: Raster) {
  const print = new Uint8Array(64 * 36)
  for (let row = 0; row < 36; row += 1) {
    const y = Math.min(raster.height - 1, Math.floor(((row + 0.5) * raster.height) / 36))
    for (let column = 0; column < 64; column += 1) {
      const x = Math.min(raster.width - 1, Math.floor(((column + 0.5) * raster.width) / 64))
      const i = (y * raster.width + x) * 4
      print[row * 64 + column] = (raster.data[i]! + raster.data[i + 1]! * 2 + raster.data[i + 2]!) >> 2
    }
  }
  return print
}

export function samePrint(a: Uint8Array | null, b: Uint8Array) {
  if (!a || a.length !== b.length) return false
  let changed = 0
  for (let index = 0; index < a.length; index += 1) if (Math.abs(a[index]! - b[index]!) > 6) changed += 1
  return changed === 0
}
