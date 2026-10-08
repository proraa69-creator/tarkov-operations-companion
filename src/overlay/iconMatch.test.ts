import { describe, expect, it } from 'vitest'
import { candidateDistance, decideByPicture, iconSignature, isItemIconUrl, PICTURE_MATCH, screenPicture, type PictureCandidate, type ScreenPicture } from './iconMatch'
import { pictureSignature, type Pixels, type SignatureDistance } from './iconSignature'
import { CELL_PITCH, findItemCell } from './itemCell'
import type { Bitmap } from './tooltipDetect'

const seen = (distance: number, known = 0.8): SignatureDistance => ({ distance, shape: distance, tint: 0, known })
const candidate = (id: string, text: number, distance: PictureCandidate['distance']): PictureCandidate => ({ id, text, distance })

describe('the picture decides among the text candidates', () => {
  it('answers the one icon that is close and clearly the closest', () => {
    expect(decideByPicture([candidate('a', 0.7, seen(0.08)), candidate('b', 0.72, seen(0.3)), candidate('c', 0.6, 'size')])).toEqual({ id: 'a', reason: 'match' })
    // A lone comparable candidate only has to be close.
    expect(decideByPicture([candidate('a', 0.96, seen(0.1)), candidate('b', 0.96, 'size')]).id).toBe('a')
  })

  it('answers nothing when a picture is not close enough or another is about as close', () => {
    expect(decideByPicture([candidate('a', 0.7, seen(0.2)), candidate('b', 0.7, seen(0.4))]).reason).toBe('too-far')
    // A look-alike among the candidates: no guess between them, whatever the text says.
    expect(decideByPicture([candidate('a', 0.8, seen(0.08)), candidate('b', 0.5, seen(0.13))]).reason).toBe('no-margin')
    expect(decideByPicture([candidate('a', 0.7, seen(0.08, 0.3)), candidate('b', 0.7, seen(0.4))]).reason).toBe('covered')
    expect(decideByPicture([candidate('a', 0.7, 'weapon'), candidate('b', 0.6, 'no-icon')]).reason).toBe('no-candidates')
    expect(decideByPicture([]).reason).toBe('no-candidates')
  })

  it('lets the picture choose only among names the text finds plausible', () => {
    // Read badly…
    expect(decideByPicture([candidate('a', 0.4, seen(0.05)), candidate('b', 0.42, seen(0.4))]).reason).toBe('not-plausible')
    // …or far worse than the best text candidate.
    expect(decideByPicture([candidate('a', 0.5, seen(0.05)), candidate('b', 0.8, seen(0.4))]).reason).toBe('not-plausible')
  })

  it('does not answer past a candidate read as well whose picture could not be compared', () => {
    expect(decideByPicture([candidate('a', 0.7, seen(0.05)), candidate('b', 0.75, 'no-icon')]).reason).toBe('unchecked-rival')
    expect(decideByPicture([candidate('a', 0.7, seen(0.05)), candidate('b', 0.7, 'weapon')]).reason).toBe('unchecked-rival')
    // A candidate of another size blocks only when read clearly better (the size is an estimate).
    expect(decideByPicture([candidate('a', 0.7, seen(0.05)), candidate('b', 0.85, 'size')]).reason).toBe('unchecked-rival')
    expect(decideByPicture([candidate('a', 0.7, seen(0.05)), candidate('b', 0.75, 'size')]).id).toBe('a')
    // A worse-read candidate without an icon does not.
    expect(decideByPicture([candidate('a', 0.7, seen(0.05)), candidate('b', 0.6, 'no-icon')]).id).toBe('a')
  })

  it('keeps its thresholds strict', () => {
    expect(PICTURE_MATCH.maxDistance).toBeLessThanOrEqual(0.15)
    expect(PICTURE_MATCH.minMargin).toBeGreaterThanOrEqual(0.08)
    expect(PICTURE_MATCH.candidates).toBe(8)
  })
})

describe('icon addresses the app fetches', () => {
  it('accepts https item icons only', () => {
    expect(isItemIconUrl('https://assets.tarkov.dev/5c0530ee86f774697952d952-icon.webp')).toBe(true)
    expect(isItemIconUrl('https://raidos.app/item-images/5c0530ee86f774697952d952-icon.webp')).toBe(true)
    expect(isItemIconUrl('http://assets.tarkov.dev/5c0530ee86f774697952d952-icon.webp')).toBe(false)
    expect(isItemIconUrl('https://assets.tarkov.dev/5c0530ee86f774697952d952-512.webp')).toBe(false)
    expect(isItemIconUrl('https://assets.tarkov.dev/5c0530ee86f774697952d952-icon.webp?x=1')).toBe(false)
    expect(isItemIconUrl('https://user:pass@assets.tarkov.dev/5c0530ee86f774697952d952-icon.webp')).toBe(false)
    expect(isItemIconUrl('https://assets.tarkov.dev:8443/5c0530ee86f774697952d952-icon.webp')).toBe(false)
    expect(isItemIconUrl('file:///C:/5c0530ee86f774697952d952-icon.webp')).toBe(false)
    expect(isItemIconUrl(undefined)).toBe(false)
  })
})

type Shape = { x: number; y: number; w: number; h: number; color: [number, number, number] }
/** A picture of rectangles in 0…1 coordinates, drawn at any size (4×4 supersampled). */
function paint(background: [number, number, number], shapes: Shape[], width: number, height: number, turned = false) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sum = [0, 0, 0]
      for (let sy = 0; sy < 4; sy += 1) for (let sx = 0; sx < 4; sx += 1) {
        let u = (x + (sx + 0.5) / 4) / width, v = (y + (sy + 0.5) / 4) / height
        if (turned) [u, v] = [v, 1 - u]
        const shape = [...shapes].reverse().find((s) => u >= s.x && u < s.x + s.w && v >= s.y && v < s.y + s.h)
        const color = shape?.color ?? background
        sum[0] += color[0]; sum[1] += color[1]; sum[2] += color[2]
      }
      data.set([...sum.map((value) => Math.round(value / 16)), 255], (y * width + x) * 4)
    }
  }
  return { width, height, data, order: 'rgba' as const }
}

const PICTURES: Record<string, { size: [number, number]; background: [number, number, number]; shapes: Shape[] }> = {
  canister: { size: [1, 2], background: [40, 44, 46], shapes: [{ x: 0.2, y: 0.1, w: 0.6, h: 0.8, color: [120, 30, 30] }, { x: 0.35, y: 0.05, w: 0.3, h: 0.1, color: [180, 180, 170] }] },
  bottle: { size: [1, 2], background: [40, 44, 46], shapes: [{ x: 0.3, y: 0.3, w: 0.4, h: 0.65, color: [60, 120, 160] }, { x: 0.42, y: 0.1, w: 0.16, h: 0.2, color: [200, 200, 200] }] },
  battery: { size: [2, 1], background: [40, 44, 46], shapes: [{ x: 0.1, y: 0.25, w: 0.8, h: 0.5, color: [90, 140, 60] }, { x: 0.9, y: 0.4, w: 0.06, h: 0.2, color: [200, 190, 120] }] },
  tape: { size: [1, 1], background: [40, 44, 46], shapes: [{ x: 0.2, y: 0.2, w: 0.6, h: 0.6, color: [70, 70, 160] }, { x: 0.4, y: 0.4, w: 0.2, h: 0.2, color: [20, 20, 20] }] },
}

/** A BGRA inventory grab with `name` lying at cells (2, 1) (turned a quarter when asked), the cursor and a tooltip on it. */
function sceneWith(name: string, unit: number, turned = false) {
  const picture = PICTURES[name]!
  const [cols, rows] = turned ? [picture.size[1], picture.size[0]] : picture.size
  const pitch = Math.round(CELL_PITCH * unit)
  const width = pitch * 7, height = pitch * 5
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < data.length; index += 4) data.set([22, 22, 22, 255], index)
  const line = (x0: number, y0: number, x1: number, y1: number, color: number[]) => { for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) data.set([color[2]!, color[1]!, color[0]!, 255], (y * width + x) * 4) }
  for (let k = 0; k < 7; k += 1) line(k * pitch, 0, k * pitch, height - 1, [66, 73, 76])
  for (let k = 0; k < 5; k += 1) line(0, k * pitch, width - 1, k * pitch, [66, 73, 76])
  const x0 = 2 * pitch, y0 = pitch, w = cols * pitch, h = rows * pitch
  const drawn = paint(picture.background, picture.shapes, w - 1, h - 1, turned)
  for (let y = 0; y < h - 1; y += 1) for (let x = 0; x < w - 1; x += 1) {
    const from = (y * (w - 1) + x) * 4
    data.set([drawn.data[from + 2]!, drawn.data[from + 1]!, drawn.data[from]!, 255], ((y0 + 1 + y) * width + x0 + 1 + x) * 4)
  }
  line(x0, y0, x0 + w, y0, [73, 81, 84]); line(x0, y0 + h, x0 + w, y0 + h, [73, 81, 84])
  line(x0, y0, x0, y0 + h, [73, 81, 84]); line(x0 + w, y0, x0 + w, y0 + h, [73, 81, 84])
  const cursor = { x: x0 + Math.round(w * 0.3), y: y0 + Math.round(h * 0.4) }
  const tooltip = { x: cursor.x + 12, y: cursor.y + 4, width: Math.round(150 * unit), height: Math.round(24 * unit) }
  line(tooltip.x, tooltip.y, tooltip.x + tooltip.width, tooltip.y + tooltip.height, [10, 11, 11])
  const image: Bitmap = { width, height, data }
  return { image, cursor, tooltip }
}

const icons = Object.fromEntries(Object.entries(PICTURES).map(([name, picture]) => {
  const [cols, rows] = picture.size
  // A square icon with the picture fitted in it, transparent around.
  const fitW = Math.round(64 * Math.min(1, cols / rows)), fitH = Math.round(64 * Math.min(1, rows / cols))
  const drawn = paint(picture.background, picture.shapes, fitW, fitH)
  const data = new Uint8Array(64 * 64 * 4)
  const left = (64 - fitW) / 2, top = (64 - fitH) / 2
  for (let y = 0; y < fitH; y += 1) data.set(drawn.data.subarray(y * fitW * 4, (y + 1) * fitW * 4), ((top + y) * 64 + left) * 4)
  const icon: Pixels = { width: 64, height: 64, data, order: 'rgba', alpha: true }
  return [name, { cols, rows, signature: iconSignature(icon, cols, rows) }]
}))

function check(screen: ScreenPicture) {
  return decideByPicture(Object.entries(icons).map(([name, icon]) => candidate(name, 0.7, candidateDistance(screen, icon, icon.signature) ?? 'size')))
}

describe('the item under the cursor against the candidates’ icons', () => {
  it('finds the item from its picture at 1080p and 1440p, its tooltip and the cursor left out', () => {
    for (const unit of [1, 1440 / 1080]) {
      for (const name of ['canister', 'battery', 'tape']) {
        const scene = sceneWith(name, unit)
        const cell = findItemCell(scene.image, scene.cursor, unit, scene.tooltip)
        expect(check(screenPicture(scene.image, cell))).toEqual({ id: name, reason: 'match' })
      }
    }
  })

  it('compares an item lying rotated with its icon turned back', () => {
    const scene = sceneWith('battery', 1, true)
    const screen = screenPicture(scene.image, findItemCell(scene.image, scene.cursor, 1, scene.tooltip))
    expect(screen.layouts[0]).toMatchObject({ cols: 1, rows: 2 })
    expect(Object.keys(screen.layouts[0]!.turns).sort()).toEqual(['0', '1', '3'])
    expect(check(screen).id).toBe('battery')
  })

  it('compares each candidate only with a layout of its size', () => {
    const signature = pictureSignature({ width: 2, height: 2, data: new Uint8Array(16), order: 'rgba' }, { x: 0, y: 0, width: 2, height: 2 })
    const screen: ScreenPicture = { grid: true, layouts: [{ cols: 1, rows: 2, turns: { 0: signature, 1: signature, 3: signature } }] }
    expect(candidateDistance(screen, { cols: 1, rows: 2 }, signature)).not.toBeNull()
    expect(candidateDistance(screen, { cols: 2, rows: 1 }, signature)).not.toBeNull()
    expect(candidateDistance(screen, { cols: 1, rows: 1 }, signature)).toBeNull()
    expect(candidateDistance(screen, { cols: 2, rows: 2 }, signature)).toBeNull()
  })
})
