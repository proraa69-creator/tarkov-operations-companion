import { describe, expect, it } from 'vitest'
import { CELL_PITCH, findItemCell } from './itemCell'
import type { Bitmap, Rect } from './tooltipDetect'

interface StashItem { col: number; row: number; cols: number; rows: number; tint: [number, number, number]; label?: number }

/**
 * An inventory like the game's (BGRA): dark cells, thin grid lines, items with a tinted background, a picture, a frame
 * on the grid lines and a light short name at the top right; maybe a tooltip box.
 */
function stash(unit: number, items: StashItem[], tooltip?: Rect) {
  const pitch = CELL_PITCH * unit
  const width = Math.round(pitch * 12), height = Math.round(pitch * 8)
  const data = new Uint8Array(width * height * 4)
  const put = (x: number, y: number, [r, g, b]: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    data.set([b, g, r, 255], (Math.round(y) * width + Math.round(x)) * 4)
  }
  const fill = (x0: number, y0: number, x1: number, y1: number, color: [number, number, number]) => {
    for (let y = Math.round(y0); y < Math.round(y1); y += 1) for (let x = Math.round(x0); x < Math.round(x1); x += 1) put(x, y, color)
  }
  const gx = Math.round(pitch * 0.37), gy = Math.round(pitch * 0.61)
  const lineX = (index: number) => Math.round(gx + index * pitch), lineY = (index: number) => Math.round(gy + index * pitch)
  fill(0, 0, width, height, [22, 22, 22])
  for (let index = -1; index < 13; index += 1) fill(lineX(index), 0, lineX(index) + 1, height, [66, 73, 76])
  for (let index = -1; index < 9; index += 1) fill(0, lineY(index), width, lineY(index) + 1, [66, 73, 76])
  for (const item of items) {
    const x0 = lineX(item.col), y0 = lineY(item.row), x1 = lineX(item.col + item.cols), y1 = lineY(item.row + item.rows)
    fill(x0 + 1, y0 + 1, x1, y1, item.tint)
    // The picture: a body and a stick across it, reaching the frame.
    fill(x0 + (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.3, x0 + (x1 - x0) * 0.8, y0 + (y1 - y0) * 0.75, [150, 140, 90])
    for (let t = 0; t < 1; t += 0.002) fill(x0 + 1 + (x1 - x0 - 2) * t, y0 + (y1 - y0) * (0.85 - 0.6 * t), x0 + 4 + (x1 - x0 - 2) * t, y0 + (y1 - y0) * (0.85 - 0.6 * t) + 3 * unit, [200, 200, 195])
    for (let x = x0; x <= x1; x += 1) { put(x, y0, [73, 81, 84]); put(x, y1, [73, 81, 84]) }
    for (let y = y0; y <= y1; y += 1) { put(x0, y, [73, 81, 84]); put(x1, y, [73, 81, 84]) }
    // Short name: light letters at the top right.
    if (item.label) for (let x = x1 - 3 * unit - item.label * unit; x < x1 - 3 * unit; x += 2) fill(x, y0 + 3 * unit, x + 1, y0 + 11 * unit, [205, 205, 200])
  }
  if (tooltip) {
    fill(tooltip.x - 1, tooltip.y - 1, tooltip.x + tooltip.width + 1, tooltip.y + tooltip.height + 1, [140, 140, 140])
    fill(tooltip.x, tooltip.y, tooltip.x + tooltip.width, tooltip.y + tooltip.height, [10, 11, 11])
  }
  const image: Bitmap = { width, height, data }
  return { image, cell: (col: number, row: number) => ({ x: lineX(col), y: lineY(row) }), pitch }
}

const NEIGHBOURS: StashItem[] = [
  { col: 3, row: 2, cols: 1, rows: 1, tint: [40, 40, 40], label: 20 },
  { col: 6, row: 2, cols: 2, rows: 1, tint: [60, 55, 15], label: 30 },
  { col: 4, row: 4, cols: 1, rows: 1, tint: [45, 20, 55], label: 12 },
  { col: 5, row: 4, cols: 1, rows: 2, tint: [20, 40, 60] },
]

describe('the hovered item in the inventory', () => {
  it('finds a one-cell item among its neighbours', () => {
    const scene = stash(1, [...NEIGHBOURS, { col: 4, row: 2, cols: 1, rows: 1, tint: [25, 50, 25], label: 24 }])
    const corner = scene.cell(4, 2)
    const result = findItemCell(scene.image, { x: corner.x + 30, y: corner.y + 35 }, 1)
    expect(result.grid).toBe(true)
    expect(result.layouts).toHaveLength(1)
    expect(result.layouts[0]).toMatchObject({ cols: 1, rows: 1, rect: { x: corner.x + 2, y: corner.y + 2 } })
    expect(result.layouts[0]!.rect.width).toBeGreaterThan(55)
  })

  it('spreads over the cells of a bigger item, wherever the cursor is on it', () => {
    const scene = stash(1, [...NEIGHBOURS, { col: 3, row: 3, cols: 2, rows: 1, tint: [50, 50, 50], label: 40 }])
    const corner = scene.cell(3, 3)
    for (const x of [corner.x + 20, corner.x + 100]) {
      expect(findItemCell(scene.image, { x, y: corner.y + 30 }, 1).layouts[0]).toMatchObject({ cols: 2, rows: 1, rect: { x: corner.x + 2, y: corner.y + 2 } })
    }
  })

  it('works at other UI sizes (1440p: 84 px cells)', () => {
    const unit = 1440 / 1080
    const scene = stash(unit, [{ col: 2, row: 2, cols: 1, rows: 2, tint: [25, 50, 90], label: 18 }, { col: 3, row: 2, cols: 1, rows: 1, tint: [40, 40, 40] }])
    const corner = scene.cell(2, 2)
    expect(findItemCell(scene.image, { x: corner.x + 40, y: corner.y + 120 }, unit).layouts[0]).toMatchObject({ cols: 1, rows: 2 })
  })

  it('offers both readings when the tooltip hides a border inside the item', () => {
    const scene = stash(1, [...NEIGHBOURS, { col: 7, row: 4, cols: 2, rows: 2, tint: [50, 50, 50] }])
    const corner = scene.cell(7, 4)
    // The tooltip lies over the border between the item's two rows, right of the cursor.
    const tooltip = { x: corner.x + 30, y: corner.y + 48, width: 260, height: 30 }
    const hidden = stash(1, [...NEIGHBOURS, { col: 7, row: 4, cols: 2, rows: 2, tint: [50, 50, 50] }], tooltip)
    const result = findItemCell(hidden.image, { x: corner.x + 20, y: corner.y + 40 }, 1, tooltip)
    expect(result.layouts.map((layout) => `${layout.cols}x${layout.rows}`)).toContain('2x2')
    expect(findItemCell(scene.image, { x: corner.x + 20, y: corner.y + 40 }, 1).layouts.map((layout) => `${layout.cols}x${layout.rows}`)).toEqual(['2x2'])
  })

  it('leaves out the cursor, the tooltip and the short name — from where its letters start', () => {
    const tooltip = { x: 400, y: 500, width: 200, height: 28 }
    const scene = stash(1, [...NEIGHBOURS, { col: 4, row: 2, cols: 1, rows: 1, tint: [25, 50, 25], label: 20 }], tooltip)
    const corner = scene.cell(4, 2)
    const cursor = { x: corner.x + 30, y: corner.y + 35 }
    const [layout] = findItemCell(scene.image, cursor, 1, tooltip).layouts
    const covered = layout!.covered
    expect(covered).toContainEqual({ x: cursor.x - 2, y: cursor.y - 2, width: 19, height: 27 })
    expect(covered.some((part) => part.x < tooltip.x && part.x + part.width > tooltip.x + tooltip.width && part.y < tooltip.y)).toBe(true)
    const label = covered.find((part) => part.y === layout!.rect.y)!
    // About the 20 px of letters (and a little room), not the whole width of the cell.
    expect(label.width).toBeGreaterThan(18)
    expect(label.width).toBeLessThan(30)
    expect(label.x + label.width).toBe(layout!.rect.x + layout!.rect.width)
  })

  it('falls back to the cell-sized square around the cursor when no grid shows', () => {
    const flat: Bitmap = { width: 400, height: 300, data: new Uint8Array(400 * 300 * 4).fill(30) }
    const result = findItemCell(flat, { x: 200, y: 150 }, 1)
    expect(result.grid).toBe(false)
    expect(result.layouts).toEqual([expect.objectContaining({ cols: 1, rows: 1, rect: { x: 169, y: 119, width: 63, height: 63 } })])
  })
})
