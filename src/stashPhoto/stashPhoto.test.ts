import { describe, expect, it } from 'vitest'
import { detectGrid, evenRun, gapSpread } from './grid'
import { countFinds, labelSimilarity, matchStash, type PhotoCandidate } from './match'
import { sampleQuad, type Rgba } from './raster'
import { busyness, fingerprint, likeness } from './signature'

/** A synthetic stash: dark cells 40 px apart with light lines between them, some cells filled with a pattern. */
function stash(columns: number, rows: number, fill: (col: number, row: number, x: number, y: number) => [number, number, number] | null, lean = 0): Rgba {
  const pitch = 40, margin = 30
  const width = columns * pitch + margin * 2 + Math.abs(lean) * rows, height = rows * pitch + margin * 2
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      // lean: each row of pixels shifted right by `lean` px per cell height
      const gx = x - margin - (lean * (y - margin)) / pitch, gy = y - margin
      let colour: [number, number, number] = [18, 22, 20]
      if (gx >= 0 && gy >= 0 && gx < columns * pitch && gy < rows * pitch) {
        const col = Math.floor(gx / pitch), row = Math.floor(gy / pitch)
        const lx = gx - col * pitch, ly = gy - row * pitch
        colour = lx < 2 || ly < 2 ? [120, 128, 124] : fill(col, row, lx, ly) ?? [34, 40, 38]
      }
      data[i] = colour[0]; data[i + 1] = colour[1]; data[i + 2] = colour[2]; data[i + 3] = 255
    }
  }
  return { width, height, data }
}

const stripes = (_col: number, _row: number, x: number, y: number): [number, number, number] => (Math.floor(x / 6) % 2 ? [220, 80, 60] : [20, 40, 120]).map((v) => v + (y % 7)) as [number, number, number]
const dots = (_col: number, _row: number, x: number, y: number): [number, number, number] => ((x - 20) ** 2 + (y - 22) ** 2 < 90 ? [230, 220, 90] : [60, 40, 90])

describe('stash photo: grid', () => {
  it('keeps evenly spaced runs and measures unevenness against neighbours', () => {
    expect(evenRun([25, 50, 90, 130, 170, 210, 260, 300], 20, 100)).toEqual([50, 90, 130, 170, 210])
    expect(gapSpread([0, 100, 196, 290, 382, 472])).toBeLessThan(0.02)
    expect(gapSpread([0, 100, 160, 290, 330, 470])).toBeGreaterThan(0.3)
  })

  it('finds a straight grid', () => {
    const image = stash(10, 8, (col, row, x, y) => ((col + row) % 3 === 0 ? stripes(col, row, x, y) : null))
    const grid = detectGrid(image)!
    expect(grid).not.toBeNull()
    expect(grid.columns).toBeGreaterThanOrEqual(9)
    expect(grid.rows).toBeGreaterThanOrEqual(7)
    expect(Math.abs(grid.pitch - 40)).toBeLessThan(2)
  })

  it('follows leaning lines', () => {
    const image = stash(10, 8, (col, row, x, y) => ((col * 7 + row) % 4 === 0 ? dots(col, row, x, y) : null), 3)
    const grid = detectGrid(image)!
    expect(grid).not.toBeNull()
    const [[x0], , , [x3]] = grid.quad(0, 0, 1, grid.rows)
    // the left line moves right by about 3 px per row
    expect(x3 - x0).toBeGreaterThan(grid.rows * 2)
  })

  it('finds nothing in a picture without a grid', () => {
    let seed = 12345
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const noise = new Uint8ClampedArray(300 * 200 * 4).map((_, index) => (index % 4 === 3 ? 255 : Math.floor(random() * 256)))
    expect(detectGrid({ width: 300, height: 200, data: noise })).toBeNull()
  })
})

describe('stash photo: pictures and labels', () => {
  it('a picture is like itself under another white balance, not like another picture', () => {
    const a = stash(1, 1, stripes), b = stash(1, 1, dots)
    const warm: Rgba = { ...a, data: a.data.map((value, index) => (index % 4 === 0 ? Math.min(255, value * 1.2 + 10) : value)) }
    const cell = (image: Rgba) => sampleQuad(image, [[30, 30], [70, 30], [70, 70], [30, 70]], 64, 64)
    expect(likeness(fingerprint(cell(a), 1, 1), fingerprint(cell(warm), 1, 1))).toBeGreaterThan(0.85)
    expect(likeness(fingerprint(cell(a), 1, 1), fingerprint(cell(b), 1, 1))).toBeLessThan(0.4)
  })

  it('an empty cell is flat', () => {
    const image = stash(2, 1, (col, row, x, y) => (col === 1 ? stripes(col, row, x, y) : null))
    expect(busyness(sampleQuad(image, [[33, 33], [68, 33], [68, 68], [33, 68]], 32, 32))).toBeLessThan(9)
    expect(busyness(sampleQuad(image, [[73, 33], [108, 33], [108, 68], [73, 68]], 32, 32))).toBeGreaterThan(9)
  })

  it('reads labels with OCR slips and cut ends', () => {
    expect(labelSimilarity('Изолента|', 'Изолента')).toBeGreaterThan(0.85)
    expect(labelSimilarity('Macno;', 'Масло')).toBeGreaterThan(0.6)
    expect(labelSimilarity('Запчаст', 'Зап.части')).toBeGreaterThan(0.7)
    expect(labelSimilarity('Свеча', 'Гайки')).toBeLessThan(0.3)
    expect(labelSimilarity('', 'Гайки')).toBe(0)
  })
})

describe('stash photo: matching', () => {
  const cellOf = (image: Rgba, col: number, row: number) => sampleQuad(image, [[30 + col * 40, 30 + row * 40], [70 + col * 40, 30 + row * 40], [70 + col * 40, 70 + row * 40], [30 + col * 40, 70 + row * 40]], 64, 64)
  const image = stash(3, 1, (col, row, x, y) => (col === 0 ? stripes(col, row, x, y) : col === 1 ? dots(col, row, x, y) : null))
  const candidates: PhotoCandidate[] = [
    { id: 'tape', shortName: 'Изолента', width: 1, height: 1, fingerprint: fingerprint(cellOf(image, 0, 0), 1, 1) },
    { id: 'nuts', shortName: 'Гайки', width: 1, height: 1, fingerprint: fingerprint(cellOf(image, 1, 0), 1, 1) },
  ]
  const input = (labels: Record<string, string>) => ({
    columns: 3, rows: 1, empty: new Set(['2,0']), labels: new Map(Object.entries(labels)), candidates,
    catalogNames: ['Изолента', 'Гайки', 'Болты'],
    fingerprintAt: (col: number, row: number) => fingerprint(cellOf(image, col, row), 1, 1),
  })

  it('finds each wanted item once, sure when its label agrees', () => {
    const finds = matchStash(input({ '0,0': 'Изолента', '1,0': 'Гайки' }))
    expect(finds.map((find) => [find.id, find.col, find.doubtful])).toEqual([['tape', 0, false], ['nuts', 1, false]])
    expect(countFinds(finds).map((entry) => entry.count)).toEqual([1, 1])
  })

  it('leaves a find without a label unticked', () => {
    const finds = matchStash(input({}))
    expect(finds.every((find) => find.doubtful)).toBe(true)
  })

  it('drops a wanted look-alike when the label names another item', () => {
    const finds = matchStash(input({ '0,0': 'Болты', '1,0': 'Гайки' }))
    expect(finds.map((find) => find.id)).toEqual(['nuts'])
  })
})
