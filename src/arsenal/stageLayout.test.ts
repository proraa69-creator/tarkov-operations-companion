import { describe, expect, it } from 'vitest'
import { bandOf, layStage, spread, type Stage, type StageCellInput, type StagePicture } from './stageLayout'

const options = { width: 800, cell: 50, gap: 4, reach: 20, sides: true, maxScale: 1 }

describe('spread', () => {
  it('keeps lone cells at their places and pushes overlapping ones apart around their middle', () => {
    expect(spread([100, 400], 50, 4, 0, 800)).toEqual([75, 375])
    const starts = spread([300, 310, 320], 50, 4, 0, 800)
    expect(starts[1]! - starts[0]!).toBe(54)
    expect(starts[2]! - starts[1]!).toBe(54)
    // the group sits around the mean of the wanted places
    expect((starts[0]! + starts[2]! + 50) / 2).toBeCloseTo(310)
  })

  it('stays inside its range and keeps the input order of the answer', () => {
    const starts = spread([790, -40, 780], 50, 4, 0, 800)
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...starts) + 50).toBeLessThanOrEqual(800)
    expect(starts[1]).toBe(0)
  })
})

const cell = (key: string, kind: StageCellInput['kind'], zone: StageCellInput['zone'], anchor: [number, number], depth = 1): StageCellInput => ({ key, kind, zone, depth, anchor })

/** No cell over a part of the picture nor over another cell. */
function expectClear(stage: Stage, picture: StagePicture, size = 50) {
  const { x, y, scale } = stage.picture
  for (const entry of stage.cells) {
    for (const [left, top, right, bottom] of picture.boxes ?? []) {
      const free = entry.x + size <= x + left * scale || entry.x >= x + right * scale || entry.y + size <= y + top * scale || entry.y >= y + bottom * scale
      expect(free, `${entry.key} over a part`).toBe(true)
    }
    for (const other of stage.cells) {
      if (other === entry) continue
      const apart = entry.x + size <= other.x || other.x + size <= entry.x || entry.y + size <= other.y || other.y + size <= entry.y
      expect(apart, `${entry.key} / ${other.key}`).toBe(true)
    }
    expect(entry.y).toBeGreaterThanOrEqual(0)
    expect(entry.y + size).toBeLessThanOrEqual(stage.height)
  }
}

describe('layStage', () => {
  // a rifle from the side: barrel at the left, a tall magazine in the middle, the stock at the right
  const picture: StagePicture = {
    width: 700,
    height: 200,
    boxes: [[0, 60, 300, 80], [250, 40, 600, 110], [380, 100, 440, 200], [560, 50, 700, 130]],
  }

  it('puts sights above, the magazine below, the muzzle left and the stock right, none over the weapon or each other', () => {
    const inputs = [
      cell('scope', 'scope', 'top', [400, 40]),
      cell('charge', 'charge', 'top', [470, 45]),
      cell('magazine', 'magazine', 'bottom', [410, 150]),
      cell('grip', 'grip', 'bottom', [500, 110]),
      cell('muzzle', 'muzzle', 'middle', [10, 70]),
      cell('stock', 'stock', 'middle', [690, 80]),
    ]
    const stage = layStage(picture, inputs, options)
    const at = Object.fromEntries(stage.cells.map((entry) => [entry.key, entry]))
    expect(at.scope!.band).toBe('top')
    expect(at.magazine!.band).toBe('bottom')
    expect(at.muzzle!.band).toBe('left')
    expect(at.stock!.band).toBe('right')
    // above its point, below its point
    expect(at.scope!.y + 50).toBeLessThanOrEqual(at.scope!.point[1])
    expect(at.magazine!.y).toBeGreaterThanOrEqual(at.magazine!.point[1])
    expectClear(stage, picture)
    // every line ends at its cell's point on the picture
    expect(at.scope!.point[0]).toBeCloseTo(stage.picture.x + 400 * stage.picture.scale)
  })

  it('a cell under the thin barrel stands higher than one under the magazine', () => {
    const inputs = [cell('gas', 'gas', 'middle', [120, 70]), cell('magazine', 'magazine', 'bottom', [410, 150])]
    const stage = layStage(picture, inputs, { ...options, sides: false })
    const at = Object.fromEntries(stage.cells.map((entry) => [entry.key, entry]))
    expect(at.gas!.band).toBe('bottom')
    expect(at.gas!.y).toBeLessThan(at.magazine!.y)
    expectClear(stage, picture)
  })

  it('a narrow stage has no sides and splits a crowded band into rows of every other cell, left to right', () => {
    expect(bandOf({ kind: 'muzzle', zone: 'middle' }, false)).toBe('bottom')
    const many = Array.from({ length: 9 }, (_, index) => cell(`m${index}`, 'mount', 'top', [index * 70, 10]))
    const stage = layStage(picture, many, { ...options, width: 300, sides: false })
    expect(Math.max(...stage.cells.map((entry) => entry.x + 50))).toBeLessThanOrEqual(300)
    expectClear(stage, picture)
  })
})
